# DEADSTOCK — Build Plan & Agent Prompt

> **How to use this file.** Open this folder in VS Code and give Claude Code:
>
> *"Read CLAUDE.md then DEADSTOCK-BUILD-PLAN.md and build it. Follow the cut plan in CLAUDE.md §5, not the full phase list in §13. Stop after each phase and tell me what you verified."*
>
> Everything marked ✅ VERIFIED was tested live against the real API on 2026-07-31. Trust those. Everything marked ⚠️ is a known trap — read those twice.

---

## 1. What we are building, in one paragraph

The US government recalls products for being dangerous. Companies are supposed to pull them off the shelves. Many never come off. **Deadstock** proves it: it pulls the federal recall database, scrapes live listings from Amazon, Walmart, and eBay, and uses Elasticsearch semantic search to match the two. The output is a wall of cards — on the left, a product the government pulled; on the right, that same product, in stock, with a working Buy button.

The demo line is: **"This dresser was recalled because it can tip over and crush a child. Here it is, $140, ships tomorrow."**

⚠️ Do not claim a fatality unless the record documents one — the EnHomee hero record says `Injuries: None reported`. Match the verb to `injury_severity` on whatever record you demo.

---

## 2. Why this needs Elastic specifically (the judging argument)

This is the part that wins or loses. Say it out loud in the demo.

A recall notice says:

> *"EnHomee 15-Drawer 51-inch Dressers... unstable if not anchored to the wall, posing tip-over and entrapment hazards."*

The Amazon listing says:

> *"15 Drawer Dresser for Bedroom, Tall Fabric Chest of Drawers with Side Pockets, Sturdy Metal Frame, Wood Top, Closet Organizer for Nursery"*

**Zero meaningful words overlap.** Keyword search finds nothing. Vector embeddings find it instantly, because "dresser," "chest of drawers," and "clothing storage unit" live next to each other in embedding space. That's the whole product.

And then the second half: once matched, **ES|QL** answers the aggregate questions a regulator would actually ask — *how many recalled products are still live, grouped by hazard type, by retailer, by how long ago they were recalled.* Semantic search plus real aggregations over one index is the thing Elastic does that a plain vector database cannot.

**Build a UI toggle that switches matching between keyword-only and semantic, and shows the result count collapse from ~40 to ~2 on screen.** That single toggle is your strongest 8 seconds. (⚠️ CUT TONIGHT — run it as two queries in Kibana Dev Tools instead. See CLAUDE.md §5.)

---

## 3. Stack decision (already made — don't re-litigate)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript, Node 20+** | Both Elastic and Apify ship first-class JS clients. |
| App | **Next.js 15, App Router** | One `npm run dev`. API routes keep the Elastic key server-side. (⚠️ CUT TONIGHT.) |
| Styling | **Tailwind CSS v4** | Fast, and the card grid is the whole UI. |
| Search | **Elasticsearch Serverless** (14-day free trial) | `semantic_text` does embeddings with zero ML setup. |
| Agent | **Kibana Agent Builder** (GA as of Jan 2026) | Judges want to see the actual Elastic product, not LangChain. |
| Scraping | **Apify** | Three actors, one input schema. |
| Pipeline | **Standalone `tsx` scripts**, numbered, each writing JSON to `data/` | Every stage is cached to disk. If the network dies mid-demo, you replay from cache. This is non-negotiable. |

---

## 4. Repo layout

```
deadstock/
├── .env.local                     # never commit
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
├── data/                          # gitignored; every stage caches here
│   ├── 01-recalls-raw.json
│   ├── 02-recalls-normalized.json
│   ├── 03-queries.json
│   ├── 04-listings-raw.json
│   ├── 05-listings-normalized.json
│   └── 06-matches.json
├── scripts/
│   ├── 00-preflight.ts            # verifies Elastic + Apify creds before you waste time
│   ├── 01-fetch-recalls.ts
│   ├── 02-normalize-recalls.ts
│   ├── 03-build-queries.ts
│   ├── 04-scrape.ts
│   ├── 05-index.ts
│   ├── 06-match.ts
│   ├── 07-agent-setup.ts          # creates Agent Builder tools + agent via API
│   └── lib/
│       ├── es.ts                  # Elasticsearch client singleton
│       ├── apify.ts               # Apify client + per-retailer callers
│       ├── types.ts               # Recall, Listing, Match
│       └── hazard.ts              # hazard prose -> enum classifier
└── app/                           # CUT TONIGHT — see CLAUDE.md §5
```

---

## 5. Environment variables

`.env.example`:

```bash
# Elasticsearch Serverless — Help icon (top right) > Connection details > Endpoints
ELASTIC_ENDPOINT=https://your-project.es.us-east-1.aws.elastic.cloud
ELASTIC_API_KEY=

# Kibana base URL — same project, swap .es. for .kb. in the hostname
KIBANA_URL=https://your-project.kb.us-east-1.aws.elastic.cloud

# Apify — https://console.apify.com/settings/integrations
APIFY_TOKEN=

# Hard cost ceiling per Apify actor call, in US dollars.
APIFY_MAX_CHARGE_USD=1.50
```

⚠️ The Kibana URL is **not** the Elasticsearch URL. Same project, different subdomain (`.kb.` instead of `.es.`). Agent Builder APIs live on Kibana; index APIs live on Elasticsearch. Mixing them up produces confusing 404s.

⚠️ **Budget note for tonight:** the event coupon `ELASTIC_APIFY_HCK_NGHT` grants $50 of Apify platform usage, not the $5 free tier this document's §7 budget assumes. Do not optimize scrape cost tonight.

---

## 6. Data source 1 — CPSC recalls ✅ VERIFIED LIVE

### Endpoint

```
https://www.saferproducts.gov/RestWebServices/Recall?format=json
```

- **No API key. No auth. No registration.** `access-control-allow-origin: *`.
- Default format is XML — you **must** pass `format=json`.
- No params returns the **entire corpus**: a bare JSON array of **9,927 records**, 27.4 MB uncompressed, **9.6 MB with `Accept-Encoding: gzip`**. Always request gzip.
- Sorted `RecallDate` descending. Cold request ~9.7s, warm ~1.5s.
- **No pagination at all.** `page`, `limit`, `offset` are ignored. Chunk with date windows only.
- No observed rate limiting (20 concurrent requests all returned 200), but be polite.

