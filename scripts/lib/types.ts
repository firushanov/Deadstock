// Shapes shared across the pipeline. All fields verified against live APIs on 2026-07-31
// (see DEADSTOCK-BUILD-PLAN.md §6 for CPSC, §7 for Apify actor outputs).

// ---------- CPSC raw ----------

export type RawRecall = {
  RecallID: number;
  RecallNumber: string | null;
  RecallDate: string; // ISO
  Description: string;
  URL: string;
  Title: string;
  Products: Array<{
    Name: string;
    Description: string; // always "" post-2016
    Model: string; // always ""
    Type: string;
    CategoryID: string;
    NumberOfUnits: string;
  }>;
  Images: Array<{ URL: string; Caption: string }>;
  Injuries: Array<{ Name: string }>;
  Manufacturers: Array<{ Name: string; CompanyID: string }>;
  Retailers: Array<{ Name: string; CompanyID: string }>; // Name is a full sentence, not a name
  Importers: Array<{ Name: string; CompanyID: string }>;
  Distributors: Array<{ Name: string; CompanyID: string }>;
  Hazards: Array<{ Name: string; HazardType: string; HazardTypeID: string }>; // HazardType always ""
  Remedies: Array<{ Name: string }>;
  RemedyOptions: Array<{ Option: string }>;
  ProductUPCs?: Array<{ UPC: string }>;
};

// ---------- Normalized ----------

export type Recall = {
  recall_id: string;            // stringified RecallID
  recall_number: string | null;
  recall_date: string;          // ISO date
  title: string;
  product_name: string;         // Products[0].Name
  brand: string | null;
  description: string;
  hazard_text: string;
  hazard_type: string;          // classified from hazard_text; see lib/hazard.ts
  hazard_label: string;
  injury_severity: "death" | "injury" | "none_reported";
  remedy_option: string | null;
  sold_at: string[];            // retailers found in Retailers[].Name prose
  price_hint: number | null;
  units: string | null;
  cpsc_url: string;
  image_url: string | null;
  search_text: string;          // what gets embedded (product_name . brand . description)
};

// ---------- Query ----------

export type QuerySpec = {
  recall_id: string;
  query: string;                // generic shopper phrase, <=6 words
};

// ---------- Apify raw (per retailer) ----------

export type RawAmazonListing = {
  asin?: string;
  title?: string;
  url?: string;
  searchQuery?: string;         // echoes input keyword; used to tie back to recall
  price?: { value?: number; currency?: string; raw?: string };
  listPrice?: { value?: number; currency?: string; raw?: string };
  stars?: number;
  reviewsCount?: number;
  thumbnailImage?: string;
  isSponsored?: boolean;
  isPrime?: boolean;
  availability?: string;
  positionOverall?: number;
  scrapedAt?: string;
};

// automation-lab/walmart-scraper (title lives in `name`, id in `usItemId`)
export type RawWalmartListing = {
  usItemId?: string;
  name?: string;
  price?: number;
  priceString?: string;         // "$19.88" — pass this through parseUsdPrice
  rating?: number;
  reviewCount?: number;
  seller?: string;
  fulfillmentType?: string;
  thumbnail?: string;
  url?: string;
  isSponsored?: boolean;
  scrapedAt?: string;
};

// automation-lab/ebay-scraper (id in `itemId`; ⚠ priceString sometimes ships in COP)
export type RawEbayListing = {
  itemId?: string;
  title?: string;
  price?: number;
  priceString?: string;         // ⚠ non-USD possible — parseUsdPrice drops it
  condition?: string;
  listingType?: string;
  sellerName?: string;
  sellerFeedbackPercent?: string;
  soldCount?: string;
  thumbnail?: string;
  url?: string;
  isSponsored?: boolean;
  scrapedAt?: string;
};

export type Retailer = "amazon" | "walmart" | "ebay";

// ---------- Normalized listing ----------

export type Listing = {
  listing_id: string;           // asin / usItemId / itemId
  retailer: Retailer;
  title: string;
  price_usd: number | null;     // null if not a clean leading $
  url: string;
  image_url: string | null;
  seller: string | null;
  rating: number | null;
  review_count: number | null;
  is_sponsored: boolean;
  source_query: string;
  source_recall: string;
  scraped_at: string;
};

// ---------- Match ----------

export type Match = {
  match_id: string;             // `${recall_id}::${listing_id}`
  recall_id: string;
  recall_number: string | null;
  recall_date: string;
  recall_title: string;
  recall_product: string;
  recall_image: string | null;
  cpsc_url: string;
  brand: string | null;
  hazard_type: string;
  hazard_text: string;
  injury_severity: Recall["injury_severity"];
  listing_id: string;
  listing_title: string;
  listing_url: string;
  listing_image: string | null;
  retailer: Listing["retailer"];
  price_usd: number | null;
  seller: string | null;
  semantic_score: number;
  keyword_score: number;
  found_by_keyword: boolean;    // powers the demo contrast
  confidence: "high" | "medium" | "low";
  days_since_recall: number;
  matched_at: string;
};
