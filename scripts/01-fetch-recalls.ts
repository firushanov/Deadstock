// 01-fetch-recalls.ts
//
// Fetch the last 24 months of CPSC recalls. That's ~877 records / 2.7 MB on 2026-07-31.
// Skips the network if data/01-recalls-raw.json already exists (pass --force to refetch).
//
// Traps (see CLAUDE.md §7):
//   1. Unknown params are silently ignored -- a lowercase-r typo returns all 9,927
//      records. We assert length < 2000.
//   2. Errors return HTTP 200 with a single poison record {RecallID:0, ...}. Guard for
//      RecallID===0.

import "./lib/env.ts";
import { writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./lib/env.ts";
import type { RawRecall } from "./lib/types.ts";

const OUT = resolve(DATA_DIR, "01-recalls-raw.json");
const force = process.argv.includes("--force");

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  if (existsSync(OUT) && !force) {
    const bytes = statSync(OUT).size;
    console.log(`✓ Cached: ${OUT} (${(bytes / 1024 / 1024).toFixed(2)} MB). Pass --force to refetch.`);
    return;
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(end.getUTCFullYear() - 2);
  const url = `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${ymd(start)}&RecallDateEnd=${ymd(end)}`;

  console.log(`GET ${url}`);
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { "Accept-Encoding": "gzip", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const data = (await res.json()) as unknown;
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // -------- Trap guards --------
  if (!Array.isArray(data)) throw new Error(`Expected JSON array, got ${typeof data}`);
  if (data.length === 0) throw new Error(`Empty result -- likely wrong date range`);
  if (data.length >= 2000) {
    throw new Error(
      `Got ${data.length} records back -- CPSC silently ignored our date params. ` +
      `A typo in RecallDateStart/RecallDateEnd would do this. Check the URL.`,
    );
  }
  const first = data[0] as Partial<RawRecall>;
  if (first.RecallID === 0 || String(first.Title ?? "").startsWith("Error retrieving Recalls")) {
    throw new Error(`CPSC returned an error poison record (HTTP 200): ${first.Title}`);
  }

  writeFileSync(OUT, JSON.stringify(data, null, 2), "utf8");
  const bytes = statSync(OUT).size;
  console.log(
    `✓ Fetched ${data.length} recalls in ${elapsed}s -> ${OUT} (${(bytes / 1024 / 1024).toFixed(2)} MB)`,
  );
  console.log(
    `  date range ${(data.at(-1) as RawRecall).RecallDate.slice(0, 10)} ` +
    `.. ${(data[0] as RawRecall).RecallDate.slice(0, 10)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