### The one query you need

```
https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-08-01&RecallDateEnd=2026-08-01
```

Returns **877 records, 2.7 MB** ✅. Both bounds inclusive. Date format `YYYY-MM-DD`. Compute the window in code as *today minus 24 months* rather than hardcoding, so the numbers stay honest.

### ⚠️ TRAP 1 — typos silently return everything

Unknown parameters are **silently ignored**, and you get all 9,927 records back with no error. `RecallDateStart` is correct; `recallDateStart`, `RecallStartDate`, `startDate` all "work" and return the full corpus. CPSC's own docs warn about this. **Assert the response length is under 2,000 before continuing.**

### ⚠️ TRAP 2 — errors return HTTP 200

A bad date returns status 200 with a single poison record:

```json
[{ "RecallID": 0, "Title": "Error retrieving Recalls: An error occurred while reading from the store provider's data reader...", "RecallNumber": null }]
```

**Guard clause:** treat `RecallID === 0` or `Title.startsWith("Error retrieving Recalls")` as a hard failure.

### Exact record shape ✅ VERIFIED

Top-level keys, exact spelling:

```
RecallID, RecallNumber, RecallDate, Description, URL, Title, ConsumerContact,
LastPublishDate, Products, Inconjunctions, Images, Injuries, Manufacturers,
Retailers, Importers, Distributors, SoldAtLabel, ManufacturerCountries,
ProductUPCs, Hazards, Remedies, RemedyOptions
```

Everything from `Products` onward is an **array of objects**. Real record:

```json
{
  "RecallID": 10882,
  "RecallNumber": "26645",
  "RecallDate": "2026-07-30T00:00:00",
  "Description": "This recall involves EnHomee 15-Drawer 51\" Dressers. The recalled dressers come in white, brown, and black. The dressers have 15 fabric drawers, and the frames are made of metal...",
  "URL": "https://www.cpsc.gov/Recalls/2026/15-Drawer-Dressers-Recalled-Due-to-Risk-of-Serious-Injury-or-Death-from-Tip-Over-and-Entrapment-Hazards...",
  "Title": "15-Drawer Dressers Recalled Due to Risk of Serious Injury or Death from Tip-Over and Entrapment Hazards; Violate Mandatory Standard for Clothing Storage Units; Sold on Amazon by Enhomee-Direct",
  "Products": [
    { "Name": "EnHomee 15-Drawer 51\" Dressers", "Description": "", "Model": "", "Type": "", "CategoryID": "", "NumberOfUnits": "About 12,800" }
  ],
  "Images": [
    { "URL": "https://www.cpsc.gov/s3fs-public/Picture1_55.jpg", "Caption": "Recalled EnHomee 15-Drawer 51\" Dresser (front)" }
  ],
  "Injuries": [{ "Name": "None reported" }],
  "Manufacturers": [{ "Name": "Changzhou Jiaxuan Intelligence Furniture Co., Ltd., of China", "CompanyID": "" }],
  "Retailers": [{ "Name": "Online at Amazon.com from August 2024 through April 2026 for about $140.", "CompanyID": "" }],
  "Importers": [{ "Name": "Hong Kong Baojia International Co. Ltd., dba Enhomee-Direct, of China", "CompanyID": "" }],
  "Distributors": [],
  "ManufacturerCountries": [{ "Country": "China" }],
  "ProductUPCs": [],
  "Hazards": [{ "Name": "The recalled dressers are unstable if they are not anchored to the wall, posing tip-over and entrapment hazards that can result in risks of serious injuries or death to children...", "HazardType": "", "HazardTypeID": "" }],
  "Remedies": [{ "Name": "Consumers should stop using the recalled dressers immediately..." }],
  "RemedyOptions": [{ "Option": "Refund" }]
}
```

### ⚠️ TRAP 3 — half the "structured" fields are dead

Measured across all 9,927 records:

| Field | Reality |
|---|---|
| `Products[].Description` | **Always `""`.** 0 of 11,872. |
| `Products[].Model` | **Always `""`.** Model numbers are buried in `Description` prose. |
| `Products[].Type`, `CategoryID` | Populated pre-2017, **empty for every record after 2016.** The taxonomy is dead. Classify from text. |
| `Hazards[].HazardType`, `HazardTypeID` | **Always `""`.** The prose is in `Hazards[].Name`. You must classify it yourself — see §11. |
| `SoldAtLabel` | **Always `null`.** Dead field. |
| `ProductUPCs` | Only **30 of the last 877** recalls have any. Cannot rely on UPC joins. |
| `Images` | **100% coverage** on recent recalls, avg 3.45 per recall. Use `Images[0].URL`. |
| There is no `Brand` field | Extract it — see below. |

Also: the `Hazard`, `UPC`, and `ManufacturerCountry` **query parameters are broken** — they return 0 results always. Don't use them.

### ⚠️ TRAP 4 — `Retailers[].Name` is a sentence, not a name

It's prose: `"Online at Amazon.com from August 2024 through April 2026 for about $140."` Regex it:

```ts
const channel = /amazon|walmart|ebay|target|wayfair|costco|temu|shein/i.exec(r.Retailers?.[0]?.Name ?? "")?.[0]?.toLowerCase();
const priceHint = /\$([\d,]+(?:\.\d{2})?)/.exec(r.Retailers?.[0]?.Name ?? "")?.[1];
```

### Extracting a brand (there's no field for it)

The seller brand hides in `Importers[].Name` or `Distributors[].Name` as `"... dba Enhomee-Direct, of China"`:

```ts
function extractBrand(r: RawRecall): string | null {
  const sources = [...(r.Importers ?? []), ...(r.Distributors ?? []), ...(r.Manufacturers ?? [])];
  for (const s of sources) {
    const dba = /\bdba\s+([^,]+)/i.exec(s.Name);
    if (dba) return dba[1].trim();
  }
  const first = r.Products?.[0]?.Name ?? "";
  const m = /^([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*)?)/.exec(first);
  return m ? m[1].trim() : null;
}
```

