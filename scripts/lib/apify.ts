// Apify client + Amazon caller. Only Amazon tonight per CLAUDE.md §5.
// santamaria-automations echoes searchQuery per result, which is why we prefer it
// over automation-lab/amazon-scraper (fallback if santamaria breaks).

import { ApifyClient } from "apify-client";
import { requireEnv, optionalEnv } from "./env.ts";
import type { RawAmazonListing } from "./types.ts";

export const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });

export const AMAZON_ACTOR = "santamaria-automations/amazon-search-scraper";
export const AMAZON_FALLBACK = "automation-lab/amazon-scraper";

export type AmazonRunResult = {
  items: RawAmazonListing[];
  runId: string;
  status: string;
  usageUsd: number | null;
};

// One call per batch of queries. santamaria echoes searchQuery on each item so we
// can send many keywords in a single run and demultiplex client-side.
export async function scrapeAmazon(searchQueries: string[], maxResultsPerQuery = 20): Promise<AmazonRunResult> {
  const maxCharge = Number(optionalEnv("APIFY_MAX_CHARGE_USD", "3.00"));

  const input = {
    searchQueries,
    marketplace: "US",
    maxResultsPerQuery,
    sortBy: "relevance",
  };

  const run = await apify.actor(AMAZON_ACTOR).call(input, {
    timeout: 900,
    maxTotalChargeUsd: maxCharge,
  });

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Amazon scrape run ${run.id} ended ${run.status} (see https://console.apify.com/actors/runs/${run.id})`);
  }

  const dataset = await apify.dataset(run.defaultDatasetId).listItems();
  return {
    items: dataset.items as unknown as RawAmazonListing[],
    runId: run.id,
    status: run.status,
    usageUsd: (run as unknown as { usageTotalUsd?: number }).usageTotalUsd ?? null,
  };
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
