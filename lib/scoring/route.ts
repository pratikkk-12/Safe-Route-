// Scores a route geometry against cell_score. Pure: the caller supplies a lookup.
import { latLngToCell } from "h3-js";
import { sampleLine, type LonLat } from "@/lib/geo/line";
import { H3_RESOLUTION } from "@/lib/config";
import type { Components, Confidence } from "./combine";
import { COMPONENT_KEYS, type ComponentKey } from "./config";

export const SAMPLE_STEP_M = 25;
export const WINDOW_M = 200;
export const MEAN_WEIGHT = 0.7;
export const WINDOW_WEIGHT = 0.3;

export type Band = "green" | "amber" | "red" | "limited";

export const bandFor = (score: number, insufficient: boolean): Band =>
  insufficient ? "limited" : score >= 70 ? "green" : score >= 40 ? "amber" : "red";

export interface CellHourScore {
  score: number;
  confidence: Confidence;
  insufficient: boolean;
  components: Components;
}

/** Score of a cell at an hour, or undefined if the cell has no data at all. */
export type ScoreLookup = (h3: string, hour: number) => CellHourScore | undefined;

/** Used for points outside every scored cell (e.g. open land): limited data, score 0. */
const NO_CELL: CellHourScore = {
  score: 0,
  confidence: "low",
  insufficient: true,
  components: { openPlaces: null, lighting: null, roadType: null, anchors: null, transit: null },
};

export type ReasonKey = ComponentKey | "limitedData";

export const REASON_TEXT: Record<ReasonKey, string> = {
  openPlaces: "few places open at this hour",
  lighting: "roads mapped as unlit",
  roadType: "mostly small or residential roads",
  anchors: "far from police, hospitals and 24x7 fuel",
  transit: "no bus stops or stations in service",
  limitedData: "limited mapped data here",
};

export interface RouteSegment {
  band: Band;
  coords: LonLat[];
  lengthM: number;
}

export interface WeakestStretch {
  coords: LonLat[];
  startM: number;
  endM: number;
  lengthM: number;
  /** Length-weighted mean score over the stretch. */
  score: number;
  reasons: ReasonKey[];
  /** True when the stretch is a run of low-activity (red) scores rather than just the lowest 200 m. */
  lowActivity: boolean;
}

export interface RouteScore {
  score: number;
  meanScore: number;
  /** Lowest 200 m rolling average. */
  minWindowScore: number;
  confidence: { level: Confidence; shares: Record<Confidence, number> };
  /** Share (0..1) of the route length in "not enough data" cells. */
  limitedDataShare: number;
  /** Length of the longest continuous low-activity (score < 40) stretch, in metres. */
  longestLowRunM: number;
  segments: RouteSegment[];
  weakest: WeakestStretch;
  /** Length-weighted mean of each component over the scored (not limited) parts. */
  breakdown: Record<ComponentKey, number | null>;
  /** Hours (0..23) the route passes through. */
  hours: number[];
}

/**
 * @param coords route geometry ([lon, lat])
 * @param durationS route duration; time is spread evenly along the length
 * @param departMinutes departure time as minutes after local midnight (IST)
 */
