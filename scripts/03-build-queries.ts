// 03-build-queries.ts
//
// For each of the top 20 recalls, build ONE generic shopper-phrase query. Not the
// recall's official name -- that has weird brand tokens and dimensions the listing
// won't repeat.  <=6 words, no dimensions, no boilerplate.
//
// Print the queries. This is the last cheap step before we spend Apify credit.
// Eyeball them: if a query is nonsense, the scrape will return nonsense.

import "./lib/env.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./lib/env.ts";
import type { Recall, QuerySpec } from "./lib/types.ts";

const IN = resolve(DATA_DIR, "02-recalls-normalized.json");
const OUT = resolve(DATA_DIR, "03-queries.json");

const NOISE_WORDS = /\b(recalled|model|series|style|version|edition|type|item|w\/|with)\b/gi;
const DIMENSIONS_RE = /\b\d+(\.\d+)?\s*(inch|inches|in|"|cm|mm|lb|lbs|oz|ft|kg|g|ml|l|liter|litre|piece|pieces|pcs|pack)\b/gi;
const STOP_TOKENS = new Set(["and", "or", "the", "for", "of", "in", "on", "with", "a", "an"]);

function buildQuery(product: string): string {
  const cleaned = product
    // Strip smart and straight quotes
    .replace(/["""''‛‟]/g, "")
    // Drop dimensions
    .replace(DIMENSIONS_RE, "")
    // Drop noisy words
    .replace(NOISE_WORDS, "")
    // Collapse whitespace and punctuation
    .replace(/[|,;:/()\[\]]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 1 && !STOP_TOKENS.has(t.toLowerCase()));
  return tokens.slice(0, 6).join(" ").trim();
}

function main() {
  const recalls = JSON.parse(readFileSync(IN, "utf8")) as Recall[];
  const specs: QuerySpec[] = recalls.map((r) => ({
    recall_id: r.recall_id,
    query: buildQuery(r.product_name),
  }));

  writeFileSync(OUT, JSON.stringify(specs, null, 2), "utf8");
  console.log(`✓ Wrote ${specs.length} queries -> ${OUT}`);
  console.log(`\nEyeball these BEFORE spending money:\n`);
  for (let i = 0; i < specs.length; i++) {
    const r = recalls[i];
    console.log(
      `  ${String(i + 1).padStart(2)}. ${specs[i].query.padEnd(40)}  ` +
      `${r.hazard_type.padEnd(10)}  ` +
      `<- ${r.product_name.slice(0, 55)}`,
    );
  }

  // Sanity checks
  const empty = specs.filter((s) => s.query.length < 3);
  if (empty.length) {
    console.log(`\n⚠ ${empty.length} query is too short (<3 chars). Investigate.`);
  }
  const dupeCount = specs.length - new Set(specs.map((s) => s.query)).size;
  if (dupeCount > 0) {
    console.log(`⚠ ${dupeCount} duplicate query strings. Consider deduplicating before scrape.`);
  }
  console.log(`\nNext: npm run scrape (Amazon-only, ~$0.40 spend at 20 queries * 20 results * $0.001)`);
}

main();