### What's actually in there (last 2 years, 877 recalls)

| Category | Recalls | Amazon-sold |
|---|---|---|
| Children / infant / toys / cribs / strollers | 302 | **198** |
| Furniture (dressers, beds, bunk beds) | 158 | **113** |
| Batteries / lithium / power banks / chargers | 103 | **63** |
| Apparel & sleepwear | 86 | 37 |
| Tools & outdoor | 27 | 9 |

**54% of all recalls in the last two years explicitly name Amazon as the sales channel.** Retailer mention counts: Amazon 476, Walmart 125, Target 54, Wayfair 35, Home Depot 34, Costco 21, eBay 20.

**Target the top three categories.** They share a signature — cheap direct-from-China marketplace goods from rotating alphabet-soup brands, exactly the products most likely to still be listed.

---

## 7. Data source 2 — Apify retail scraping ✅ VERIFIED LIVE

### ⚠️ There is no official Apify actor for any of these

`apify/amazon-product-scraper` **404s — it no longer exists.** Store search returns zero official `apify/*` actors for Amazon, Walmart, or eBay search. Everything below is community-maintained and was **live-tested on 2026-07-31**.

### Actors to use

| Retailer | Actor ID | Price | Measured speed |
|---|---|---|---|
| Amazon | `santamaria-automations/amazon-search-scraper` | $0.001/run + **$0.001/result** | **4.0s** for 2 keywords |
| Amazon (fallback) | `automation-lab/amazon-scraper` | $0.001/run + $0.0046/result | 43s for 2 keywords |
| Walmart | `automation-lab/walmart-scraper` | $0.001/run + $0.0046/result | 7.0s |
| eBay | `automation-lab/ebay-scraper` | $0.001/run + $0.00345/result | 25.4s |

**Use `santamaria-automations` for Amazon.** It is 4.6× cheaper, 10× faster, and — critically — **it echoes a `searchQuery` field on every result item**, which the `automation-lab` actors do not. You need that field to know which recall a listing came from. Keep `automation-lab/amazon-scraper` configured as a fallback in case santamaria (18 users, unproven) breaks.

**No proxy configuration needed or accepted.** None of these actors expose `proxyConfiguration`. Residential proxy rotation is internal. Don't pass one.

### Input schemas ✅ VERIFIED

```ts
// santamaria-automations/amazon-search-scraper
{ searchQueries: string[], marketplace: "US", maxResultsPerQuery: 20, sortBy: "relevance" }

// automation-lab/walmart-scraper   (searchQueries is REQUIRED)
{ searchQueries: string[], maxProductsPerSearch: 10, maxSearchPages: 1, sort: "best_match", maxRequestRetries: 5 }

// automation-lab/ebay-scraper      (searchQueries is REQUIRED)
{ searchQueries: string[], maxProductsPerSearch: 15, maxSearchPages: 1, sort: "best_match",
  listingType: "all", condition: ["new"], maxRequestRetries: 5 }
```

⚠️ Confirm santamaria's exact input field names at build time with `fetch-actor-details` — its schema was read from a live run, but `maxResultsPerQuery` vs `maxResults` is worth a 30-second check.

### Output field names ✅ VERIFIED — they differ per retailer, normalize immediately

**Amazon (santamaria):**
```json
{ "asin": "B0H7MC5R2R", "title": "ZZU Wireless Earbuds, Bluetooth 5.4...",
  "url": "https://www.amazon.com/dp/B0H7MC5R2R", "searchQuery": "wireless earbuds",
  "price": { "value": 15.99, "currency": "$", "raw": "$15.99" },
  "listPrice": { "value": 159.99, "currency": "$", "raw": "$159.99" },
  "stars": 4.9, "reviewsCount": 50, "thumbnailImage": "https://m.media-amazon.com/images/I/...jpg",
  "isSponsored": false, "isPrime": true, "positionOverall": 1, "scrapedAt": "2026-07-31T23:49:16Z" }
```

**Walmart (automation-lab):**
```json
{ "usItemId": "5700106754", "name": "JLab Go Air Pop Bluetooth Earbuds...",
  "price": 19.88, "priceString": "$19.88", "rating": 4.5, "reviewCount": 40408,
  "seller": "Walmart.com", "fulfillmentType": "STORE",
  "thumbnail": "https://i5.walmartimages.com/seo/...jpeg", "url": "https://www.walmart.com/ip/.../5700106754",
  "isSponsored": true, "scrapedAt": "2026-07-31T23:48:02.711Z" }
```

**eBay (automation-lab):**
```json
{ "itemId": "147024844358", "title": "Apple AirPods 2nd Gen Genuine In-Ear Bluetooth Headset...",
  "price": 49.5, "priceString": "$49.50", "condition": "Open Box", "listingType": "Buy It Now",
  "sellerName": "jamiesretrofun", "sellerFeedbackPercent": "97.7%", "soldCount": "1,726",
  "thumbnail": "https://i.ebayimg.com/images/g/...webp", "url": "https://www.ebay.com/itm/147024844358",
  "isSponsored": false, "scrapedAt": "2026-07-31T23:48:17.417Z" }
```

Note the title field is `title` on Amazon and eBay but **`name`** on Walmart. ID field is `asin` / `usItemId` / `itemId`. Image is `thumbnailImage` / `thumbnail` / `thumbnail`.

### ⚠️ TRAP 5 — eBay silently returns foreign currency

Observed live: one keyword returned USD, the next returned **Colombian pesos** — `"priceString": "COP $84,119.19"`, `price: 84119.19`. The residential proxy drifted to a non-US exit IP mid-run, and this actor has **no `proxyCountry` input to pin it** and **no `currency` field**.

**Mandatory guard:**

```ts
function parseUsdPrice(priceString?: string, price?: number): number | null {
  if (!priceString) return typeof price === "number" ? price : null;
  if (!/^\s*\$/.test(priceString)) return null;   // COP $..., £..., etc. -> drop it
  const n = parseFloat(priceString.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}
```

