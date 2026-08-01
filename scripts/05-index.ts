// 05-index.ts
//
// Delete + recreate the three deadstock indices, then bulk-index recalls and listings.
// Idempotent: safe to rerun.
//
// The pinned inference_id (from data/00-inference-id.txt, verified 2026-08-01) is
// baked into the semantic_text mapping so Elastic can't quietly swap models on us
// mid-project (see CLAUDE.md §7 trap 3).
//
// Bulk settings tuned for semantic_text: concurrency:1, flushBytes:1MB, retries:5.
// Embedding happens inline inside the bulk request; over-limit -> 429s.

import "./lib/env.ts";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { es, INDEX } from "./lib/es.ts";
import { DATA_DIR, optionalEnv } from "./lib/env.ts";
import type { Recall, Listing } from "./lib/types.ts";

const RECALLS_IN = resolve(DATA_DIR, "02-recalls-normalized.json");
const LISTINGS_IN = resolve(DATA_DIR, "05-listings-normalized.json");
const INFERENCE_ID_FILE = resolve(DATA_DIR, "00-inference-id.txt");

function loadInferenceId(): string {
  const fromEnv = optionalEnv("ELASTIC_INFERENCE_ID", "");
  if (fromEnv) return fromEnv;
  if (!existsSync(INFERENCE_ID_FILE)) {
    throw new Error(`inference_id not pinned. Run npm run preflight first (or set ELASTIC_INFERENCE_ID).`);
  }
  return readFileSync(INFERENCE_ID_FILE, "utf8").trim();
}

async function recreateIndex(name: string, mappings: object) {
  console.log(`  ${name}: deleting if exists...`);
  await es.indices.delete({ index: name }, { ignore: [404] });
  console.log(`  ${name}: creating...`);
  await es.indices.create({ index: name, mappings });
}

async function main() {
  const inferenceId = loadInferenceId();
  console.log(`Using inference_id: ${inferenceId}`);

  // -------- Recreate indices --------
  console.log(`\nRecreating indices...`);
  await recreateIndex(INDEX.recalls, {
    properties: {
      recall_id: { type: "keyword" },
      recall_number: { type: "keyword" },
      recall_date: { type: "date" },
      title: { type: "text" },
      product_name: { type: "text" },
      brand: { type: "keyword" },
      description: { type: "text" },
      hazard_text: { type: "text" },
      hazard_type: { type: "keyword" },
      hazard_label: { type: "keyword" },
      injury_severity: { type: "keyword" },
      remedy_option: { type: "keyword" },
      sold_at: { type: "keyword" },
      price_hint: { type: "double" },
      units: { type: "keyword" },
      cpsc_url: { type: "keyword" },
      image_url: { type: "keyword" },
      search_text: { type: "semantic_text", inference_id: inferenceId },
    },
  });

  await recreateIndex(INDEX.listings, {
    properties: {
      listing_id: { type: "keyword" },
      retailer: { type: "keyword" },
      title: { type: "text" },
      title_semantic: { type: "semantic_text", inference_id: inferenceId },
      price_usd: { type: "double" },
      url: { type: "keyword" },
      image_url: { type: "keyword" },
      seller: { type: "keyword" },
      rating: { type: "float" },
      review_count: { type: "integer" },
      is_sponsored: { type: "boolean" },
      source_query: { type: "keyword" },
      source_recall: { type: "keyword" },
      scraped_at: { type: "date" },
    },
  });

  await recreateIndex(INDEX.matches, {
    properties: {
      match_id: { type: "keyword" },
      recall_id: { type: "keyword" },
      recall_number: { type: "keyword" },
      recall_date: { type: "date" },
      recall_title: { type: "text" },
      recall_product: { type: "text" },
      recall_image: { type: "keyword" },
      cpsc_url: { type: "keyword" },
      brand: { type: "keyword" },
      hazard_type: { type: "keyword" },
      hazard_label: { type: "keyword" },
      hazard_text: { type: "text" },
      injury_severity: { type: "keyword" },
      listing_id: { type: "keyword" },
      listing_title: { type: "text" },
      listing_url: { type: "keyword" },
      listing_image: { type: "keyword" },
      retailer: { type: "keyword" },
      price_usd: { type: "double" },
      seller: { type: "keyword" },
      semantic_score: { type: "float" },
      keyword_score: { type: "float" },
      found_by_keyword: { type: "boolean" },
      confidence: { type: "keyword" },
      days_since_recall: { type: "integer" },
      matched_at: { type: "date" },
    },
  });

  // -------- Bulk index recalls --------
  const recalls = JSON.parse(readFileSync(RECALLS_IN, "utf8")) as Recall[];
  console.log(`\nIndexing ${recalls.length} recalls (semantic_text will embed inline, be patient)...`);
  const t1 = Date.now();
  await es.helpers.bulk({
    datasource: recalls,
    onDocument: (doc) => ({ index: { _index: INDEX.recalls, _id: doc.recall_id } }),
    flushBytes: 1_000_000,
    concurrency: 1,
    retries: 5,
    onDrop: (doc) => console.error(`  dropped recall`, doc),
  });
  console.log(`  ✓ Recalls indexed in ${((Date.now() - t1) / 1000).toFixed(1)}s`);

  // -------- Bulk index listings --------
  const listings = JSON.parse(readFileSync(LISTINGS_IN, "utf8")) as Listing[];
  console.log(`\nIndexing ${listings.length} listings (semantic_text embedding, ~1-3 min)...`);
  const t2 = Date.now();

  // Duplicate title into title_semantic so the semantic field has content to embed.
  // We keep both because we want a plain-text 'title' for keyword search and a
  // semantic mirror for vector search over the same string.
  await es.helpers.bulk({
    datasource: listings.map((l) => ({ ...l, title_semantic: l.title })),
    onDocument: (doc) => ({
      index: { _index: INDEX.listings, _id: `${doc.source_recall}::${doc.listing_id}` },
    }),
    flushBytes: 1_000_000,
    concurrency: 1,
    retries: 5,
    onDrop: (doc) => console.error(`  dropped listing`, doc),
  });
  console.log(`  ✓ Listings indexed in ${((Date.now() - t2) / 1000).toFixed(1)}s`);

  // -------- Refresh --------
  await es.indices.refresh({ index: `${INDEX.recalls},${INDEX.listings}` });

  const recallsCount = await es.count({ index: INDEX.recalls });
  const listingsCount = await es.count({ index: INDEX.listings });
  console.log(
    `\n✓ Done. recalls: ${recallsCount.count}, listings: ${listingsCount.count}, matches: 0 (populated in phase 3b)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
