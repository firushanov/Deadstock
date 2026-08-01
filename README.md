<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-white.svg">
    <img src="brand/logo.svg" alt="Deadstock" width="360">
  </picture>
</p>

**Recalled products you can buy right now.**

The US government recalls products for being dangerous. Companies are supposed to pull them off the shelves. Many never come off.

Deadstock proves it. It pulls the federal recall database, scrapes live listings from Amazon, Walmart, and eBay, and uses Elasticsearch semantic search to match the two. The output is a wall of cards — on the left, a product the government recalled; on the right, that same product, in stock, with a working Buy button.

> Built for the Elastic + Apify Hack Night — The Great Austin AI Agent Roundup.

---

## The problem this actually solves

A CPSC recall notice says:

> *EnHomee 15-Drawer 51-inch Dressers — unstable if not anchored to the wall, posing tip-over and entrapment hazards.*

The Amazon listing for the same product says:

> *15 Drawer Dresser for Bedroom, Tall Fabric Chest of Drawers with Side Pockets, Sturdy Metal Frame, Closet Organizer for Nursery*

**Zero meaningful words overlap.** The people who write recall notices and the people who write product listings do not speak the same language. Regulatory prose says "clothing storage unit"; a seller says "chest of drawers."

That's why nobody has built this before with keyword search — it doesn't work. Exact matching finds almost nothing. Vector embeddings find it instantly, because those phrases sit next to each other in embedding space.

The UI ships with a toggle that demonstrates this live. Switch between keyword and semantic matching and watch the result count collapse and recover.

---

## Architecture

```
CPSC recall database          Apify actors
(saferproducts.gov API)       (Amazon / Walmart / eBay search)
        │                              │
        │  877 recalls, 24 months      │  ~1,250 live listings
        └──────────────┬───────────────┘
                       ▼
              Elasticsearch Serverless
         semantic_text fields → auto embeddings
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  semantic match                  keyword match
  (the real join)                 (the control group)
        └──────────────┬───────────────┘
                       ▼
              deadstock-matches index
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
   Next.js UI                  Kibana Agent Builder
   (the wall of cards)         (3 tools: index search + 2 ES|QL)
```

**Three indices:**

| Index | Contents |
|---|---|
| `deadstock-recalls` | Normalized CPSC recalls with a `semantic_text` field |
| `deadstock-listings` | Scraped marketplace listings with a `semantic_text` field |
| `deadstock-matches` | The join — every match carries both its semantic score and whether keyword search would have found it |

That last column, `found_by_keyword`, is the whole argument. It's what makes the toggle possible.

---

## Why Elastic and not a vector database

Two things happen over one index:

1. **Semantic retrieval** does the messy part — matching regulatory language to marketing copy.
2. **ES|QL aggregations** answer the questions a regulator would actually ask, over the same data, with no second system:

```esql
FROM deadstock-matches
| WHERE days_since_recall >= ?min_days
| STATS still_listed = COUNT(*),
        avg_price = ROUND(AVG(price_usd), 2),
        oldest_recall_days = MAX(days_since_recall)
    BY hazard_type, retailer
| SORT still_listed DESC
| LIMIT ?limit
```

A vector database gives you the first half.

---

## Stack

- **TypeScript / Node 20+**
- **Next.js 15** (App Router) — UI and API routes
- **Elasticsearch Serverless** — `semantic_text` for zero-setup embeddings
- **Kibana Agent Builder** (GA since Jan 2026) — the conversational layer
- **Apify** — live retail scraping
- **Tailwind CSS v4**

---

## Quick start

```bash
git clone <this-repo> && cd deadstock
npm install
cp .env.example .env.local     # fill in your keys
npm run preflight              # verifies Elastic + Kibana + Apify before you spend anything
```

Then run the pipeline in order. Every stage caches to `data/`, so you can replay any step without re-scraping or re-paying:

```bash
npm run pipeline:recalls    # 01 + 02 — fetch and normalize CPSC recalls
npm run pipeline:queries    # 03 — derive shopper-language search terms
npm run pipeline:scrape     # 04 — Apify, all three retailers  (costs ~$2.50)
npm run pipeline:index      # 05 — create indices, bulk index with embeddings
npm run pipeline:match      # 06 — the semantic join
npm run agent:setup         # 07 — create Agent Builder tools + agent via API

npm run dev                 # http://localhost:3000
```

