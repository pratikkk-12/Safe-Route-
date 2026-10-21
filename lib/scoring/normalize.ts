/** Linear-interpolated percentile (p in 0..100) of an ascending-sorted array. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Build a 0..1 normalizer from city-wide values, clipping at the given percentiles.
 * If the clip range is empty (lo == hi), values above it map to 1 and the rest to 0.
 */
export function makeNormalizer(values: ArrayLike<number>, [pLo, pHi]: [number, number]) {
  const sorted = Float64Array.from(values).sort();
  const lo = percentile(sorted, pLo);
  const hi = percentile(sorted, pHi);
  const normalize = (v: number) => {
    if (!(hi > lo)) return v > lo ? 1 : 0;
    return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  };
  return Object.assign(normalize, { lo, hi });
}
