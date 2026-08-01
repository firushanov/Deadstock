// Load .env.local for every script. dotenv is used instead of Node's --env-file so we
// tolerate missing values gracefully -- some scripts (like 01-fetch-recalls) don't need
// Elastic or Apify creds and shouldn't fail when they're absent.

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

config({ path: resolve(repoRoot, ".env.local") });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}. Add it to .env.local (see .env.example).`);
  }
  return v.trim();
}

export function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

export const REPO_ROOT = repoRoot;
export const DATA_DIR = resolve(repoRoot, "data");
