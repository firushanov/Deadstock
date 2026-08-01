// 07-agent-setup.ts
//
// Creates the Deadstock agent + tools in Kibana Agent Builder via the REST API.
// Idempotent: deletes an existing tool/agent with the same id before recreating.
//
// Cut plan (CLAUDE.md §5): one index_search tool + one ES|QL tool + the agent.
// Skips deadstock-worst-offenders from the full plan §10 (nice-to-have, cut for time).
//
// If the API rejects any body, the fallback is clicking these into the Kibana UI
// at Stack Management -> Agent Builder -> Tools / Agents. Same content.

import "./lib/env.ts";
import { requireEnv } from "./lib/env.ts";

const KIBANA = requireEnv("KIBANA_URL").replace(/\/+$/, "");
const API_KEY = requireEnv("ELASTIC_API_KEY");

const HEADERS = {
  Authorization: `ApiKey ${API_KEY}`,
  "kbn-xsrf": "true",
  "Content-Type": "application/json",
};

async function kb(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${KIBANA}${path}`, { ...init, headers: { ...HEADERS, ...(init?.headers ?? {}) } });
}

async function deleteIfExists(path: string, kind: string, id: string) {
  const r = await kb(path, { method: "DELETE" });
  if (r.ok) console.log(`  · deleted existing ${kind}: ${id}`);
  else if (r.status === 404) console.log(`  · no existing ${kind}: ${id}`);
  else console.log(`  ⚠ delete ${kind}:${id} returned ${r.status}`);
}

async function createTool(body: object) {
  const r = await kb(`/api/agent_builder/tools`, { method: "POST", body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST /tools failed (${r.status}): ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text) as { id?: string };
  console.log(`  ✓ tool created: ${parsed.id ?? "(no id)"}`);
}

async function createAgent(body: object) {
  const r = await kb(`/api/agent_builder/agents`, { method: "POST", body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`POST /agents failed (${r.status}): ${text.slice(0, 400)}`);
  const parsed = JSON.parse(text) as { id?: string };
  console.log(`  ✓ agent created: ${parsed.id ?? "(no id)"}`);
}

async function main() {
  console.log(`Target: ${KIBANA}`);

  // -------- Tools --------
  console.log(`\nDeleting existing Deadstock tools / agent (idempotent)...`);
  await deleteIfExists(`/api/agent_builder/tools/deadstock-search`, "tool", "deadstock-search");
  await deleteIfExists(`/api/agent_builder/tools/deadstock-by-hazard`, "tool", "deadstock-by-hazard");
  await deleteIfExists(`/api/agent_builder/agents/deadstock-agent`, "agent", "deadstock-agent");

  // ---- Tool 1: index-search over deadstock-matches ----
  console.log(`\nCreating deadstock-search (index_search)...`);
  await createTool({
    id: "deadstock-search",
    type: "index_search",
    description:
      "Search recalled products that are currently for sale online. " +
      "Use for any question about specific products, hazards, brands, or retailers. " +
      "Every result is a recalled product with an active marketplace listing.",
    configuration: {
      pattern: "deadstock-matches",
      row_limit: 20,
      custom_instructions:
        "Always include listing_url, retailer, price_usd, hazard_type, and cpsc_url in results. " +
        "These are live purchasable listings of federally recalled products. Show the CPSC recall URL and the live listing URL for every result.",
    },
  });

  // ---- Tool 2: parameterized ES|QL for aggregate questions ----
  console.log(`\nCreating deadstock-by-hazard (esql)...`);
  await createTool({
    id: "deadstock-by-hazard",
    type: "esql",
    description:
      "Count recalled-but-still-purchasable products grouped by hazard type and retailer. " +
      "Use for 'how many', 'which category', 'break down by hazard', 'longest still listed' questions.",
    configuration: {
      query:
        "FROM deadstock-matches " +
        "| WHERE days_since_recall >= ?min_days " +
        "| STATS still_listed = COUNT(*), avg_price = ROUND(AVG(price_usd), 2), oldest_recall_days = MAX(days_since_recall) " +
        "  BY hazard_type, retailer " +
        "| SORT still_listed DESC " +
        "| LIMIT ?limit",
      params: {
        min_days: { type: "integer", description: "Only count products recalled at least this many days ago. Use 0 for all." },
        limit: { type: "integer", description: "Max rows. Default 25." },
      },
    },
  });

  // -------- Agent --------
  console.log(`\nCreating deadstock-agent...`);
  await createAgent({
    id: "deadstock-agent",
    name: "Deadstock",
    description: "Answers questions about federally recalled products that are still purchasable online right now.",
    avatar_symbol: "🛒",
    avatar_color: "#E5484D",
    labels: ["recalls", "consumer-safety"],
    configuration: {
      instructions:
        "You are Deadstock. You have access to a live index joining the US CPSC recall database " +
        "against product listings scraped minutes ago from Amazon. Every record represents a " +
        "product the federal government recalled that a consumer can still buy today.\n\n" +
        "Rules:\n" +
        "- Always cite the CPSC recall URL and the live listing URL. Both. Every time.\n" +
        "- Lead with the number, then the examples. 'Eleven. Here are the three worst.'\n" +
        "- State the hazard in plain language. Say 'can catch fire', not 'thermal event'.\n" +
        "- These matches are algorithmic. If confidence is 'low', say so.\n" +
        "- Never tell a user a product is safe. You only know what is listed, not what is verified.\n" +
        "- Be direct and brief. No preamble.",
      tools: [
        {
          tool_ids: [
            "deadstock-search",
            "deadstock-by-hazard",
            "platform.core.search",
            "platform.core.execute_esql",
            "platform.core.list_indices",
          ],
        },
      ],
    },
  });

  console.log(
    `\n✓ Done. Open Kibana -> Agent Builder / AI Assistant, pick "Deadstock" and try:\n` +
    `  - "How many recalled products are still for sale on Amazon?"\n` +
    `  - "Show me the tip-over hazards recalled longest ago that are still listed."\n` +
    `  - "Break down still-purchasable recalls by hazard type."\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
