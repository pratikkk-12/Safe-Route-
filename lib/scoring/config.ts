import raw from "@/config/score-weights.json";
import type { PoiCategory } from "@/lib/osm/classify";

export const COMPONENT_KEYS = ["openPlaces", "lighting", "roadType", "anchors", "transit", "reports"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];

export interface ScoreConfig {
  weights: Record<ComponentKey, number>;
  /** Clip percentiles for every component except open places. */
  percentileClip: [number, number];
  /** Open places are normalized on log(1 + count) with their own clip. */
  openPlaces: { percentileClip: [number, number] };
  lighting: { minTaggedShare: number };
  anchors: { fullCreditM: number; zeroCreditM: number };
  reports: { maxAgeDays: number; windowHours: number; halfLifeDays: number; saturation: number };
  confidence: { minPoisNearby: number };
  /** OSM opening_hours syntax, used only when a POI has no (valid) tag. */
  openingHoursDefaults: Record<PoiCategory, string>;
  /** Default for hospitals that are not anchors (mostly clinics). Anchors use openingHoursDefaults.hospital. */
  nonAnchorHospitalHours: string;
}

/** Throws if the config is incomplete or the weights don't sum to 1. */
export function validateConfig(cfg: ScoreConfig): ScoreConfig {
  for (const k of COMPONENT_KEYS) {
    if (typeof cfg.weights[k] !== "number" || cfg.weights[k] < 0) {
      throw new Error(`score-weights.json: weights.${k} must be a non-negative number`);
    }
  }
  const sum = COMPONENT_KEYS.reduce((s, k) => s + cfg.weights[k], 0);
  if (Math.abs(sum - 1) > 1e-6) throw new Error(`score-weights.json: weights sum to ${sum}, expected 1`);
  for (const [name, [lo, hi]] of [
    ["percentileClip", cfg.percentileClip],
    ["openPlaces.percentileClip", cfg.openPlaces?.percentileClip ?? [NaN, NaN]],
  ] as const) {
    if (!(lo >= 0 && hi <= 100 && lo < hi)) throw new Error(`score-weights.json: ${name} must be [lo, hi] with 0 <= lo < hi <= 100`);
  }
  if (!cfg.nonAnchorHospitalHours) throw new Error("score-weights.json: nonAnchorHospitalHours is required");
  return cfg;
}

export const scoreConfig: ScoreConfig = validateConfig(raw as ScoreConfig);