export function scoreRoute(
  coords: LonLat[],
  durationS: number,
  departMinutes: number,
  lookup: ScoreLookup,
  weights: Record<ComponentKey, number>,
): RouteScore {
  const samples = sampleLine(coords, SAMPLE_STEP_M);
  const totalM = samples.length ? samples[samples.length - 1].distM : 0;

  // One segment per pair of consecutive samples, scored at its start point at the
  // hour that point is reached.
  interface Seg {
    a: LonLat;
    b: LonLat;
    startM: number;
    len: number;
    hour: number;
    s: CellHourScore;
  }
  const segs: Seg[] = [];
  const hours = new Set<number>();
  for (let i = 0; i + 1 < samples.length; i++) {
    const { point, distM } = samples[i];
    const len = samples[i + 1].distM - distM;
    if (len <= 0) continue;
    const t = totalM > 0 ? (durationS * distM) / totalM : 0;
    const hour = Math.floor((departMinutes + t / 60) / 60) % 24;
    hours.add(hour);
    const h3 = latLngToCell(point[1], point[0], H3_RESOLUTION);
    segs.push({ a: point, b: samples[i + 1].point, startM: distM, len, hour, s: lookup(h3, hour) ?? NO_CELL });
  }

  const lenSum = segs.reduce((s, x) => s + x.len, 0) || 1;
  const meanScore = segs.reduce((s, x) => s + x.s.score * x.len, 0) / lenSum;

  // Lowest rolling average over WINDOW_M (or the whole route if shorter).
  let best = { avg: Infinity, i: 0, j: Math.max(0, segs.length - 1) };
  if (totalM <= WINDOW_M) {
    best = { avg: meanScore, i: 0, j: segs.length - 1 };
  } else {
    let j = 0;
    let wLen = 0;
    let wSum = 0;
    for (let i = 0; i < segs.length; i++) {
      while (j < segs.length && wLen < WINDOW_M) {
        wLen += segs[j].len;
        wSum += segs[j].s.score * segs[j].len;
        j++;
      }
      if (wLen < WINDOW_M) break;
      const avg = wSum / wLen;
      if (avg < best.avg) best = { avg, i, j: j - 1 };
      wLen -= segs[i].len;
      wSum -= segs[i].s.score * segs[i].len;
    }
  }
  const minWindowScore = Number.isFinite(best.avg) ? best.avg : meanScore;
  const score = Math.round(MEAN_WEIGHT * meanScore + WINDOW_WEIGHT * minWindowScore);

  // Bands, merged into continuous coloured segments.
  const segments: RouteSegment[] = [];
  for (const x of segs) {
    const band = bandFor(x.s.score, x.s.insufficient);
    const last = segments[segments.length - 1];
    if (last && last.band === band) {
      last.coords.push(x.b);
      last.lengthM += x.len;
    } else {
      segments.push({ band, coords: [x.a, x.b], lengthM: x.len });
    }
  }
  const isLow = (x: Seg) => !x.s.insufficient && x.s.score < 40;
  let longestLowRunM = 0;
  let run = 0;
  for (const x of segs) {
    run = isLow(x) ? run + x.len : 0;
    longestLowRunM = Math.max(longestLowRunM, run);
  }

  // Weakest stretch: the lowest 200 m window, widened to the continuous low-activity run around it.
  let { i: wi, j: wj } = best;
  const lowActivity = segs.slice(wi, wj + 1).some(isLow);
  if (lowActivity) {
    while (wi > 0 && isLow(segs[wi - 1])) wi--;
    while (wj + 1 < segs.length && isLow(segs[wj + 1])) wj++;
  }
  const stretch = segs.slice(wi, wj + 1);
  const stretchLen = stretch.reduce((s, x) => s + x.len, 0);
  const weakest: WeakestStretch = {
    coords: stretch.length ? [stretch[0].a, ...stretch.map((x) => x.b)] : coords.slice(0, 2),
    startM: stretch[0]?.startM ?? 0,
    endM: stretch.length ? stretch[stretch.length - 1].startM + stretch[stretch.length - 1].len : 0,
    lengthM: stretchLen,
    score: stretchLen ? Math.round(stretch.reduce((s, x) => s + x.s.score * x.len, 0) / stretchLen) : 0,
    reasons: topReasons(stretch, weights),
    lowActivity,
  };

  // Confidence mix and limited-data share by length.
  const shares: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  let limitedM = 0;
  for (const x of segs) {
    shares[x.s.confidence] += x.len / lenSum;
    if (x.s.insufficient) limitedM += x.len;
  }
  const level = (["low", "medium", "high"] as const).reduce((a, b) => (shares[b] > shares[a] ? b : a));

  return {
    score,
    meanScore: Math.round(meanScore),
    minWindowScore: Math.round(minWindowScore),
    confidence: { level, shares },
    limitedDataShare: limitedM / lenSum,
    longestLowRunM,
    segments,
    weakest,
    breakdown: componentMeans(segs),
    hours: [...hours].sort((a, b) => a - b),
  };
}

function componentMeans(segs: { len: number; s: CellHourScore }[]): Record<ComponentKey, number | null> {
  const out = {} as Record<ComponentKey, number | null>;
  for (const k of COMPONENT_KEYS) {
    let sum = 0;
    let len = 0;
    for (const x of segs) {
      const v = x.s.components[k];
      if (x.s.insufficient || v === null || v === undefined) continue;
      sum += v * x.len;
      len += x.len;
    }
    out[k] = len > 0 ? sum / len : null;
  }
  return out;
}

/** The two components costing the stretch the most points (weight x shortfall). */
function topReasons(segs: { len: number; s: CellHourScore }[], weights: Record<ComponentKey, number>): ReasonKey[] {
  const len = segs.reduce((s, x) => s + x.len, 0) || 1;
  const limitedShare = segs.filter((x) => x.s.insufficient).reduce((s, x) => s + x.len, 0) / len;
  const reasons: ReasonKey[] = limitedShare > 0.5 ? ["limitedData"] : [];
  const means = componentMeans(segs);
  const losses = COMPONENT_KEYS.flatMap((k) => {
    const v = means[k];
    // Missing lighting isn't a reason (we don't know); only roads mapped as unlit are.
    if (v === null || (k === "lighting" && v >= 0.5)) return [];
    return [{ k, loss: weights[k] * (1 - v) }];
  })
    .filter((x) => x.loss > 0.02)
    .sort((a, b) => b.loss - a.loss);
  for (const { k } of losses) {
    if (reasons.length >= 2) break;
    reasons.push(k);
  }
  return reasons;
}
