import type { ComponentKey } from "./config";

/** Normalized component values; lighting may be null (missing). */
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
    if (v === null || exclude.includes(k)) continue;
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

export function toScore(x: number): number {
  return Math.round(Math.min(1, Math.max(0, x)) * 100);
}

export type Confidence = "high" | "medium" | "low";

export function confidenceFor(hasRealLit: boolean, poisNearby: number, minPois: number): Confidence {
  const n = Number(hasRealLit) + Number(poisNearby >= minPois);
  return n === 2 ? "high" : n === 1 ? "medium" : "low";
}
