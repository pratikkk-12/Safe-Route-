import raw from "@/config/score-weights.json";
import type { PoiCategory } from "@/lib/osm/classify";

/** Weighted components. Community reports are a separate post-score adjustment. */
export const COMPONENT_KEYS = ["openPlaces", "lighting", "roadType", "anchors", "transit"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];

export interface ScoreConfig {
  weights: Record<ComponentKey, number>;
  /** Count components (open places, transit) are normalized on log(1 + count) with this clip. */
  countPercentileClip: [number, number];
  lighting: { minTaggedShare: number };
  anchors: { fullCreditM: number; zeroCreditM: number };
  reports: {
    maxAgeDays: number;
    windowHours: number;
    halfLifeDays: number;
    saturation: number;
    /** Reports only count when they come from at least this many distinct ip_hashes. */
    minDistinctReporters: number;
    maxPenaltyPoints: number;
    maxBonusPoints: number;
  };
  confidence: { minPoisNearby: number };
  insufficientData: { minPoisNearby: number };
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
  const extra = Object.keys(cfg.weights).filter((k) => !(COMPONENT_KEYS as readonly string[]).includes(k));
  if (extra.length) throw new Error(`score-weights.json: unknown weights ${extra.join(", ")}`);
  // Weights are re-normalized at use, so allow rounding in the file.
  const sum = COMPONENT_KEYS.reduce((s, k) => s + cfg.weights[k], 0);
  if (Math.abs(sum - 1) > 1e-3) throw new Error(`score-weights.json: weights sum to ${sum}, expected 1`);
  const [lo, hi] = cfg.countPercentileClip ?? [NaN, NaN];
  if (!(lo >= 0 && hi <= 100 && lo < hi)) {
    throw new Error("score-weights.json: countPercentileClip must be [lo, hi] with 0 <= lo < hi <= 100");
  }
  if (!cfg.nonAnchorHospitalHours) throw new Error("score-weights.json: nonAnchorHospitalHours is required");
  if (!(cfg.reports?.minDistinctReporters >= 1)) throw new Error("score-weights.json: reports.minDistinctReporters must be >= 1");
  return cfg;
}

export const scoreConfig: ScoreConfig = validateConfig(raw as ScoreConfig);
