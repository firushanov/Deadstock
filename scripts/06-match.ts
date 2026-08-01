// 06-match.ts
//
// For each recall, run two searches over deadstock-listings filtered to that recall's
// own scraped listings:
//   A. Semantic:  match on title_semantic  <- what Elastic can do
//   B. Keyword:   match on title, operator=AND  <- what everyone else can do
//
// A hit from A is a candidate match. found_by_keyword := this same listing_id
// also appeared in B's top hits. That boolean powers the whole demo contrast.
//
// Threshold: keep semantic hits with score >= 2.0 (tuned by hand). Confidence:
//   high   if score >= 6 AND (brand token in title OR strong keyword hit)
//   medium if score >= 4
//   low    otherwise
// Cap: 5 matches per recall (we don't want the wall to be all one product).

import "./lib/env.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { es, INDEX } from "./lib/es.ts";
import { DATA_DIR } from "./lib/env.ts";
import type { Recall, Listing, Match } from "./lib/types.ts";

const RECALLS_IN = resolve(DATA_DIR, "02-recalls-normalized.json");
const LISTINGS_IN = resolve(DATA_DIR, "05-listings-normalized.json");
const OUT = resolve(DATA_DIR, "06-matches.json");
// Jina v5 text-small (the pinned model on serverless) returns cosine-like scores
// in the 0.6-0.95 range. Empirically 0.65 is the point where hits stop being
// meaningfully related. ELSER returns 4-8; DO NOT reuse those numbers here.
const SEMANTIC_THRESHOLD = 0.65;
const CAP_PER_RECALL = 5;

type Hit = { _id?: string; _score?: number | null; _source?: unknown };

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function confidenceOf(score: number, brand: string | null, listingTitle: string, keywordScore: number): Match["confidence"] {
  const brandHit = brand ? new RegExp(`\\b${brand.replace(/[^A-Za-z0-9]+/g, ".?")}\\b`, "i").test(listingTitle) : false;
  // Jina v5 cosine ranges: high >=0.82 with brand OR keyword corroboration; medium >=0.72; low otherwise.
  if (score >= 0.82 && (brandHit || keywordScore > 0)) return "high";
  if (score >= 0.72) return "medium";
  return "low";
}

