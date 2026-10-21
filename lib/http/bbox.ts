import { PUNE_BBOX } from "@/lib/config";

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Parse "w,s,e,n" from a query param and clamp it to the Pune area.
 * Returns null when missing or malformed.
 */
export function parseBbox(raw: string | null): Bbox | null {
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return null;
  return {
    west: Math.max(w, PUNE_BBOX.west),
    south: Math.max(s, PUNE_BBOX.south),
    east: Math.min(e, PUNE_BBOX.east),
    north: Math.min(n, PUNE_BBOX.north),
  };
}
