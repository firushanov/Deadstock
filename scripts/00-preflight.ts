// 00-preflight.ts
//
// Purpose: five green checks before we burn any time in later phases.
// If any of these fail, STOP and fix -- do not proceed to phase 1.
//
// Checks:
//   1. Elastic endpoint + API key reachable (es.info)
//   2. Available inference endpoints listed (GET /_inference)
//   3. Default inference_id resolved via a throwaway probe index and PINNED to
//      data/00-inference-id.txt for the real mappings to reuse
//   4. Kibana Agent Builder API reachable (GET /api/agent_builder/tools)
//   5. Apify token valid + remaining credit printed

import "./lib/env.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { es } from "./lib/es.ts";
import { apify } from "./lib/apify.ts";
import { requireEnv, DATA_DIR } from "./lib/env.ts";

const OK = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

let failed = 0;

function pass(label: string, detail?: string) {
  console.log(`${OK} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ""}`);
}

function fail(label: string, err: unknown) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`${FAIL} ${label}\n  ${DIM}${msg}${RESET}`);
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  // -------- 1. Elasticsearch reachable --------
  try {
    const info = await es.info();
    pass("Elasticsearch reachable", `cluster=${info.cluster_name} version=${info.version.number}`);
  } catch (e) {
    fail("Elasticsearch reachable", e);
  }

  // -------- 2. List inference endpoints --------
  //
  // Serverless preconfigures endpoints -- most useful is the one that semantic_text
  // picks by default (currently .jina-embeddings-v5-text-small on 9.4+). This is
  // NOT the same across versions -- see CLAUDE.md §7 trap 3.
  let inferenceIds: string[] = [];
  try {
    const resp = await es.inference.get();
    inferenceIds = (resp.endpoints ?? []).map((e: { inference_id: string }) => e.inference_id);
    pass("Inference endpoints listed", `${inferenceIds.length} found`);
    for (const id of inferenceIds) console.log(`  ${DIM}- ${id}${RESET}`);
  } catch (e) {
    fail("Inference endpoints listed", e);
  }

  // -------- 3. Probe default inference_id, pin it --------
  //
  // Create a tiny throwaway index whose only mapping is a bare semantic_text field.
  // Elastic fills in inference_id with whatever it defaults to. Read it back, pin it.
  const probeIndex = "deadstock-probe-inference";
  let pinnedId: string | null = null;
  try {
    // Idempotent: delete if exists from a previous run
    await es.indices.delete({ index: probeIndex }, { ignore: [404] });
    await es.indices.create({
      index: probeIndex,
      mappings: { properties: { probe: { type: "semantic_text" } } },
    });
    const mapping = await es.indices.getMapping({ index: probeIndex });
    const props = mapping[probeIndex]?.mappings?.properties as
      | { probe?: { type?: string; inference_id?: string } }
      | undefined;
    pinnedId = props?.probe?.inference_id ?? null;
    await es.indices.delete({ index: probeIndex });

    if (!pinnedId) throw new Error("probe mapping did not report an inference_id");
    writeFileSync(resolve(DATA_DIR, "00-inference-id.txt"), pinnedId, "utf8");
    pass("Default inference_id resolved", `pinned=${pinnedId} -> data/00-inference-id.txt`);
  } catch (e) {
    fail("Default inference_id resolved", e);
  }

  // -------- 4. Kibana Agent Builder reachable --------
  //
  // Kibana URL uses .kb. subdomain (NOT the .es. Elasticsearch endpoint). Auth is the
  // same API key. If this 404s, the URL is wrong; if it 401s, the key lacks
  // feature_agentBuilder privileges.
  try {
    const kibanaUrl = requireEnv("KIBANA_URL").replace(/\/+$/, "");
    const apiKey = requireEnv("ELASTIC_API_KEY");
    const resp = await fetch(`${kibanaUrl}/api/agent_builder/tools`, {
      headers: {
        Authorization: `ApiKey ${apiKey}`,
        "kbn-xsrf": "true",
        "Content-Type": "application/json",
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = (await resp.json()) as { results?: unknown[] } | unknown[];
    const count = Array.isArray(data) ? data.length : Array.isArray(data.results) ? data.results.length : 0;
    pass("Kibana Agent Builder reachable", `${count} existing tools`);
  } catch (e) {
    fail("Kibana Agent Builder reachable", e);
  }

  // -------- 5. Apify token + credit --------
  try {
    const user = await apify.user().get();
    const plan = (user as unknown as { plan?: { id?: string } }).plan?.id ?? "unknown";
    // credit info is on limits / usage, not always on user object
    pass("Apify token valid", `user=${user.username} plan=${plan}`);
  } catch (e) {
    fail("Apify token valid", e);
  }

  console.log();
  if (failed > 0) {
    console.log(`${FAIL} ${failed} check(s) failed. Fix these before running phase 1.`);
    process.exit(1);
  }
  console.log(`${OK} All checks passed. You can run \`npm run fetch\` next.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