async function main() {
  const recalls = JSON.parse(readFileSync(RECALLS_IN, "utf8")) as Recall[];
  const listings = JSON.parse(readFileSync(LISTINGS_IN, "utf8")) as Listing[];
  const listingById = new Map<string, Listing>();
  for (const l of listings) listingById.set(`${l.source_recall}::${l.listing_id}`, l);

  const matches: Match[] = [];
  let semHits = 0;
  let kwHits = 0;
  let bothHits = 0;

  for (const recall of recalls) {
    // Query text: product name + brand -- this is the shopper phrase we'd search for
    const semanticQueryText = [recall.product_name, recall.brand].filter(Boolean).join(" ").slice(0, 500);
    const keywordQueryText = recall.product_name;

    // A. Semantic
    const semanticResp = await es.search({
      index: INDEX.listings,
      query: {
        bool: {
          must: [{ match: { title_semantic: semanticQueryText } }],
          filter: [{ term: { source_recall: recall.recall_id } }],
        },
      },
      _source: { excludes: ["title_semantic"] },
      size: 10,
    });

    // B. Keyword-only (AND operator makes it deliberately fair, not rigged)
    const keywordResp = await es.search({
      index: INDEX.listings,
      query: {
        bool: {
          must: [{ match: { title: { query: keywordQueryText, operator: "and" } } }],
          filter: [{ term: { source_recall: recall.recall_id } }],
        },
      },
      _source: { excludes: ["title_semantic"] },
      size: 10,
    });

    const semHitsArr = (semanticResp.hits.hits as Hit[]).filter(
      (h) => typeof h._score === "number" && h._score >= SEMANTIC_THRESHOLD,
    );
    const kwHitsArr = keywordResp.hits.hits as Hit[];
    const keywordScoreById = new Map<string, number>();
    for (const h of kwHitsArr) if (h._id) keywordScoreById.set(h._id, h._score ?? 0);

    semHits += semHitsArr.length;
    kwHits += kwHitsArr.length;

    let kept = 0;
    for (const h of semHitsArr) {
      if (kept >= CAP_PER_RECALL) break;
      if (!h._id) continue;
      const l = listingById.get(h._id);
      if (!l) continue;
      const kwScore = keywordScoreById.get(h._id) ?? 0;
      const foundByKeyword = kwScore > 0;
      if (foundByKeyword) bothHits++;
      const conf = confidenceOf(h._score ?? 0, recall.brand, l.title, kwScore);

      matches.push({
        match_id: `${recall.recall_id}::${l.listing_id}`,
        recall_id: recall.recall_id,
        recall_number: recall.recall_number,
        recall_date: recall.recall_date,
        recall_title: recall.title,
        recall_product: recall.product_name,
        recall_image: recall.image_url,
        cpsc_url: recall.cpsc_url,
        brand: recall.brand,
        hazard_type: recall.hazard_type,
        hazard_text: recall.hazard_text,
        injury_severity: recall.injury_severity,
        listing_id: l.listing_id,
        listing_title: l.title,
        listing_url: l.url,
        listing_image: l.image_url,
        retailer: l.retailer,
        price_usd: l.price_usd,
        seller: l.seller,
        semantic_score: Number((h._score ?? 0).toFixed(3)),
        keyword_score: Number(kwScore.toFixed(3)),
        found_by_keyword: foundByKeyword,
        confidence: conf,
        days_since_recall: daysSince(recall.recall_date),
        matched_at: new Date().toISOString(),
      });
      kept++;
    }
  }

  writeFileSync(OUT, JSON.stringify(matches, null, 2), "utf8");
  console.log(
    `\n✓ Built ${matches.length} matches ` +
    `(sem-only=${matches.filter((m) => !m.found_by_keyword).length}, ` +
    `also-kw=${matches.filter((m) => m.found_by_keyword).length})`,
  );

  console.log(`\nDistribution:`);
  console.log(`  Confidence: ` + summarizeBy(matches, (m) => m.confidence));
  console.log(`  Hazard    : ` + summarizeBy(matches, (m) => m.hazard_type));

  console.log(`\nSemantic-only wins (the demo money shot -- keyword found nothing):`);
  const semOnly = matches
    .filter((m) => !m.found_by_keyword)
    .sort((a, b) => b.semantic_score - a.semantic_score)
    .slice(0, 8);
  for (const m of semOnly) {
    console.log(
      `  score=${m.semantic_score.toFixed(2)}  ${m.hazard_type.padEnd(10)}  ` +
      `${m.recall_product.slice(0, 45).padEnd(45)}  vs  ${m.listing_title.slice(0, 60)}`,
    );
  }

  // -------- Bulk index into deadstock-matches --------
  console.log(`\nBulk-indexing ${matches.length} matches into ${INDEX.matches}...`);
  await es.helpers.bulk({
    datasource: matches,
    onDocument: (doc) => ({ index: { _index: INDEX.matches, _id: doc.match_id } }),
    flushBytes: 1_000_000,
    concurrency: 1,
    retries: 5,
    onDrop: (doc) => console.error(`  dropped`, doc),
  });
  await es.indices.refresh({ index: INDEX.matches });
  const count = await es.count({ index: INDEX.matches });
  console.log(`✓ ${INDEX.matches} count: ${count.count}`);

  console.log(`\nSanity ES|QL peek (top 5 by days_since_recall):`);
  const esqlResp = await es.esql.query({
    query: `FROM ${INDEX.matches} | SORT days_since_recall DESC | KEEP recall_product, retailer, price_usd, hazard_type, days_since_recall, confidence | LIMIT 5`,
  });
  const rows = (esqlResp as unknown as { values: unknown[][]; columns: { name: string }[] });
  console.log(`  cols: ${rows.columns.map((c) => c.name).join(" | ")}`);
  for (const row of rows.values) console.log(`  ${row.map((v) => String(v)).join(" | ")}`);
}

function summarizeBy<T>(rows: T[], key: (r: T) => string): string {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
