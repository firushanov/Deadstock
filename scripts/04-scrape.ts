// 04-scrape.ts
//
// Amazon + Walmart + eBay.
//   Amazon (santamaria)  : one bulk call, echoes searchQuery per item.
//   Walmart (auto-lab)   : one call per keyword (no echo), pooled at concurrency=5.
//   eBay    (auto-lab)   : same as Walmart, plus USD-currency guard (COP drift trap).
//
// Per-retailer raw caches:
//   data/04-amazon-raw.json   { items, runId, status, usageUsd }
//   data/04-walmart-raw.json  [ { query, items, runId, status, usageUsd }, ... ]
//   data/04-ebay-raw.json     [ same shape ]
//
// Combined normalized listings -> data/05-listings-normalized.json.
//
// Flags:
//   --force              rescrape everything
//   --only=amazon,ebay   restrict to a subset of retailers (comma list)
//   --skip=walmart       skip a subset
//
// Cost ceiling: APIFY_MAX_CHARGE_USD (default $3) applies per actor call.

import "./lib/env.ts";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./lib/env.ts";
import {
  scrapeAmazon,
  scrapeWalmartOne,
  scrapeEbayOne,
  parseUsdPrice,
  poolAll,
} from "./lib/apify.ts";
import type {
  QuerySpec,
  Listing,
  Retailer,
  RawAmazonListing,
  RawWalmartListing,
  RawEbayListing,
} from "./lib/types.ts";

const IN = resolve(DATA_DIR, "03-queries.json");
const AMAZON_RAW = resolve(DATA_DIR, "04-amazon-raw.json");
const AMAZON_RAW_LEGACY = resolve(DATA_DIR, "04-listings-raw.json"); // pre-multi-retailer name
const WALMART_RAW = resolve(DATA_DIR, "04-walmart-raw.json");
const EBAY_RAW = resolve(DATA_DIR, "04-ebay-raw.json");
const NORM_OUT = resolve(DATA_DIR, "05-listings-normalized.json");

const force = process.argv.includes("--force");
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const skipArg = process.argv.find((a) => a.startsWith("--skip="))?.slice("--skip=".length);
const enabled: Record<Retailer, boolean> = (() => {
  const all: Retailer[] = ["amazon", "walmart", "ebay"];
  const only = onlyArg ? new Set(onlyArg.split(",").map((s) => s.trim())) : null;
  const skip = skipArg ? new Set(skipArg.split(",").map((s) => s.trim())) : new Set<string>();
  return Object.fromEntries(all.map((r) => [r, (!only || only.has(r)) && !skip.has(r)])) as Record<Retailer, boolean>;
})();

// One-time migration: preserve the pre-multi-retailer Amazon cache.
if (existsSync(AMAZON_RAW_LEGACY) && !existsSync(AMAZON_RAW)) {
  renameSync(AMAZON_RAW_LEGACY, AMAZON_RAW);
  console.log(`✓ Migrated ${AMAZON_RAW_LEGACY} -> ${AMAZON_RAW}`);
}

// ---------- Normalizers (one per retailer) ----------

function normAmazon(raw: RawAmazonListing, sourceRecall: string): Listing | null {
  if (!raw.asin || !raw.title || !raw.url) return null;
  return {
    listing_id: raw.asin,
    retailer: "amazon",
    title: raw.title,
    price_usd: parseUsdPrice(raw.price?.raw, raw.price?.value),
    url: raw.url,
    image_url: raw.thumbnailImage ?? null,
    seller: null,
    rating: typeof raw.stars === "number" ? raw.stars : null,
    review_count: typeof raw.reviewsCount === "number" ? raw.reviewsCount : null,
    is_sponsored: Boolean(raw.isSponsored),
    source_query: raw.searchQuery ?? "",
    source_recall: sourceRecall,
    scraped_at: raw.scrapedAt ?? new Date().toISOString(),
  };
}

function normWalmart(raw: RawWalmartListing, query: string, sourceRecall: string): Listing | null {
  if (!raw.usItemId || !raw.name || !raw.url) return null;
  return {
    listing_id: raw.usItemId,
    retailer: "walmart",
    title: raw.name,
    price_usd: parseUsdPrice(raw.priceString, raw.price),
    url: raw.url,
    image_url: raw.thumbnail ?? null,
    seller: raw.seller ?? null,
    rating: typeof raw.rating === "number" ? raw.rating : null,
    review_count: typeof raw.reviewCount === "number" ? raw.reviewCount : null,
    is_sponsored: Boolean(raw.isSponsored),
    source_query: query,
    source_recall: sourceRecall,
    scraped_at: raw.scrapedAt ?? new Date().toISOString(),
  };
}

