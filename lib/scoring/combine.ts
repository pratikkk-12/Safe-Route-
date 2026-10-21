import type { ComponentKey } from "./config";

/** Normalized weighted components; lighting may be null (missing). */
export type Components = Record<ComponentKey, number | null>;

/**
 * Weighted mean of the available components. Missing (null) and excluded components
 * drop out and the remaining weights are scaled up proportionally to sum to 1.
 */
export function weightedScore(
  c: Components,
  weights: Record<ComponentKey, number>,
  exclude: ComponentKey[] = [],
): number {
  let sum = 0;
  let wSum = 0;
  for (const k of Object.keys(weights) as ComponentKey[]) {
    const v = c[k];
    if (v === null || v === undefined || exclude.includes(k)) continue;
    sum += weights[k] * v;
    wSum += weights[k];
  }
  return wSum > 0 ? sum / wSum : 0;
}

/**
 * Transit is a bonus: it can raise a score, but lacking it may lower an above-median
 * cell at most to the median, and never lowers a below-median cell.
 */
export function applyTransitFloor(withTransit: number, withoutTransit: number, median: number): number {
  return Math.max(withTransit, Math.min(withoutTransit, median));
}

/** 0..1 weighted score plus a report adjustment in points, clamped and rounded to 0..100. */
export function finalScore(weighted: number, adjustmentPoints: number | null): number {
  return Math.round(Math.min(100, Math.max(0, weighted * 100 + (adjustmentPoints ?? 0))));
}

export type Confidence = "high" | "medium" | "low";
const LEVELS: Confidence[] = ["low", "medium", "high"];

/**
 * high = real lit data AND minPois+ POIs nearby; medium = one of them; low = neither.
 * Qualifying community reports raise it one level.
 */
export function confidenceFor(hasRealLit: boolean, poisNearby: number, minPois: number, hasReports = false): Confidence {
  const n = Number(hasRealLit) + Number(poisNearby >= minPois) + Number(hasReports);
  return LEVELS[Math.min(2, n)];
}

/** Too little mapped data to score: few POIs, no real lighting data and no qualifying reports. */
export function isInsufficientData(poisNearby: number, hasRealLit: boolean, hasReports: boolean, minPois: number): boolean {
  return poisNearby < minPois && !hasRealLit && !hasReports;
}
