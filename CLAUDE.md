# DEADSTOCK — project context for Claude Code

Read this first. Then read `DEADSTOCK-BUILD-PLAN.md` for the verified API details,
and `THEME.md` before writing any markup or CSS — do not invent colors, sizes, or
font weights that aren't in its tables. `theme.css` is the drop-in stylesheet and
`index.html` at the repo root is a working reference implementation of every component.
Do not re-research anything marked ✅ VERIFIED — it was tested live against the real APIs on 2026-07-31.

---

## 1. The situation, right now

This is being built **live, at the event, under a hard clock.**

| | |
| --- | --- |
| Event | The Great Austin AI Agent Roundup: Elastic + Apify Hack Night |
| Where | Elasticsearch, Inc — 823 N Congress Ave, 8th Floor, Austin TX 78701 |
| When | Friday July 31 2026, 5:00–9:00 PM CDT |
| Hacking window | 6:20 – 8:30 PM CDT |
| Lightning demos | 8:30 – 9:00 PM CDT, 5 minutes each |
| Hosts | Michael Daigler, Sophia Solomon, Olivia Petrie ("You Know, for Search") |
| Builder | Firus Hanov, solo (teams up to 3 allowed) |

**Hard freeze is 8:15 PM.** After that: no new features, only push + submit + rehearse.

If you are reading this after 8:30 PM CDT on 2026-07-31, the deadline has passed —
ask before assuming the goal is still a demo.

---

## 2. The challenge and how it is scored

> **Challenge:** Use Apify and Elastic to build an Agent that pulls real-time web data
> and translates it into actionable insights.

**30 points total.** Every build decision should be traceable to one of these.

| | pts | what they actually ask |
| --- | --- | --- |
| **Creativity** | 10 | Is it something we've all seen before? Does it apply to a real-world problem? Does it relate to a personal use case? |
| **Completeness** | 10 | Does it work? Fully deployed (great if so)? Does the agent give relevant info for the stated use case? |
| **Understanding** | 10 | Can you explain *how and why* you used Apify and Elastic, aside from the prizes? |

**Explicitly called out as already-seen — avoid:** social media monitoring, competitor
price/product monitoring, support agent for OSS repos, personal wardrobe curator with
second-hand prices, real-time job aggregators.

Deadstock avoids all five. That is deliberate.

**Prizes:** 1st — first dibs on the Elastic Lego set + $500 Visa · 2nd — $250 · 3rd — $100.

---

## 3. What Deadstock is, in one paragraph

The US government recalls products for being dangerous. Companies are supposed to pull
them off the shelves. Many never come off. **Deadstock proves it:** it pulls the federal
CPSC recall database, scrapes live marketplace listings via Apify, and uses Elasticsearch
`semantic_text` to match the two. The output is recalled products you can still buy right now.

**The demo line:** *"This dresser was recalled because it can tip over and crush a child.
Here it is, $140, ships tomorrow."*

⚠️ **Do not say "killed a child" unless that specific recall documents a fatality.**
The EnHomee hero record lists `Injuries: [{"Name": "None reported"}]` — the hazard is
risk of death, not a recorded death. Check `Injuries[]` and `injury_severity` on whatever
record you actually demo, and match the verb to the record. A judge can open the CPSC
notice on their phone in fifteen seconds. Overclaiming once costs the whole credibility
argument you built the honesty guardrails in §10 to protect.

Name was chosen over the alternatives *Unrecalled* and *Revenant*.

---

## 4. Why this needs Elastic specifically — the Understanding points

Say this out loud in the demo. It is 10 of the 30 points.

A recall notice says:
> *"EnHomee 15-Drawer 51-inch Dressers... unstable if not anchored to the wall,
> posing tip-over and entrapment hazards."*

The Amazon listing says:
> *"15 Drawer Dresser for Bedroom, Tall Fabric Chest of Drawers with Side Pockets,
> Sturdy Metal Frame, Wood Top, Closet Organizer for Nursery"*