Listings with a null price still display — just show "price unavailable" rather than a wrong number. A wrong price on screen is the one thing a judge will catch.

### ⚠️ TRAP 6 — other field realities

- **`brand` is always empty on Amazon and Walmart.** 6/6 empty in live tests. **Do not build a feature on brand matching against listings.** (Brand from the *recall* side is fine — use it in the query string.)
- **`isSponsored` is rampant.** Walmart returned 6/6 sponsored, Amazon 4/6. Filter these out or your top result is an ad.
- **Amazon `listPrice` is frequently fake** (`price: 15.99` vs `listPrice: 159.99`). Don't compute discount percentages.
- **No availability/in-stock field** on Walmart or eBay. Amazon has `availability` as a string. Treat "it appeared in search results" as the in-stock signal and say so honestly in the UI.

### Budget

Apify free plan is $5/month. **Tonight you have the `ELASTIC_APIFY_HCK_NGHT` coupon: $50.** The table below is the $5-tier plan, kept for reference.

| Retailer | Queries | Results/query | Total results | Cost |
|---|---|---|---|---|
| Amazon (santamaria) | 40 | 20 | 800 | $0.80 |
| eBay | 20 | 15 | 300 | $1.04 |
| Walmart | 15 | 10 | 150 | $0.69 |
| | | | **1,250** | **$2.53** |

**Always pass the circuit breaker anyway:**

```ts
const run = await client.actor(ACTOR_ID).call(input, {
  timeout: 900,
  maxTotalChargeUsd: Number(process.env.APIFY_MAX_CHARGE_USD ?? 1.5),
});
if (run.status !== "SUCCEEDED") throw new Error(`${retailer} run ${run.id} ended ${run.status}`);
const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(`${retailer}: ${items.length} items, $${run.usageTotalUsd}`);
```

Run retailers concurrently with `Promise.all`. Keywords inside one run are processed **sequentially**, so keep batches small.

---

## 8. Elasticsearch setup ⚠️ VERIFY THIS FIRST — it changed recently

### Trial

Sign up at `ela.st/hack-austin` (or `https://cloud.elastic.co/serverless-registration`). **14 days, up to 3 active projects.** Choose project type **Elasticsearch**.

- Endpoint: **Help icon (top right) → Connection details → Endpoints**
- API key: project home page → **Create API key** → copy immediately, it's shown once
- Firewall: allow `kibana.estccdn.com` and `cloud.elastic.co` or Kibana renders blank

### ⚠️ TRAP 7 — the default embedding model changed twice; every tutorial online is wrong