function normEbay(raw: RawEbayListing, query: string, sourceRecall: string): Listing | null {
  if (!raw.itemId || !raw.title || !raw.url) return null;
  return {
    listing_id: raw.itemId,
    retailer: "ebay",
    title: raw.title,
    price_usd: parseUsdPrice(raw.priceString, raw.price), // ⚠ drops non-USD (COP trap)
    url: raw.url,
    image_url: raw.thumbnail ?? null,
    seller: raw.sellerName ?? null,
    rating: null, // eBay doesn't give per-listing rating in search
    review_count: null,
    is_sponsored: Boolean(raw.isSponsored),
    source_query: query,
    source_recall: sourceRecall,
    scraped_at: raw.scrapedAt ?? new Date().toISOString(),
  };
}

// ---------- Per-retailer runners (cache-aware) ----------

async function runAmazon(queries: QuerySpec[]): Promise<Listing[]> {
  const queryToRecall = new Map<string, string>();
  for (const q of queries) if (!queryToRecall.has(q.query)) queryToRecall.set(q.query, q.recall_id);

  let raw: { items: RawAmazonListing[] };
  if (existsSync(AMAZON_RAW) && !force) {
    console.log(`✓ Amazon cached: ${AMAZON_RAW}`);
    raw = JSON.parse(readFileSync(AMAZON_RAW, "utf8"));
  } else {
    const uniq = [...new Set(queries.map((q) => q.query))];
    console.log(`Scraping Amazon: ${uniq.length} unique queries...`);
    const t0 = Date.now();
    const result = await scrapeAmazon(uniq, 20);
    console.log(`  ✓ Amazon: ${result.items.length} items in ${((Date.now() - t0) / 1000).toFixed(1)}s ($${result.usageUsd?.toFixed(4) ?? "?"})`);
    writeFileSync(AMAZON_RAW, JSON.stringify(result, null, 2), "utf8");
    raw = result;
  }

  const out: Listing[] = [];
  let dropped = 0, sponsored = 0;
  for (const item of raw.items) {
    const recallId = queryToRecall.get(item.searchQuery ?? "");
    if (!recallId) { dropped++; continue; }
    const n = normAmazon(item, recallId);
    if (!n) continue;
    if (n.is_sponsored) { sponsored++; continue; }
    out.push(n);
  }
  console.log(`  Amazon normalized: ${out.length} kept (${sponsored} sponsored, ${dropped} no-recall)`);
  return out;
}

async function runWalmart(queries: QuerySpec[]): Promise<Listing[]> {
  const uniq = [...new Set(queries.map((q) => q.query))];
  const queryToRecall = new Map<string, string>();
  for (const q of queries) if (!queryToRecall.has(q.query)) queryToRecall.set(q.query, q.recall_id);

  let runs: Array<{ query: string; items: RawWalmartListing[]; runId: string; usageUsd: number | null }>;
  if (existsSync(WALMART_RAW) && !force) {
    console.log(`✓ Walmart cached: ${WALMART_RAW}`);
    runs = JSON.parse(readFileSync(WALMART_RAW, "utf8"));
  } else {
    console.log(`Scraping Walmart: ${uniq.length} keywords (concurrency 5)...`);
    const t0 = Date.now();
    runs = await poolAll(uniq, (q) => scrapeWalmartOne(q, 10), 5);
    const usd = runs.reduce((s, r) => s + (r.usageUsd ?? 0), 0);
    const total = runs.reduce((s, r) => s + r.items.length, 0);
    console.log(`  ✓ Walmart: ${total} items across ${runs.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s ($${usd.toFixed(4)})`);
    writeFileSync(WALMART_RAW, JSON.stringify(runs, null, 2), "utf8");
  }

  const out: Listing[] = [];
  let sponsored = 0, missingRecall = 0;
  for (const r of runs) {
    const recallId = queryToRecall.get(r.query);
    if (!recallId) { missingRecall += r.items.length; continue; }
    for (const item of r.items) {
      const n = normWalmart(item, r.query, recallId);
      if (!n) continue;
      if (n.is_sponsored) { sponsored++; continue; }
      out.push(n);
    }
  }
  console.log(`  Walmart normalized: ${out.length} kept (${sponsored} sponsored, ${missingRecall} orphan)`);
  return out;
}

