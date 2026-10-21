// Extra route candidates through high-activity cells (OSRM alternatives are chosen
// for speed, not activity). Pure helpers.
import { haversineM, overlapShare, type LonLat } from "@/lib/geo/line";
import type { LatLon, RouteOption } from "./types";

export const VIA_RADIUS_M = 1000;
export const VIA_MIN_SEPARATION_M = 300;
export const MAX_EXTRA_CANDIDATES = 2;
export const MAX_DURATION_RATIO = 1.5;
export const MAX_OVERLAP_SHARE = 0.8;

export interface ScoredCellPoint {
  score: number;
  lat: number;
  lon: number;
  insufficient?: boolean;
}

export const midpoint = (a: LatLon, b: LatLon): LatLon => ({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 });

/**
 * The highest-scoring cells within `radiusM` of the straight-line midpoint, at least
 * `minSeparationM` apart. Cells with insufficient data are skipped.
 */
export function pickViaPoints(
  from: LatLon,
  to: LatLon,
  cells: ScoredCellPoint[],
  { radiusM = VIA_RADIUS_M, minSeparationM = VIA_MIN_SEPARATION_M, count = MAX_EXTRA_CANDIDATES } = {},
): LatLon[] {
  const mid = midpoint(from, to);
  const near = cells
    .filter((c) => !c.insufficient && haversineM([mid.lon, mid.lat], [c.lon, c.lat]) <= radiusM)
    .sort((a, b) => b.score - a.score);
  const picked: LatLon[] = [];
  for (const c of near) {
    if (picked.length >= count) break;
    if (picked.every((p) => haversineM([p.lon, p.lat], [c.lon, c.lat]) >= minSeparationM)) {
      picked.push({ lat: c.lat, lon: c.lon });
    }
  }
  return picked;
}

const coords = (r: RouteOption): LonLat[] => r.geometry.coordinates;

/**
 * Merge provider routes and via candidates: drop any route more than 50% slower than
 * the fastest, and any that shares more than 80% of its length with a route already kept.
 * Provider routes are considered first, so they win ties.
 */
export function selectCandidates(
  routes: RouteOption[],
  extra: RouteOption[] = [],
  { maxDurationRatio = MAX_DURATION_RATIO, maxOverlap = MAX_OVERLAP_SHARE, max = 3 } = {},
): RouteOption[] {
  const all = [...routes, ...extra];
  if (all.length === 0) return [];
  const fastest = Math.min(...all.map((r) => r.duration_s));
  const kept: RouteOption[] = [];
  for (const r of all) {
    if (kept.length >= max) break;
    if (r.duration_s > fastest * maxDurationRatio) continue;
    if (kept.some((k) => overlapShare(coords(r), coords(k)) > maxOverlap)) continue;
    kept.push(r);
  }
  return kept;
}
