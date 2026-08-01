// 02-normalize-recalls.ts
//
// Flatten RawRecall -> Recall, filter to demo-relevant, take top 20 by recall_date.
// Writes data/02-recalls-normalized.json.
//
// Cut plan (CLAUDE.md §5) says top 20 not 40 (the full plan's number). Amazon only.
//
// "Demo-relevant" = Retailers[] mentions amazon/walmart/ebay OR the recall matches one
// of the three high-yield categories (children, furniture, batteries). Per plan §6,
// these three categories are 54% of the last-2-year corpus and 63% of Amazon mentions.

import "./lib/env.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_DIR } from "./lib/env.ts";
import { classifyHazard } from "./lib/hazard.ts";
import type { RawRecall, Recall } from "./lib/types.ts";

const IN = resolve(DATA_DIR, "01-recalls-raw.json");
const OUT = resolve(DATA_DIR, "02-recalls-normalized.json");
const TOP_N = 20;

const CHANNELS = ["amazon", "walmart", "ebay", "target", "wayfair", "costco", "temu", "shein", "home depot", "homedepot"];
const CATEGORY_RE = {
  children: /\b(children|infant|toddler|baby|kids?|toy|toys|crib|stroller|nursery|highchair|playpen|pacifier|sleep(?:wear|er)|swaddle)\b/i,
  furniture: /\b(dresser|chest of drawers|clothing storage|bunk bed|bed frame|shelving|bookshelf|nightstand|wardrobe)\b/i,
  battery: /\b(lithium|battery|batteries|power bank|charger|e-?bike|hoverboard|scooter)\b/i,
};

function extractBrand(r: RawRecall): string | null {
  const sources = [...(r.Importers ?? []), ...(r.Distributors ?? []), ...(r.Manufacturers ?? [])];
  for (const s of sources) {
    const dba = /\bdba\s+([^,]+)/i.exec(s.Name ?? "");
    if (dba) return dba[1].trim();
  }
  const first = r.Products?.[0]?.Name ?? "";
  const m = /^([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*)?)/.exec(first);
  return m ? m[1].trim() : null;
}

function findSoldAt(r: RawRecall): string[] {
  const blob = (r.Retailers ?? []).map((x) => x.Name).join(" | ").toLowerCase();
  const found = new Set<string>();
  for (const c of CHANNELS) if (blob.includes(c)) found.add(c.replace(/\s+/g, ""));
  return [...found];
}

function findPriceHint(r: RawRecall): number | null {
  const blob = (r.Retailers ?? []).map((x) => x.Name).join(" | ");
  const m = /\$([\d,]+(?:\.\d{2})?)/.exec(blob);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function injurySeverity(r: RawRecall): Recall["injury_severity"] {
  const combined = `${r.Title ?? ""} ${r.Hazards?.[0]?.Name ?? ""}`;
  if (/death|fatal|died|killed/i.test(combined)) return "death";
  const injNames = (r.Injuries ?? []).map((i) => i.Name?.toLowerCase() ?? "");
  const anyReported = injNames.some((n) => n && !n.includes("none reported") && !n.includes("no injuries"));
  if (anyReported) return "injury";
  return "none_reported";
}

function buildSearchText(product: string, brand: string | null, description: string): string {
  const parts = [product, brand ?? "", description].filter(Boolean);
  const joined = parts.join(". ").replace(/\s+/g, " ").trim();
  return joined.slice(0, 1200);
}

function relevantToDemo(r: RawRecall, soldAt: string[]): boolean {
  if (soldAt.some((c) => c === "amazon" || c === "walmart" || c === "ebay")) return true;
  const blob = `${r.Title ?? ""} ${r.Description ?? ""} ${r.Products?.[0]?.Name ?? ""}`;
  return CATEGORY_RE.children.test(blob) || CATEGORY_RE.furniture.test(blob) || CATEGORY_RE.battery.test(blob);
}

function normalize(r: RawRecall): Recall | null {
  const product = r.Products?.[0]?.Name?.trim();
  if (!product) return null;

  const soldAt = findSoldAt(r);
  if (!relevantToDemo(r, soldAt)) return null;

  const brand = extractBrand(r);
  const hazardText = r.Hazards?.[0]?.Name ?? "";
  const hz = classifyHazard(`${hazardText} ${r.Title ?? ""}`);

  return {
    recall_id: String(r.RecallID),
    recall_number: r.RecallNumber ?? null,
    recall_date: r.RecallDate,
    title: r.Title ?? "",
    product_name: product,
    brand,
    description: r.Description ?? "",
    hazard_text: hazardText,
    hazard_type: hz.type,
    hazard_label: hz.label,
    injury_severity: injurySeverity(r),
    remedy_option: r.RemedyOptions?.[0]?.Option ?? null,
    sold_at: soldAt,
    price_hint: findPriceHint(r),
    units: r.Products?.[0]?.NumberOfUnits ?? null,
    cpsc_url: r.URL,
    image_url: r.Images?.[0]?.URL ?? null,
    search_text: buildSearchText(product, brand, r.Description ?? ""),
  };
}

function main() {
  const raw = JSON.parse(readFileSync(IN, "utf8")) as RawRecall[];
  console.log(`Input: ${raw.length} raw recalls`);

  const normalized = raw.map(normalize).filter((x): x is Recall => x !== null);
  console.log(`After normalize + demo-relevance filter: ${normalized.length}`);

  // Amazon-only heuristic bias: prefer records that name Amazon in Retailers.
  // Not required, but the cut plan is Amazon-only so we want the top 20 to be
  // ones we have a real shot at matching.
  const scored = normalized.map((r) => ({
    r,
    // higher = better candidate
    score:
      (r.sold_at.includes("amazon") ? 100 : 0) +
      (r.sold_at.includes("walmart") ? 30 : 0) +
      (r.sold_at.includes("ebay") ? 20 : 0) +
      (r.injury_severity === "death" ? 10 : r.injury_severity === "injury" ? 5 : 0) +
      // recency: 0..30 based on date within the fetched window
      recencyScore(r.recall_date),
  }));

  scored.sort((a, b) => b.score - a.score || b.r.recall_date.localeCompare(a.r.recall_date));
  const top = scored.slice(0, TOP_N).map((s) => s.r);

  writeFileSync(OUT, JSON.stringify(top, null, 2), "utf8");
  console.log(`✓ Wrote top ${top.length} recalls -> ${OUT}`);

  console.log("\nHazard-type distribution across normalized set:");
  const dist = new Map<string, number>();
  for (const r of normalized) dist.set(r.hazard_type, (dist.get(r.hazard_type) ?? 0) + 1);
  const rows = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [t, n] of rows) console.log(`  ${t.padEnd(12)} ${String(n).padStart(4)}`);
  const otherPct = (dist.get("other") ?? 0) / normalized.length;
  if (otherPct > 0.15) {
    console.log(`⚠ "other" is ${(otherPct * 100).toFixed(0)}% -- consider adding hazard rules.`);
  }

  console.log(`\nTop ${top.length} preview (recall_date, hazard, sold_at, product):`);
  for (const r of top) {
    console.log(
      `  ${r.recall_date.slice(0, 10)}  ` +
      `${r.hazard_type.padEnd(10)}  ` +
      `[${r.sold_at.join(",") || "-"}]  `.padEnd(20) +
      `${r.product_name.slice(0, 60)}`,
    );
  }
}

function recencyScore(iso: string): number {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const daysAgo = (now - t) / 86400000;
  return Math.max(0, 30 - daysAgo / 24); // newer = higher, ~30 for today, ~0 for 2yr old
}

main();