### Environment

```bash
ELASTIC_ENDPOINT=https://your-project.es.us-east-1.aws.elastic.cloud
ELASTIC_API_KEY=
KIBANA_URL=https://your-project.kb.us-east-1.aws.elastic.cloud
APIFY_TOKEN=
APIFY_MAX_CHARGE_USD=1.50
```

The Kibana URL is **not** the Elasticsearch URL — same project, `.kb.` instead of `.es.`. Agent Builder APIs live on Kibana; index APIs live on Elasticsearch.

---

## Things that will bite you

Everything here was verified live against the real APIs, not read from docs.

**The CPSC API returns HTTP 200 for errors.** A bad date gives you a single poison record with `RecallID: 0` and a title starting `"Error retrieving Recalls"`. Guard on both.

**Unknown query parameters are silently ignored.** Typo `RecallDateStart` and you get all 9,927 records instead of your filtered window, with no warning. Assert your result count.

**Half the structured fields are dead.** `Hazards[].HazardType`, `Products[].Model`, and `Products[].Description` are empty in 100% of records. `Products[].Type` stopped being populated after 2016. There is no `Brand` field — it hides inside `Importers[].Name` as `"... dba SomeBrand, of China"`. Everything useful must be parsed out of prose.

**Elastic's default embedding model changed twice recently.** On Serverless it's now `.jina-embeddings-v5-text-small` — not ELSER. Tutorials telling you to deploy ELSER manually are obsolete. `npm run preflight` probes your project and tells you what you actually have; pin that ID in your mappings.

**The `semantic` query is deprecated.** Use `match` on the `semantic_text` field. Always `_source.excludes` that field or you ship embeddings on every response.

**The eBay actor sometimes returns foreign currency with no currency field.** Its residential proxy drifts to a non-US exit IP and prices come back as `"COP $84,119.19"` with `price: 84119.19`. There's no `proxyCountry` input to pin it. Parse the symbol out of `priceString` and reject anything that isn't a clean leading `$`.

**`brand` is always empty on Amazon and Walmart listings.** Search-result cards don't carry it. Don't build matching logic on it.

**Bulk indexing into `semantic_text` is slow.** Embedding generation happens inside the bulk request. Use `concurrency: 1`, `flushBytes: 1_000_000`, and a 120-second request timeout, or you'll hit HTTP 429 from the inference service.

---

## Cost

Runs inside the Apify free tier ($5/month, no credit card).

| Retailer | Queries | Results each | Cost |
|---|---|---|---|
| Amazon | 40 | 20 | $0.80 |
| eBay | 20 | 15 | $1.04 |
| Walmart | 15 | 10 | $0.69 |
| | | **Total** | **$2.53** |

Every actor call passes `maxTotalChargeUsd` as a circuit breaker. Elasticsearch runs on the 14-day Serverless free trial.

---

## Accuracy and limitations

Read this part before drawing conclusions from anything Deadstock shows you.

Matches are **generated algorithmically** by comparing recall notices to scraped marketplace listings. A match indicates a likely product correspondence, **not a verified one**. A listing may be:

- a different variant or model than the recalled unit
- a corrected version produced after the recall
- a different seller reusing similar listing copy
- a relisting of the same product under a new name

Every match carries a confidence tier, and low-confidence matches are labeled as such in the UI. Every card links to the original CPSC notice so you can check the work.

**Deadstock is a research demo, not a compliance tool.** The right conclusion from a match is "this deserves a look," not "this company is breaking the law."

---

## Data sources

- **[CPSC Recall API](https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information)** — `saferproducts.gov/RestWebServices/Recall`. Public, free, no authentication, no rate limit. 9,927 recalls back to 1973.
- **[Apify](https://apify.com)** — `santamaria-automations/amazon-search-scraper`, `automation-lab/walmart-scraper`, `automation-lab/ebay-scraper`.

Recall data is public domain. Listing data is scraped from public search result pages and stored only for the duration of a demo run.

---

## License

MIT
