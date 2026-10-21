// Overpass API client for one-time ingestion scripts (never call per user request).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { USER_AGENT } from "@/lib/config";

export const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
/** Tried only for a tile that has exhausted its retries on OVERPASS_URL. */
export const OVERPASS_FALLBACK_URL =
  process.env.OVERPASS_FALLBACK_URL ?? "https://overpass.kumi.systems/api/interpreter";

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

/** Split a bbox into rows x cols tiles. */
export function tileBbox(b: Bbox, rows: number, cols: number): Bbox[] {
  const tiles: Bbox[] = [];
  const dLat = (b.north - b.south) / rows;
  const dLon = (b.east - b.west) / cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        south: +(b.south + r * dLat).toFixed(6),
        north: +(b.south + (r + 1) * dLat).toFixed(6),
        west: +(b.west + c * dLon).toFixed(6),
        east: +(b.west + (c + 1) * dLon).toFixed(6),
      });
    }
  }
  return tiles;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isCached(cacheDir: string, cacheKey: string): boolean {
  return existsSync(join(cacheDir, `${cacheKey}.json`));
}

/**
 * Run an Overpass query, caching the raw JSON on disk under `cacheDir/cacheKey.json`.
 * Retries 429 / 5xx with backoff on the main server, then falls back to the mirror
 * for this query only. Returns the elements and whether it hit the network.
 */
export async function overpass(
  query: string,
  opts: { cacheDir: string; cacheKey: string; refresh?: boolean },
): Promise<{ elements: OverpassElement[]; fromCache: boolean }> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const file = join(opts.cacheDir, `${opts.cacheKey}.json`);
  if (!opts.refresh && existsSync(file)) {
    return { elements: JSON.parse(readFileSync(file, "utf8")).elements, fromCache: true };
  }

  let text: string;
  try {
    text = await fetchWithRetry(OVERPASS_URL, query, 5);
  } catch (err) {
    if (!OVERPASS_FALLBACK_URL || OVERPASS_FALLBACK_URL === OVERPASS_URL) throw err;
    console.warn(`  ${opts.cacheKey}: main server failed (${(err as Error).message.split("\n")[0]})`);
    console.warn(`  ${opts.cacheKey}: retrying on mirror ${new URL(OVERPASS_FALLBACK_URL).host}...`);
    text = await fetchWithRetry(OVERPASS_FALLBACK_URL, query, 3);
  }
  writeFileSync(file, text);
  return { elements: JSON.parse(text).elements, fromCache: false };
}

/** POST a query to one Overpass server, retrying 429 / 5xx / network errors. Returns raw JSON text. */
async function fetchWithRetry(url: string, query: string, maxAttempts: number): Promise<string> {
  const host = new URL(url).host;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query }),
        // Queries ask for [timeout:180]; give up on a server that never answers.
        signal: AbortSignal.timeout(200_000),
      });
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.warn(`  ${host}: network error (${(err as Error).message}), retrying...`);
      await sleep(10_000 * attempt);
      continue;
    }

    if (res.ok) {
      const text = await res.text();
      const json = JSON.parse(text) as { elements: OverpassElement[]; remark?: string };
      // Overpass reports server-side timeouts as a 200 with a "remark".
      if (json.remark && /timed out|out of memory/i.test(json.remark)) {
        throw new Error(`${host} gave up on this tile: ${json.remark}. Try more tiles (--tiles=6).`);
      }
      return text;
    }

    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const wait = 30_000 * attempt;
      console.warn(`  ${host} busy (HTTP ${res.status}), waiting ${wait / 1000}s before retry ${attempt + 1}/${maxAttempts}...`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${host} HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  throw new Error("unreachable");
}