| Deployment | Default `inference_id` |
|---|---|
| **Serverless + Stack 9.4+ (what you'll get)** | **`.jina-embeddings-v5-text-small`** |
| Stack 9.3 | `.elser-2-elastic` |
| Stack 9.0–9.2 | `.elser-2-elasticsearch` |

It is **not** ELSER anymore on serverless. Older blog posts telling you to deploy ELSER manually are obsolete — **preconfigured endpoints need no deployment step at all.**

**Do this in the first 5 minutes, before writing any indexing code:**

```bash
curl "$ELASTIC_ENDPOINT/_inference" -H "Authorization: ApiKey $ELASTIC_API_KEY"

curl -X PUT "$ELASTIC_ENDPOINT/probe" -H "Authorization: ApiKey $ELASTIC_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"mappings":{"properties":{"t":{"type":"semantic_text"}}}}'
curl "$ELASTIC_ENDPOINT/probe/_mapping" -H "Authorization: ApiKey $ELASTIC_API_KEY"
```

Whatever `inference_id` comes back, **pin it explicitly in your real mappings.**

### Index mappings — three indices

**`deadstock-recalls`**

```json
PUT /deadstock-recalls
{
  "mappings": {
    "properties": {
      "recall_id":        { "type": "keyword" },
      "recall_number":    { "type": "keyword" },
      "recall_date":      { "type": "date" },
      "title":            { "type": "text" },
      "product_name":     { "type": "text" },
      "brand":            { "type": "keyword" },
      "description":      { "type": "text" },
      "hazard_text":      { "type": "text" },
      "hazard_type":      { "type": "keyword" },
      "injury_severity":  { "type": "keyword" },
      "remedy_option":    { "type": "keyword" },
      "sold_at":          { "type": "keyword" },
      "price_hint":       { "type": "double" },
      "units":            { "type": "keyword" },
      "cpsc_url":         { "type": "keyword" },
      "image_url":        { "type": "keyword" },
      "search_text":      { "type": "semantic_text", "inference_id": "<PINNED_FROM_PROBE>" }
    }
  }
}
```

**`deadstock-listings`**

```json
PUT /deadstock-listings
{
  "mappings": {
    "properties": {
      "listing_id":    { "type": "keyword" },
      "retailer":      { "type": "keyword" },
      "title":         { "type": "text" },
      "price_usd":     { "type": "double" },
      "url":           { "type": "keyword" },
      "image_url":     { "type": "keyword" },
      "seller":        { "type": "keyword" },
      "rating":        { "type": "float" },
      "review_count":  { "type": "integer" },
      "is_sponsored":  { "type": "boolean" },
      "source_query":  { "type": "keyword" },
      "source_recall": { "type": "keyword" },
      "scraped_at":    { "type": "date" },
      "title_semantic": { "type": "semantic_text", "inference_id": "<PINNED_FROM_PROBE>" }
    }
  }
}
```

**`deadstock-matches`** — the join result, what the UI and the ES|QL tools read.

```json
PUT /deadstock-matches
{
  "mappings": {
    "properties": {
      "match_id":         { "type": "keyword" },
      "recall_id":        { "type": "keyword" },
      "recall_number":    { "type": "keyword" },
      "recall_date":      { "type": "date" },
      "recall_title":     { "type": "text" },
      "recall_product":   { "type": "text" },
      "recall_image":     { "type": "keyword" },
      "cpsc_url":         { "type": "keyword" },
      "brand":            { "type": "keyword" },
      "hazard_type":      { "type": "keyword" },
      "hazard_text":      { "type": "text" },
      "injury_severity":  { "type": "keyword" },
      "listing_id":       { "type": "keyword" },
      "listing_title":    { "type": "text" },
      "listing_url":      { "type": "keyword" },
      "listing_image":    { "type": "keyword" },
      "retailer":         { "type": "keyword" },
      "price_usd":        { "type": "double" },
      "seller":           { "type": "keyword" },
      "semantic_score":   { "type": "float" },
      "keyword_score":    { "type": "float" },
      "found_by_keyword": { "type": "boolean" },
      "confidence":       { "type": "keyword" },
      "days_since_recall":{ "type": "integer" },
      "matched_at":       { "type": "date" }
    }
  }
}
```

`found_by_keyword` is the field that powers the demo contrast. It is the most important boolean in this project.

### ⚠️ TRAP 8 — the `semantic` query is legacy, use `match`

Elastic's own docs: *"We don't recommend this legacy query type for new projects. Use the match query instead."*

```json
GET /deadstock-listings/_search
{
  "query": { "match": { "title_semantic": "15 drawer fabric dresser chest of drawers" } },
  "_source": { "excludes": ["title_semantic"] },
  "size": 10
}
```

Always `_source.excludes` the semantic field or you ship embeddings over the wire on every request.

Hybrid (use this for the "best" mode):

```json
{
  "retriever": {
    "rrf": {
      "retrievers": [
        { "standard": { "query": { "match": { "title": "<query>" } } } },
        { "standard": { "query": { "match": { "title_semantic": "<query>" } } } }
      ],
      "rank_window_size": 50,
      "rank_constant": 20
    }
  },
  "size": 10
}
```

### ⚠️ TRAP 9 — bulk indexing into semantic_text is slow and rate-limited

Embedding generation happens **inside** the bulk request, not asynchronously. Elastic Inference Service limits: 6,000 requests/min, 6M tokens/min ingest. Over-limit returns **HTTP 429**.

```ts
await client.helpers.bulk({
  datasource: docs,
  onDocument: (doc) => ({ index: { _index: "deadstock-listings", _id: doc.listing_id } }),
  flushBytes: 1_000_000,   // default is 5MB — lower it, semantic_text makes requests heavy
  concurrency: 1,          // default is 5 — keep it at 1 to avoid 429s
  retries: 5,
  onDrop: (doc) => console.error("dropped", doc),
});
```

Set `requestTimeout: 120_000` on the client. Expect ~1,250 listings to take a couple of minutes.

### JS client

```bash
npm install @elastic/elasticsearch   # 9.4.3 — match the major to your stack
```

```ts
import { Client } from "@elastic/elasticsearch";

export const es = new Client({
  node: process.env.ELASTIC_ENDPOINT!,
  auth: { apiKey: process.env.ELASTIC_API_KEY! },
  serverMode: "serverless",     // required for serverless projects
  requestTimeout: 120_000,
});
```

---

## 9. Pipeline — script by script

### `00-preflight.ts`
1. `es.info()` — confirms endpoint + key.
2. `GET /_inference` — print available endpoint IDs, **write the chosen one to `data/00-inference-id.txt`**.
3. Create/delete a `probe` index to confirm the default `inference_id`.
4. `GET ${KIBANA_URL}/api/agent_builder/tools` with `Authorization: ApiKey` — confirms the Kibana key works and Agent Builder is enabled.
5. Apify: `client.user().get()` — confirms token and prints remaining credit.

**Do not proceed until all five pass.**

### `01-fetch-recalls.ts`
Fetch the 24-month window with `Accept-Encoding: gzip`. Assert `Array.isArray(res)`, `res.length < 2000`, `res[0].RecallID !== 0`. Write `data/01-recalls-raw.json`. **If the file already exists and `--force` wasn't passed, skip the fetch and read from disk.** Every script gets this behavior.

### `02-normalize-recalls.ts`
Flatten to the `Recall` type. Key work:
- `product_name` ← `Products[0].Name` (⚠️ 776 recalls have multiple products, max 57 — index all, display `[0]`)
- `brand` ← `extractBrand()` from §6
- `hazard_text` ← `Hazards[0].Name`
- `hazard_type` ← classify from text, see §11
- `sold_at` ← regex over `Retailers[].Name`
- `price_hint` ← `$([\d,.]+)` from the same string
- `image_url` ← `Images[0].URL`
- `injury_severity` ← `"death"` if `Title` or `Hazards[0].Name` matches `/death|fatal|died/i`, else `"injury"` if `Injuries[0].Name !== "None reported"`, else `"none_reported"`
- `search_text` ← **the concatenation that gets embedded:** `` `${product_name}. ${brand ?? ""}. ${description}` ``. Cap at ~1,200 chars.

**Filter to demo-relevant recalls:** keep those whose `sold_at` includes amazon/walmart/ebay, OR whose text matches the three high-yield categories. Sort by `recall_date` desc. **Take the top 40** (top 20 under tonight's cut plan).

### `03-build-queries.ts`
For each recall, generate **one** search query — a *generic shopper phrase*, not the recall's official language. Searching Amazon for `"EnHomee 15-Drawer 51\" Dressers"` finds nothing. Searching for `"15 drawer fabric dresser"` finds it.

```ts
function buildQuery(r: Recall): string {
  return r.product_name
    .replace(/["""]/g, "")
    .replace(/\b\d+(\.\d+)?\s*(inch|in|"|cm|lb|lbs|oz|ft)\b/gi, "")  // drop dimensions
    .replace(/\b(recalled|model|series|style)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(/\s+/).slice(0, 6).join(" ");                              // <=6 words
}
```

Write `data/03-queries.json` as `[{ recall_id, query }]`. **Print the list and eyeball it before spending money.** Bad queries are the single biggest cause of a demo with no matches.

### `04-scrape.ts`
Call the actor(s). Pass `maxTotalChargeUsd` on every call. Normalize immediately into a common `Listing` shape, applying the currency guard from §7 and dropping `isSponsored: true` rows. Tag each listing with `source_query` and `source_recall`.

For `automation-lab` actors, results **do not echo the keyword** — they come back as a flat concatenation ordered by input keyword. ⚠️ That ordering is fragile. **For Walmart and eBay, issue one run per keyword and tag client-side.** For Amazon, santamaria's `searchQuery` field handles it.

Write `data/04-listings-raw.json` and `data/05-listings-normalized.json`.

### `05-index.ts`
Delete and recreate all three indices (idempotent reruns matter more than data preservation here). Bulk index recalls, then listings, with the settings from §8. Print counts. Wait for `refresh`.

### `06-match.ts` — the core
For each recall, run **two** searches over `deadstock-listings`, filtered to that recall's own scraped listings:

```ts
// A. Semantic — what Elastic can do
const semantic = await es.search({
  index: "deadstock-listings",
  query: {
    bool: {
      must: [{ match: { title_semantic: recall.search_text_short } }],
      filter: [{ term: { source_recall: recall.recall_id } }],
    },
  },
  _source: { excludes: ["title_semantic"] },
  size: 5,
});

// B. Keyword only — what everyone else can do. The control group.
const keyword = await es.search({
  index: "deadstock-listings",
  query: {
    bool: {
      must: [{ match: { title: { query: recall.product_name, operator: "and" } } }],
      filter: [{ term: { source_recall: recall.recall_id } }],
    },
  },
  size: 5,
});
```

Note `operator: "and"` on the keyword branch. That's deliberate and defensible — it's what a naive exact-match implementation does. "I made keyword search deliberately fair, and it still fails" is a stronger answer than a suspiciously empty result set.

Build a `Match` per semantic hit above threshold:
- `semantic_score` ← `_score`
- `found_by_keyword` ← whether that same `listing_id` appears in branch B
- `keyword_score` ← its score there, or 0
- `confidence` ← `"high"` if semantic score >= 6 **and** the recall's brand token appears in the listing title; `"medium"` if >= 4; else `"low"`
- `days_since_recall` ← `(now - recall_date) / 86400000`

Index into `deadstock-matches`. Write `data/06-matches.json` as the offline fallback.

**Tune the threshold by hand.** Twenty solid matches beat two hundred noisy ones.

### `07-agent-setup.ts`
Creates the Agent Builder tools and agent over the Kibana API (§10) so it's reproducible and you're not clicking through a UI at 8:20pm.

---

## 10. Kibana Agent Builder ✅ GA since Jan 2026

Nav: **Manage components** (bottom of left sidebar) → **Tools** / **Agents**. Or the **AI Agent** button top-right. LLM connector is preconfigured on serverless — no setup.

All API calls: `Authorization: ApiKey $KEY`, `kbn-xsrf: true`, against `$KIBANA_URL`.

### Tool 1 — `deadstock-search` (index_search)

```json
POST /api/agent_builder/tools
{
  "id": "deadstock-search",
  "type": "index_search",
  "description": "Search recalled products that are currently for sale online. Use for any question about specific products, hazards, brands, or retailers.",
  "configuration": {
    "pattern": "deadstock-matches",
    "row_limit": 20,
    "custom_instructions": "Always include listing_url, retailer, price_usd, hazard_type, and cpsc_url in results. These are live purchasable listings of federally recalled products."
  }
}
```

### Tool 2 — `deadstock-by-hazard` (esql, parameterized)

```json
POST /api/agent_builder/tools
{
  "id": "deadstock-by-hazard",
  "type": "esql",
  "description": "Count recalled-but-still-purchasable products grouped by hazard type and retailer. Use for 'how many', 'which category', 'break down by' questions.",
  "configuration": {
    "query": "FROM deadstock-matches | WHERE days_since_recall >= ?min_days | STATS still_listed = COUNT(*), avg_price = ROUND(AVG(price_usd), 2), oldest_recall_days = MAX(days_since_recall) BY hazard_type, retailer | SORT still_listed DESC | LIMIT ?limit",
    "params": {
      "min_days": { "type": "integer", "description": "Only count products recalled at least this many days ago. Use 0 for all." },
      "limit":    { "type": "integer", "description": "Max rows to return. Default 25." }
    }
  }
}
```

### Tool 3 — `deadstock-worst-offenders` (esql)

```json
POST /api/agent_builder/tools
{
  "id": "deadstock-worst-offenders",
  "type": "esql",
  "description": "Find the products that have been recalled the longest and are still on sale, optionally filtered to fatal-hazard recalls.",
  "configuration": {
    "query": "FROM deadstock-matches | WHERE injury_severity == ?severity | SORT days_since_recall DESC | KEEP recall_product, retailer, price_usd, hazard_type, days_since_recall, listing_url, cpsc_url | LIMIT ?limit",
    "params": {
      "severity": { "type": "string",  "description": "One of: death, injury, none_reported" },
      "limit":    { "type": "integer", "description": "Max rows. Default 10." }
    }
  }
}
```

### The agent

```json
POST /api/agent_builder/agents
{
  "id": "deadstock-agent",
  "name": "Deadstock",
  "description": "Answers questions about federally recalled products that are still purchasable online right now.",
  "avatar_symbol": "🛒",
  "avatar_color": "#E5484D",
  "labels": ["recalls", "consumer-safety"],
  "configuration": {
    "instructions": "You are Deadstock. You have access to a live index joining the US CPSC recall database against product listings scraped minutes ago from Amazon, Walmart, and eBay. Every record represents a product the federal government recalled that a consumer can still buy today.\n\nRules:\n- Always cite the CPSC recall URL and the live listing URL. Both. Every time.\n- Lead with the number, then the examples. 'Eleven. Here are the three worst.'\n- State the hazard in plain language. Say 'can catch fire', not 'thermal event'.\n- These matches are algorithmic. If confidence is 'low', say so.\n- Never tell a user a product is safe. You only know what is listed, not what is verified.\n- Be direct and brief. No preamble.",
    "tools": [
      { "tool_ids": ["deadstock-search", "deadstock-by-hazard", "deadstock-worst-offenders",
                     "platform.core.search", "platform.core.execute_esql", "platform.core.list_indices"] }
    ]
  }
}
```

### Optional flex — wire it into Claude Code over MCP

The standalone `@elastic/mcp-server-elasticsearch` is **deprecated**. The current path is the Agent Builder MCP endpoint at `${KIBANA_URL}/api/agent_builder/mcp`. The API key needs the Kibana privilege `feature_agentBuilder.read`.

```json
{ "mcpServers": { "deadstock": {
  "command": "npx",
  "args": ["mcp-remote", "https://YOUR.kb.REGION.CSP.elastic.cloud/api/agent_builder/mcp",
           "--header", "Authorization:ApiKey YOUR_KEY"] } } }
```

**Cut it tonight.**

---

## 11. Hazard classification (`lib/hazard.ts`)

`Hazards[].HazardType` is empty in 100% of records, so classify the prose yourself. Ordered rules — first match wins, most severe first:

```ts
export const HAZARD_RULES = [
  { type: "tip_over",     re: /tip[- ]?over|topple|entrapment|unstable|STURDY/i,          label: "Tip-Over / Crush",  color: "#E5484D" },
  { type: "fire_burn",    re: /\bfire\b|burn|overheat|thermal|flammab|ignit|explos/i,     label: "Fire / Burn",       color: "#F76B15" },
  { type: "battery",      re: /lithium|battery|batteries|power bank|charger/i,            label: "Battery",           color: "#FFB224" },
  { type: "choking",      re: /chok|small part|ingest|aspirat|swallow/i,                  label: "Choking",           color: "#E5484D" },
  { type: "suffocation",  re: /suffocat|strangulat|asphyxi|entangle/i,                    label: "Suffocation",       color: "#E5484D" },
  { type: "fall",         re: /\bfall\b|falls|collapse|detach|break.*(?:under|weight)/i,  label: "Fall",              color: "#F76B15" },
  { type: "laceration",   re: /lacerat|\bcut\b|sharp|amputat|blade/i,                     label: "Laceration",        color: "#F76B15" },
  { type: "chemical",     re: /\blead\b|phthalate|cadmium|toxic|poison|chemical|mold/i,   label: "Toxic / Chemical",  color: "#8E4EC6" },
  { type: "drowning",     re: /drown/i,                                                    label: "Drowning",          color: "#E5484D" },
  { type: "impact",       re: /impact|projectil|struck|blunt/i,                           label: "Impact",            color: "#F76B15" },
  { type: "electrical",   re: /shock|electrocut|electrical/i,                             label: "Electrical",        color: "#FFB224" },
] as const;

export function classifyHazard(text: string) {
  return HAZARD_RULES.find(r => r.re.test(text)) ?? { type: "other", label: "Other", color: "#7C7F88" };
}
```

Run it over the recalls and print the distribution. If "other" is over 15%, add rules until it isn't.

---

## 12. The interface (CUT TONIGHT — kept for a later build)

### Design direction

Dark, editorial, restrained. This is a story about danger — do not decorate it. No gradients, no glass, no rounded-everything. Think investigative journalism, not SaaS dashboard.

```
Background      #0A0B0D
Surface (card)  #15171B
Border          #24272E
Text primary    #EDEEF0
Text muted      #8B8F98
Danger          #E5484D    (hazard badges, the big number)
Warning         #F76B15
Accent          #FFB224
Success/live    #30A46C    (the "still live" pulse dot)
```

Type: **Inter** (or system stack). One weight for body, one heavy weight for numbers. The hero number should be *enormous* — 96px+.

### Layout, top to bottom

**1. Hero bar.** Fed by `/api/stats` (ES|QL).

> ### 23
> **recalled products you can buy right now**
> Scraped 14 minutes ago · Amazon, Walmart, eBay · 40 CPSC recalls checked
> `● LIVE` (pulsing green dot)

**2. Search mode toggle** — the money shot. A three-position segmented control:

`[ Keyword only ]  [ Semantic ]  [ Hybrid ]`

Switching it re-filters the grid client-side using `found_by_keyword` (no refetch — it must be instant). The count in the hero animates: **23 → 2 → 23**. Beneath it, one line of copy that changes with the mode:

- Keyword only: *"Recall notices and product listings never use the same words. Exact matching finds almost nothing."*
- Semantic: *"Elastic embeddings match meaning, not words. 'Clothing storage unit' finds 'chest of drawers'."*

**3. Filter bar.** Retailer chips, hazard-type chips (colored), confidence dropdown, sort.

**4. The wall.** Responsive grid, 1 / 2 / 3 columns. Each `MatchCard` is a split panel:

```
┌────────────────────────────┬────────────────────────────┐
│ RECALLED · Jul 30, 2026    │  ● STILL FOR SALE          │
│ [CPSC product photo]       │  [live listing photo]      │
│                            │                            │
│ EnHomee 15-Drawer Dresser  │  15 Drawer Dresser for     │
│                            │  Bedroom, Tall Fabric...   │
│ 🔴 TIP-OVER / CRUSH        │                            │
│ "Unstable if not anchored  │  $139.99   amazon          │
│  to the wall — risk of     │  ★ 4.3 (21,283)            │
│  serious injury or death   │                            │
│  to children."             │  [ View listing ↗ ]        │
│                            │                            │
│ 12,800 units · Refund      │  match 8.4 · high          │
│ CPSC recall 26645 ↗        │  keyword: ✗ not found      │
└────────────────────────────┴────────────────────────────┘
        365 days since recall — still listed
```

The recall side desaturated slightly, the listing side full color and *alive*. A thin red rule across the top of every card. `keyword: ✗ not found` on cards that only semantic found — that badge is doing real argumentative work, leave it visible.

**5. Footer disclaimer.** Non-negotiable, and it makes you look more credible, not less:

> Matches are generated algorithmically by comparing CPSC recall notices to scraped marketplace listings. A match indicates a likely product correspondence, not a verified one — listings may be for a different variant, a corrected version, or a different seller. Always check the CPSC recall notice before drawing conclusions. Deadstock is a research demo, not a compliance tool.

---

## 13. Build order and cut lines (ORIGINAL — superseded by CLAUDE.md §5 tonight)

| Phase | What | Est. | Cut if behind? |
|---|---|---|---|
| **0** | `00-preflight.ts` — five green checks | 15 min | ❌ Never |
| **1** | Recalls: fetch → normalize → selected, printed and eyeballed | 30 min | ❌ Never |
| **2** | Queries + scrape, cached to disk | 30 min | ❌ Never |
| **3** | Index + match. Tune the threshold. | 40 min | ❌ Never |
| **4** | UI: hero, grid, cards, toggle | 60 min | ⚠️ CUT TONIGHT |
| **5** | Agent Builder tools + agent via `07-agent-setup.ts` | 25 min | ❌ Never — it's the scored deliverable |
| **6** | Filter bar, sort, detail modal | 30 min | ✅ Cut |
| **7** | MCP into Claude Code | 15 min | ✅ Cut |
| **8** | Deploy to Vercel | 15 min | ✅ Cut — localhost is fine |

**Tonight's definition of done:** the agent answers one question live in Kibana Agent Chat, over data Apify scraped less than an hour ago, and the repo is public and submitted.

---

## 14. Demo script — 3 minutes

**0:00–0:15 — No slides.**

> "This is the federal recall database on the left. On the right, that same product, for sale right now. Twenty-three of them. I scraped these fourteen minutes ago."

**0:15–0:45 — Pick the worst one. Click through to the live listing.**

> "This dresser tips over onto children. CPSC recalled it in July. Here it is on Amazon — a hundred and forty dollars, in stock, ships tomorrow."

*(Have the tab pre-loaded. Do not click Buy.)*

**0:45–1:15 — The contrast. Slowly.** (Dev Tools, two queries, tonight.)

> "Here's why this needs Elastic. The recall calls it a 'clothing storage unit.' The listing calls it a 'chest of drawers.' Zero words in common. Watch what keyword search finds."

*Run the keyword query. 23 → 2.*

> "Two. Now semantic."

*Run the semantic query. 2 → 23.*

> "Same data. Same index. The embeddings match meaning instead of words. That's the entire product."

**1:15–2:15 — Kibana Agent Chat. Ask live, don't paste.**

> "Which hazard types have the most products still on sale?"

> "Show me the fatal-hazard recalls that have been listed the longest."

*Let the ES|QL results render. Then:*

> "That's semantic search and real aggregations over one index. A vector database gives you the first half."

**2:15–3:00 — Land it.**

> "Apify scrapes the live web, Elastic makes it answerable. Point it at a different recall database — FDA, NHTSA — and it runs the same. Every recall notice in the world has this problem: the people who wrote it and the people selling the product never use the same words."

### Rules for the demo

1. **Never click Buy.** Say "I'm not going to click that" — the room will laugh and it's a better beat than actually doing it.
2. Pre-load every tab. Zoom the browser to 125%.
3. If Elastic is down, the JSON fallback renders the same data. Nobody can tell.
4. If the scrape is stale, say "fourteen minutes ago" anyway — it's true, it just isn't *this* fourteen minutes.
5. Don't name-and-shame a specific seller by name from the stage. Show the listing, describe the pattern.

---

## 15. Airtable submission blurb (password: `yeehaw`)

> **Deadstock** — recalled products you can buy right now.
>
> Apify scrapes live Amazon, Walmart, and eBay listings. Elasticsearch `semantic_text` joins them against the CPSC federal recall database. The problem is that recall notices and product listings never use the same words — a "clothing storage unit" recall versus a "chest of drawers" listing — so keyword matching finds almost nothing and vector search finds them instantly. The UI has a toggle that shows the difference live. An Agent Builder agent with three tools (one index-search, two parameterized ES|QL) answers aggregate questions: which hazard types are still purchasable, which retailer has the most, which recalled products have been listed the longest.

---

## 16. Ethics and honesty guardrails — build these in, don't bolt them on

This project makes accusations. Make sure they're defensible.

1. **Every match must show its confidence, and low-confidence matches must say so.**
2. **Never claim a listing is definitely the recalled unit.** Language: "likely match," "appears to be," never "is."
3. **The disclaimer stays in the footer.** Don't hide it behind a link.
4. **Don't dox sellers.** Show what's public on the listing. Don't aggregate a seller profile.
5. **Every card links to the CPSC notice.** The user can verify you.
6. **The right ask is "this deserves a look,"** not "this company is breaking the law." You built a lead generator for regulators, not a verdict.

Being careful here is not a weakness in the pitch. It's the thing that separates a demo from a stunt, and judges notice.

---

## 17. Pre-flight checklist

- [ ] Elastic serverless project created, endpoint + API key in `.env.local`
- [ ] `GET /_inference` run; chosen `inference_id` pinned in mappings
- [ ] Kibana URL confirmed (`.kb.` not `.es.`), Agent Builder page loads
- [ ] Apify token in `.env.local`, coupon `ELASTIC_APIFY_HCK_NGHT` applied
- [ ] `npm run preflight` — five green checks
- [ ] `data/` populated from a full pipeline run, committed as the fallback
- [ ] Amazon listing tab pre-loaded for the hero example
- [ ] Kibana Agent Chat open in its own tab, one question already tested
- [ ] Browser zoom 125%, notifications off, dark mode on
- [ ] Repo pushed public, Airtable form submitted before demos start

---

## Appendix — verified curl commands

```bash
# All CPSC recalls, gzipped (9.6 MB wire, ~1.5s warm)
curl -s --compressed "https://www.saferproducts.gov/RestWebServices/Recall?format=json" -o recalls.json

# Last 24 months (877 records, 2.7 MB) — the one you want
curl -s --compressed "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2024-08-01&RecallDateEnd=2026-07-31"

# Everything ever sold via Amazon (1,396 records)
curl -s --compressed "https://www.saferproducts.gov/RestWebServices/Recall?format=json&Retailer=Amazon"

# The hero record
curl -s "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallNumber=26645"

# Elastic: which inference endpoints exist?
curl "$ELASTIC_ENDPOINT/_inference" -H "Authorization: ApiKey $ELASTIC_API_KEY"

# Kibana: is Agent Builder alive?
curl "$KIBANA_URL/api/agent_builder/tools" -H "Authorization: ApiKey $ELASTIC_API_KEY" -H "kbn-xsrf: true"

# Apify: remaining credit
curl "https://api.apify.com/v2/users/me?token=$APIFY_TOKEN"
```