async function runEbay(queries: QuerySpec[]): Promise<Listing[]> {
  const uniq = [...new Set(queries.map((q) => q.query))];
  const queryToRecall = new Map<string, string>();
  for (const q of queries) if (!queryToRecall.has(q.query)) queryToRecall.set(q.query, q.recall_id);

  let runs: Array<{ query: string; items: RawEbayListing[]; runId: string; usageUsd: number | null }>;
  if (existsSync(EBAY_RAW) && !force) {
    console.log(`✓ eBay cached: ${EBAY_RAW}`);
    runs = JSON.parse(readFileSync(EBAY_RAW, "utf8"));
  } else {
    console.log(`Scraping eBay: ${uniq.length} keywords (concurrency 5)...`);
    const t0 = Date.now();
    runs = await poolAll(uniq, (q) => scrapeEbayOne(q, 15), 5);
    const usd = runs.reduce((s, r) => s + (r.usageUsd ?? 0), 0);
    const total = runs.reduce((s, r) => s + r.items.length, 0);
    console.log(`  ✓ eBay: ${total} items across ${runs.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s ($${usd.toFixed(4)})`);
    writeFileSync(EBAY_RAW, JSON.stringify(runs, null, 2), "utf8");
  }

  const out: Listing[] = [];
  let sponsored = 0, foreignCurrency = 0, missingRecall = 0;
  for (const r of runs) {
    const recallId = queryToRecall.get(r.query);
    if (!recallId) { missingRecall += r.items.length; continue; }
    for (const item of r.items) {
      // Foreign-currency drift: keep the listing only if we could parse a USD price.
      // priceString like "COP $84,119.19" fails parseUsdPrice (leading COP, not $).
      const hadPriceString = typeof item.priceString === "string" && item.priceString.length > 0;
      const n = normEbay(item, r.query, recallId);
      if (!n) continue;
      if (hadPriceString && n.price_usd === null) { foreignCurrency++; continue; }
      if (n.is_sponsored) { sponsored++; continue; }
      out.push(n);
    }
  }
  console.log(`  eBay normalized: ${out.length} kept (${sponsored} sponsored, ${foreignCurrency} non-USD, ${missingRecall} orphan)`);
  return out;
}

// ---------- Main ----------

async function main() {
  const queries = JSON.parse(readFileSync(IN, "utf8")) as QuerySpec[];

  const active: Retailer[] = (["amazon", "walmart", "ebay"] as Retailer[]).filter((r) => enabled[r]);
  console.log(`Retailers active: ${active.join(", ") || "(none)"}\n`);

  const perRetailer: Partial<Record<Retailer, Listing[]>> = {};
  for (const r of active) {
    if (r === "amazon") perRetailer.amazon = await runAmazon(queries);
    if (r === "walmart") perRetailer.walmart = await runWalmart(queries);
    if (r === "ebay") perRetailer.ebay = await runEbay(queries);
    console.log("");
  }

  const combined: Listing[] = [
    ...(perRetailer.amazon ?? []),
    ...(perRetailer.walmart ?? []),
    ...(perRetailer.ebay ?? []),
  ];
  writeFileSync(NORM_OUT, JSON.stringify(combined, null, 2), "utf8");
  console.log(`✓ Normalized ${combined.length} listings -> ${NORM_OUT}`);
  console.log(
    `  by retailer: ` +
    (Object.entries(perRetailer) as Array<[Retailer, Listing[]]>)
      .map(([r, ls]) => `${r}=${ls.length}`)
      .join(" · "),
  );

  // Per-recall coverage: which recalls have zero listings anywhere?
  const perRecall = new Map<string, Map<Retailer, number>>();
  for (const l of combined) {
    if (!perRecall.has(l.source_recall)) perRecall.set(l.source_recall, new Map());
    const m = perRecall.get(l.source_recall)!;
    m.set(l.retailer, (m.get(l.retailer) ?? 0) + 1);
  }
  console.log(`\nCoverage per query (a/w/e per retailer):`);
  for (const q of queries) {
    const m = perRecall.get(q.recall_id) ?? new Map<Retailer, number>();
    const a = m.get("amazon") ?? 0, w = m.get("walmart") ?? 0, e = m.get("ebay") ?? 0;
    const total = a + w + e;
    const marker = total === 0 ? "⚠" : total < 5 ? "·" : "✓";
    console.log(
      `  ${marker} recall=${q.recall_id.padEnd(6)}  a=${String(a).padStart(2)} w=${String(w).padStart(2)} e=${String(e).padStart(2)}  <- "${q.query}"`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