**Zero meaningful words overlap.** Keyword search finds nothing. Vector embeddings find it
instantly, because *dresser*, *chest of drawers*, and *clothing storage unit* live next to
each other in embedding space. That is the whole product.

Then the second half: once matched, **ES|QL** answers the aggregate questions a regulator
would actually ask — how many recalled products are still live, grouped by hazard type, by
retailer, by how long ago they were recalled. **Semantic search plus real aggregations over
one index is the thing Elastic does that a plain vector database cannot.**

That two-part argument — semantic join *and* aggregation — is the answer to "why Elastic."
Apify's half of the answer: the recall database is public and static; *what is for sale right
now* exists only on the live web, and there is no API for it.

---

## 5. The 84-minute cut plan (authored 7:06 PM)

The full build plan budgets ~175 minutes for phases 0–4. That does not fit. These cuts are made:

| decision | why |
| --- | --- |
| ❌ **Cut the Next.js UI entirely** | 60 min of the 175. Demo in Kibana Agent Chat instead — it reads as intentional and the challenge is literally "build an Agent." |
| ❌ **Cut Walmart and eBay** | Amazon is named in 54% of recalls; the santamaria actor is ~10× faster than the alternatives. One retailer proves the thesis. |
| ✅ **Keep the keyword-vs-semantic contrast** | Run it as two queries side by side in **Kibana Dev Tools**, not a UI toggle. Same impact, zero build cost. |
| ✅ **Keep Agent Builder** | Non-negotiable. It is the scored deliverable. |
| ⚠️ **Ignore Apify cost optimization** | The coupon `ELASTIC_APIFY_HCK_NGHT` gives $50 of platform usage, not the $5 free tier the build plan assumes. Do not spend a minute on this. |

| time | do | cutoff rule |
| --- | --- | --- |
| 7:06–7:15 | Preflight. Elastic endpoint + key + Apify token in `.env.local`. Probe `/_inference`, pin the id | Five green checks or stop and fix |
| 7:15–7:30 | CPSC fetch → normalize → top 20 recalls → build queries | **Print the queries and eyeball them before spending money** |
| 7:30–7:42 | Scrape Amazon only. Cache to `data/` | If the actor misbehaves, fall back to `automation-lab/amazon-scraper` |
| 7:42–8:00 | Index + match. Tune the threshold until matches look real | 20 solid matches beat 200 noisy ones |
| 8:00–8:12 | Agent Builder: 1 `index_search` tool + 1 ES\|QL tool + the agent. Test one question live | If the API route fights you, click it in the Kibana UI |
| 8:12–8:25 | Push to public GitHub. Submit Airtable. Rehearse twice out loud | **Hard freeze at 8:15** |

**Stretch, only if ahead at 8:00:** a single static `index.html` reading `data/06-matches.json`.
Not Next.js. Not a build step.

**Definition of done:** the agent answers one question live in Kibana Agent Chat, over data
Apify scraped less than an hour ago, and the repo is public and submitted.

---

## 6. Stack — already decided, do not re-litigate

| layer | choice |
| --- | --- |
| Language | TypeScript, Node 20+ |
| Search | Elasticsearch Serverless (14-day trial, signup `ela.st/hack-austin`) |
| Agent | Kibana Agent Builder (GA since Jan 2026) — judges want the actual Elastic product, not LangChain |
| Scraping | Apify, `santamaria-automations/amazon-search-scraper` |
| Pipeline | Standalone numbered `tsx` scripts, each caching JSON to `data/` |

**The caching is non-negotiable.** Every stage writes to `data/` and re-reads from disk unless
`--force` is passed. If the venue wifi dies at 8:29, the demo still runs off cache.

---

## 7. Landmines that will cost you the night

Full detail in `DEADSTOCK-BUILD-PLAN.md` §6–§8. The four that actually bite:

1. **CPSC silently ignores unknown params.** `recallDateStart` (lowercase r) "works" and returns
   all 9,927 records instead of 877. **Assert `res.length < 2000` before continuing.**
