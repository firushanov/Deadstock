// 04-scrape.ts
//
// Amazon-only tonight (CLAUDE.md §5). One call to santamaria with all 20 queries.
// santamaria echoes searchQuery on each item so we demultiplex client-side into
// per-recall buckets.
//
// Cost estimate at 20 queries * 20 results * $0.001 = $0.40. Coupon has $50.

import "./lib/env.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./lib/env.ts";
import { scrapeAmazon, parseUsdPrice } from "./lib/apify.ts";
import type { QuerySpec, Listing, RawAmazonListing } from "./lib/types.ts";

const IN = resolve(DATA_DIR, "03-queries.json");
const RAW_OUT = resolve(DATA_DIR, "04-listings-raw.json");
const NORM_OUT = resolve(DATA_DIR, "05-listings-normalized.json");
const force = process.argv.includes("--force");

function normalizeListing(raw: RawAmazonListing, sourceRecall: string): Listing | null {
  if (!raw.asin || !raw.title || !raw.url) return null;
  return {
    listing_id: raw.asin,
    retailer: "amazon",
    title: raw.title,
    price_usd: parseUsdPrice(raw.price?.raw, raw.price?.value),
    url: raw.url,
    image_url: raw.thumbnailImage ?? null,
    seller: null, // santamaria doesn't provide seller on search results
    rating: typeof raw.stars === "number" ? raw.stars : null,
    review_count: typeof raw.reviewsCount === "number" ? raw.reviewsCount : null,
    is_sponsored: Boolean(raw.isSponsored),
    source_query: raw.searchQuery ?? "",
    source_recall: sourceRecall,
    scraped_at: raw.scrapedAt ?? new Date().toISOString(),
  };
}

async function main() {
  if (existsSync(RAW_OUT) && !force) {
    console.log(`✓ Cached: ${RAW_OUT}. Pass --force to rescrape.`);
    // Still (re)normalize -- cheap
    const raw = JSON.parse(readFileSync(RAW_OUT, "utf8")) as { items: RawAmazonListing[] };
    const queries = JSON.parse(readFileSync(IN, "utf8")) as QuerySpec[];
    renormalize(raw.items, queries);
    return;
  }

  const queries = JSON.parse(readFileSync(IN, "utf8")) as QuerySpec[];
  const uniqueQueries = [...new Set(queries.map((q) => q.query))];
  console.log(`Scraping Amazon: ${uniqueQueries.length} unique queries...`);

  const t0 = Date.now();
  const result = await scrapeAmazon(uniqueQueries, 20);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  writeFileSync(RAW_OUT, JSON.stringify(result, null, 2), "utf8");
  console.log(
    `✓ Amazon: ${result.items.length} results in ${elapsed}s ` +
    `(runId=${result.runId}, usage=$${result.usageUsd?.toFixed(4) ?? "?"})`,
  );
  renormalize(result.items, queries);
}

function renormalize(items: RawAmazonListing[], queries: QuerySpec[]) {
  // Build query -> recall_id lookup. Multiple recalls could share a query string in
  // theory; take the first (we dedupe queries above, so this is rare).
  const queryToRecall = new Map<string, string>();
  for (const q of queries) if (!queryToRecall.has(q.query)) queryToRecall.set(q.query, q.recall_id);

  const normalized: Listing[] = [];
  let sponsored = 0;
  let missingRecall = 0;
  let missingPrice = 0;
  for (const raw of items) {
    const sq = raw.searchQuery ?? "";
    const recallId = queryToRecall.get(sq);
    if (!recallId) {
      missingRecall++;
      continue;
    }
    const norm = normalizeListing(raw, recallId);
    if (!norm) continue;
    if (norm.is_sponsored) {
      sponsored++;
      continue; // drop ads
    }
    if (norm.price_usd === null) missingPrice++;
    normalized.push(norm);
  }

  writeFileSync(NORM_OUT, JSON.stringify(normalized, null, 2), "utf8");
  console.log(
    `✓ Normalized ${normalized.length} listings (dropped ${sponsored} sponsored, ` +
    `${missingRecall} without recall tag, ${missingPrice} without USD price kept as null) -> ${NORM_OUT}`,
  );

  // Per-recall coverage
  console.log(`\nCoverage per query (listing count):`);
  const perRecall = new Map<string, number>();
  for (const l of normalized) perRecall.set(l.source_recall, (perRecall.get(l.source_recall) ?? 0) + 1);
  for (const q of queries) {
    const n = perRecall.get(q.recall_id) ?? 0;
    const marker = n === 0 ? "⚠" : n < 5 ? "·" : "✓";
    console.log(`  ${marker} recall=${q.recall_id.padEnd(6)} count=${String(n).padStart(3)}  <- "${q.query}"`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
