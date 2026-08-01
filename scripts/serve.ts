// serve.ts
//
// Tiny HTTP server for the Deadstock demo. Two jobs:
//   1. Serve the static site (index.html, brand/*, data/06-matches.json, theme.css, *.mp4)
//   2. Proxy /api/chat -> Kibana Agent Builder converse, keeping ELASTIC_API_KEY server-side
//
// Zero dependencies beyond Node's built-in http + fs. Run with:
//   npm run serve
//
// The Kibana API key MUST NOT be exposed to the browser -- treat this server as
// the trust boundary. The browser only ever calls /api/chat.

import "./lib/env.ts";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv } from "./lib/env.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(here, "..");
const PORT = Number(process.env.PORT ?? 8080);

const KIBANA = requireEnv("KIBANA_URL").replace(/\/+$/, "");
const KEY = requireEnv("ELASTIC_API_KEY");
const AGENT_ID = process.env.DEADSTOCK_AGENT_ID ?? "deadstock-agent";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";

  // -------- API: chat --------
  if (url.pathname === "/api/chat" && method === "POST") {
    return handleChat(req, res);
  }

  // -------- Static --------
  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    return res.end("Method Not Allowed");
  }

  // Normalize + jail to REPO_ROOT so a path like "/../../.env.local" cannot escape.
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const requested = normalize(join(REPO_ROOT, rel));
  if (!requested.startsWith(REPO_ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  try {
    const st = await stat(requested);
    if (st.isDirectory()) {
      // Serve <dir>/index.html if it exists, else 404
      const idx = join(requested, "index.html");
      const st2 = await stat(idx).catch(() => null);
      if (!st2 || !st2.isFile()) {
        res.writeHead(404);
        return res.end("Not Found");
      }
      const body = await readFile(idx);
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      return res.end(body);
    }
    const body = await readFile(requested);
    const type = MIME[extname(requested).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": rel.startsWith("/data/") ? "no-store" : "public, max-age=60",
      "Content-Length": String(body.length),
    });
    return res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");
  }
});

// ---------- Chat proxy ----------
//
// Forwards { input, conversation_id? } to Kibana converse. Returns { message,
// conversation_id, tool_calls, model_usage } so the browser can render the reply
// AND (optionally) show which tools were used.

type ConverseRequest = { input: string; conversation_id?: string };

type ConverseStep = {
  type: string;
  reasoning?: string;
  tool_id?: string;
  tool_type?: string;
  params?: unknown;
};

type ConverseResponse = {
  conversation_id: string;
  response: { message: string };
  steps?: ConverseStep[];
  model_usage?: { input_tokens: number; output_tokens: number; llm_calls: number; model?: string };
};

async function handleChat(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: ConverseRequest;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid JSON body" }));
  }
  if (!body?.input || typeof body.input !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Missing 'input' string" }));
  }

  const payload: Record<string, unknown> = { agent_id: AGENT_ID, input: body.input };
  if (body.conversation_id) payload.conversation_id = body.conversation_id;

  try {
    const t0 = Date.now();
    const r = await fetch(`${KIBANA}/api/agent_builder/converse`, {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${KEY}`,
        "kbn-xsrf": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      console.error(`[chat] Kibana returned ${r.status}: ${text.slice(0, 200)}`);
      res.writeHead(r.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: `Kibana ${r.status}`, detail: text.slice(0, 400) }));
    }
    const kb = JSON.parse(text) as ConverseResponse;
    const toolCalls = (kb.steps ?? [])
      .filter((s) => s.type === "tool_call")
      .map((s) => ({ tool_id: s.tool_id, tool_type: s.tool_type, params: s.params }));

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[chat] "${body.input.slice(0, 60)}" -> ${elapsed}s, ` +
      `${toolCalls.length} tool calls, ${kb.model_usage?.input_tokens ?? "?"}in/${kb.model_usage?.output_tokens ?? "?"}out tokens`,
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        conversation_id: kb.conversation_id,
        message: kb.response?.message ?? "",
        tool_calls: toolCalls,
        model_usage: kb.model_usage ?? null,
        elapsed_ms: Date.now() - t0,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[chat] Fetch error: ${msg}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Upstream fetch failed", detail: msg }));
  }
}

server.listen(PORT, () => {
  console.log(`\n  Deadstock static + chat server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Chat proxy -> ${KIBANA} (agent=${AGENT_ID})\n`);
});
