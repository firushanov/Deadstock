// Apify client + per-retailer callers.
// Amazon: santamaria-automations (echoes searchQuery -- one bulk call).
// Walmart, eBay: automation-lab (no searchQuery echo -- one call per keyword,
// batched in parallel and tagged client-side).

import { ApifyClient } from "apify-client";
import { requireEnv, optionalEnv } from "./env.ts";
import type { RawAmazonListing, RawWalmartListing, RawEbayListing } from "./types.ts";

export const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });

export const AMAZON_ACTOR = "santamaria-automations/amazon-search-scraper";
export const AMAZON_FALLBACK = "automation-lab/amazon-scraper";
export const WALMART_ACTOR = "automation-lab/walmart-scraper";
export const EBAY_ACTOR = "automation-lab/ebay-scraper";

type RunMeta = { runId: string; status: string; usageUsd: number | null };
export type AmazonRunResult = { items: RawAmazonListing[] } & RunMeta;
export type WalmartRunResult = { items: RawWalmartListing[]; query: string } & RunMeta;
export type EbayRunResult = { items: RawEbayListing[]; query: string } & RunMeta;

function runMeta(run: { id: string; status: string }): RunMeta {
  return {
    runId: run.id,
    status: run.status,
    usageUsd: (run as unknown as { usageTotalUsd?: number }).usageTotalUsd ?? null,
  };
}

function maxCharge(): number {
  return Number(optionalEnv("APIFY_MAX_CHARGE_USD", "3.00"));
}

// One call per batch of queries. santamaria echoes searchQuery on each item so we
// can send many keywords in a single run and demultiplex client-side.
export async function scrapeAmazon(searchQueries: string[], maxResultsPerQuery = 20): Promise<AmazonRunResult> {
  const run = await apify.actor(AMAZON_ACTOR).call(
    { searchQueries, marketplace: "US", maxResultsPerQuery, sortBy: "relevance" },
    { timeout: 900, maxTotalChargeUsd: maxCharge() },
  );
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Amazon run ${run.id} ended ${run.status} (https://console.apify.com/actors/runs/${run.id})`);
  }
  const dataset = await apify.dataset(run.defaultDatasetId).listItems();
  return { items: dataset.items as unknown as RawAmazonListing[], ...runMeta(run) };
}

// One keyword per call (automation-lab actors don't echo the query). Caller
// batches these with a concurrency pool.
export async function scrapeWalmartOne(query: string, maxProductsPerSearch = 10): Promise<WalmartRunResult> {
  const run = await apify.actor(WALMART_ACTOR).call(
    { searchQueries: [query], maxProductsPerSearch, maxSearchPages: 1, sort: "best_match", maxRequestRetries: 5 },
    { timeout: 900, maxTotalChargeUsd: maxCharge() },
  );
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Walmart run ${run.id} ended ${run.status} (query="${query}") (https://console.apify.com/actors/runs/${run.id})`);
  }
  const dataset = await apify.dataset(run.defaultDatasetId).listItems();
  return { items: dataset.items as unknown as RawWalmartListing[], query, ...runMeta(run) };
}

export async function scrapeEbayOne(query: string, maxProductsPerSearch = 15): Promise<EbayRunResult> {
  const run = await apify.actor(EBAY_ACTOR).call(
    {
      searchQueries: [query],
      maxProductsPerSearch,
      maxSearchPages: 1,
      sort: "best_match",
      listingType: "all",
      condition: ["new"],
      maxRequestRetries: 5,
    },
    { timeout: 900, maxTotalChargeUsd: maxCharge() },
  );
  if (run.status !== "SUCCEEDED") {
    throw new Error(`eBay run ${run.id} ended ${run.status} (query="${query}") (https://console.apify.com/actors/runs/${run.id})`);
  }
  const dataset = await apify.dataset(run.defaultDatasetId).listItems();
  return { items: dataset.items as unknown as RawEbayListing[], query, ...runMeta(run) };
}

// Fixed-size promise pool. Kept in this file so scrape script stays simple.
export async function poolAll<I, O>(
  inputs: I[],
  worker: (input: I, i: number) => Promise<O>,
  concurrency = 5,
): Promise<O[]> {
  const out: O[] = new Array(inputs.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= inputs.length) return;
      out[i] = await worker(inputs[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, run));
  return out;
}

// Guard: eBay-style foreign-currency drift can happen anywhere. Only accept a clean leading $.
export function parseUsdPrice(raw?: string, value?: number): number | null {
  if (raw && /^\s*\$/.test(raw)) {
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  // Only trust the numeric value when a raw string wasn't provided (santamaria always
  // sets raw for Amazon, so this is defensive not primary).
  if (!raw && typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}
