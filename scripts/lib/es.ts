// Elasticsearch client singleton. Serverless requires serverMode: "serverless".
// 120s timeout because bulk-indexing into semantic_text does inference inline
// and small requests can still exceed the default (30s).

import { Client } from "@elastic/elasticsearch";
import { requireEnv } from "./env.ts";

export const es = new Client({
  node: requireEnv("ELASTIC_ENDPOINT"),
  auth: { apiKey: requireEnv("ELASTIC_API_KEY") },
  serverMode: "serverless",
  requestTimeout: 120_000,
});

export const INDEX = {
  recalls: "deadstock-recalls",
  listings: "deadstock-listings",
  matches: "deadstock-matches",
} as const;