2. **CPSC returns errors as HTTP 200** with a single poison record. Treat `RecallID === 0` as fatal.
3. **The default embedding model is `.jina-embeddings-v5-text-small` on serverless**, not ELSER.
   Every blog post online is wrong. Probe `/_inference` and **pin the id explicitly** in mappings.
4. **Kibana URL ≠ Elasticsearch URL.** Same project, `.kb.` instead of `.es.`. Agent Builder APIs
   live on Kibana. Mixing them produces confusing 404s.

Also: `semantic_text` bulk indexing generates embeddings *inside* the request. Set
`concurrency: 1`, `flushBytes: 1_000_000`, `requestTimeout: 120_000`, or you get 429s.

---

## 8. Submission — do not let this slip

Airtable form, password `yeehaw`. Required:

- [ ] **Public** GitHub repo → https://github.com/firushanov/Deadstock (currently public, empty)
- [ ] Description of the project
- [ ] Explanation of why/how you used Elastic and Apify
- [ ] Name and email — Firus Hanov, hanovconsulting@gmail.com

Ready-to-paste blurb is in the build plan §15.

Other links: Apify coupon `ELASTIC_APIFY_HCK_NGHT` ·
reference repo https://github.com/0xmerkle/apify-elastic-example ·
slides https://docs.google.com/presentation/d/1HQCSuBPXlVYWigudyp9Vp40D601NaJfgewmy8CPTMjM/edit

---

## 9. Demo rules

Open with the question, not the architecture. Architecture-first demos lose rooms.

1. Ask the agent something out loud. Let the real answer render.
2. Click through to one live listing. **Never click Buy** — say "I'm not going to click that."
   The room laughs and it's a better beat than doing it.
3. *Then* 30 seconds on how Apify + Elastic made it possible.
4. Show the keyword-vs-semantic contrast in Dev Tools. Two queries, same index, ~40 → ~2.
5. Pre-load every tab. Browser zoom 125%. Notifications off.

If the scrape is stale, "scraped forty minutes ago" is still true — it just isn't *this* forty minutes.

---

## 10. Honesty guardrails — build them in, don't bolt them on

This project makes accusations. They have to be defensible, and being careful here **scores
points** rather than costing them.

- Every match shows a confidence level; low-confidence matches say so.
- Language is "likely match" / "appears to be" — **never** "is."
- Every card links to the CPSC notice so the viewer can verify you.
- Don't name-and-shame a specific seller from the stage. Show the listing, describe the pattern.
- The footer disclaimer stays visible: matches are algorithmic, a listing may be a corrected
  version or a different variant, this is a research demo and not a compliance tool.
- The right ask is *"this deserves a look,"* not *"this company is breaking the law."*
  You built a lead generator for regulators, not a verdict.

---

## 11. Who is building this

Firus Hanov — founder of Hanov Consulting (Austin), Salesforce Certified Developer with 8+ years
enterprise experience, author of *Learning Apex*. **Primary language is Apex**, so lean toward
explicit, well-commented TypeScript over clever idioms.

- **Knows Apify already.** Has never used Elastic — this is the first project on it, so explain
  Elastic concepts rather than assuming them.
- Won the Red Hat Live Data Track and the Commercialization Bounty at the AITX × NVIDIA hackathon
  (July 17–19 2026) with Team Compli. Knows how to ship under a clock and how to pitch.
- **Michael Daigler, one of tonight's hosts, was a Compli teammate.** Friendly room, not a
  reason to coast.
- Communication preference: plain English, short sentences, jargon spelled out.

---

## 12. Prior context worth knowing

- The first attempt tonight was **release-radar** — a Python `ingest.py` / `query.py` scaffold
  following the reference repo. It was abandoned and moved to `_to_delete/`. Don't revive it.
- The full project folder is `~/Documents/Claude/Projects/Elastic - Apify - Hackathon`.
  Everything related to this project lives there.
- Three visual directions were explored for a Deadstock UI — Archive (editorial/paper),
  Warehouse (mono/inventory), After Hours (dark/acid accent). **Not relevant tonight** since
  the UI is cut, but the dark editorial palette in build plan §12 is the one to use if a UI
  ever gets built.
