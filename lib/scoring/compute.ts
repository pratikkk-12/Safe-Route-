// Computes the Night Activity Score for every cell and hour from loaded data.
// Pure: no database access, so it can be unit-tested with a tiny synthetic city.
import { cellToLatLng, gridDisk } from "h3-js";
import { haversineM, type LonLat } from "@/lib/geo/line";
import type { OsmType, PoiCategory } from "@/lib/osm/classify";
import {
  applyTransitFloor,
  confidenceFor,
  finalScore,
  isInsufficientData,
  weightedScore,
  type Components,
  type Confidence,
} from "./combine";
import {
  TRANSIT_CATEGORIES,
  anchorsValue,
  isAnchorHospital,
  lightingValue,
  reportsAdjustment,
  roadTypeValue,
  type ReportInput,
  type RoadTotals,
} from "./components";
import type { ScoreConfig } from "./config";
import { poiOpenByHour } from "./hours";
import { makeNormalizer, percentile } from "./normalize";

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

export interface PoiInput {
  category: PoiCategory;
  name: string | null;
  openingHours: string | null;
  is24x7: boolean;
  emergency: boolean;
  osmType: OsmType;
  lon: number;
  lat: number;
  h3: string;
}

/**
 * Default opening hours when a POI has no valid tag. Anchor hospitals default to the
 * category default (24x7); other "hospitals" (mostly clinics) to nonAnchorHospitalHours.
 */
export function defaultHoursFor(p: PoiInput, cfg: ScoreConfig): string {
  if (p.category === "hospital" && !isAnchorHospital(p)) return cfg.nonAnchorHospitalHours;
  return cfg.openingHoursDefaults[p.category];
}

export interface ScoringInput {
  pois: PoiInput[];
  roads: Map<string, RoadTotals>;
  reports: Map<string, ReportInput[]>;
}

/** One cell; every array is indexed by hour (0..23). */
export interface CellResult {
  h3: string;
  scores: number[];
  confidence: Confidence[];
  /** Too little data: the score is road type only, and the map shows "Not enough data". */
  insufficient: boolean[];
  /** Report adjustment in points, or null when reports don't qualify. */
  reportsAdjustment: (number | null)[];
  /** Weighted components (lighting null when missing). */
  components: Components[];
  /** POIs in the cell plus ring-1, any category. */
  poisNearby: number;
  /** Non-transit POIs open per hour in the cell plus ring-1 (raw, before normalization). */
  openNearby: number[];
}

export interface ScoringResult {
  cells: CellResult[];
  stats: {
    hospitals: number;
    anchorHospitals: number;
    /** Anchor hospitals that qualify via emergency=yes (the rest by name + building outline). */
    anchorHospitalsEmergency: number;
    police: number;
    fuel24x7: number;
    cellsWithRealLit: number;
    /** Median with-transit score per hour over cells with enough data (0..1). */
    medians: number[];
  };
}

const EMPTY_ROADS: RoadTotals = { totalM: 0, mainM: 0, litYesM: 0, litNoM: 0 };

function nearestM(from: LonLat, targets: LonLat[]): number {
  let best = Infinity;
  for (const t of targets) {
    const d = haversineM(from, t);
    if (d < best) best = d;
  }
  return best;
}

export function computeCellScores(input: ScoringInput, cfg: ScoreConfig): ScoringResult {
  // Per-cell hourly sums of "open" POIs, split into transit and everything else.
  const openByCell = new Map<string, Float64Array>();
  const transitByCell = new Map<string, Float64Array>();
  const countByCell = new Map<string, number>();
  const police: LonLat[] = [];
  const hospitals: LonLat[] = [];
  const fuel: LonLat[] = [];
  let hospitalCount = 0;
  let emergencyCount = 0;

  for (const p of input.pois) {
    const hours = poiOpenByHour(p, defaultHoursFor(p, cfg));
    const target = TRANSIT_CATEGORIES.has(p.category) ? transitByCell : openByCell;
    let arr = target.get(p.h3);
    if (!arr) target.set(p.h3, (arr = new Float64Array(24)));
    for (const h of HOURS) arr[h] += hours[h];
    countByCell.set(p.h3, (countByCell.get(p.h3) ?? 0) + 1);

    const at: LonLat = [p.lon, p.lat];
    if (p.category === "police") police.push(at);
    if (p.category === "hospital") {
      hospitalCount++;
      if (isAnchorHospital(p)) hospitals.push(at);
      if (p.emergency) emergencyCount++;
    }
    if (p.category === "fuel" && hours.every((v) => v === 1)) fuel.push(at);
  }

  const cellIds = [...new Set([...input.roads.keys(), ...input.pois.map((p) => p.h3)])].sort();
  const n = cellIds.length;

  // Raw values. Road type, lighting and anchors are already meaningful 0..1 shares.
  const rawOpen: Float64Array[] = [];
  const logOpen: Float64Array[] = [];
  const logTransit: Float64Array[] = [];
  const lighting: (number | null)[] = [];
  const roadType: number[] = [];
  const anchors: number[] = [];
  const poisNearby: number[] = [];

  for (const id of cellIds) {
    const open = new Float64Array(24);
    const transit = new Float64Array(24);
    let count = 0;
    for (const nb of gridDisk(id, 1)) {
      const o = openByCell.get(nb);
      const t = transitByCell.get(nb);
      for (const h of HOURS) {
        if (o) open[h] += o[h];
        if (t) transit[h] += t[h];
      }
      count += countByCell.get(nb) ?? 0;
    }
    rawOpen.push(open);
    logOpen.push(open.map(Math.log1p));
    logTransit.push(transit.map(Math.log1p));
    poisNearby.push(count);

    const roads = input.roads.get(id) ?? EMPTY_ROADS;
    lighting.push(lightingValue(roads, cfg.lighting.minTaggedShare));
    roadType.push(roadTypeValue(roads));

    const [lat, lng] = cellToLatLng(id);
    const centre: LonLat = [lng, lat];
    anchors.push(
      anchorsValue(
        { policeM: nearestM(centre, police), hospitalM: nearestM(centre, hospitals), fuelM: nearestM(centre, fuel) },
        cfg.anchors,
      ),
    );
  }

  // Count components: log(1 + count), clipped at city-wide percentiles over all
  // cell-hours, so night stays lower than day.
  const flat = (arrs: Float64Array[]) => {
    const out = new Float64Array(arrs.length * 24);
    arrs.forEach((a, i) => out.set(a, i * 24));
    return out;
  };
  const normOpen = makeNormalizer(flat(logOpen), cfg.countPercentileClip);
  const normTransit = makeNormalizer(flat(logTransit), cfg.countPercentileClip);

  // Per cell-hour: components, both weighted scores, report adjustment and data sufficiency.
  const components: Components[][] = [];
  const withT: Float64Array[] = [];
  const withoutT: Float64Array[] = [];
  const adjustments: (number | null)[][] = [];
  const insufficient: boolean[][] = [];
  for (let i = 0; i < n; i++) {
    const cellReports = input.reports.get(cellIds[i]) ?? [];
    const perHour: Components[] = [];
    const w = new Float64Array(24);
    const wo = new Float64Array(24);
    const adj: (number | null)[] = [];
    const insuf: boolean[] = [];
    for (const h of HOURS) {
      const c: Components = {
        openPlaces: normOpen(logOpen[i][h]),
        lighting: lighting[i],
        roadType: roadType[i],
        anchors: anchors[i],
        transit: normTransit(logTransit[i][h]),
      };
      perHour.push(c);
      w[h] = weightedScore(c, cfg.weights);
      wo[h] = weightedScore(c, cfg.weights, ["transit"]);
      const a = reportsAdjustment(cellReports, h, cfg.reports);
      adj.push(a);
      insuf.push(isInsufficientData(poisNearby[i], lighting[i] !== null, a !== null, cfg.insufficientData.minPoisNearby));
    }
    components.push(perHour);
    withT.push(w);
    withoutT.push(wo);
    adjustments.push(adj);
    insufficient.push(insuf);
  }

  // The transit floor uses the median over cells with enough data; thousands of empty
  // cells would otherwise drag it to ~0.
  const medians = HOURS.map((h) => {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) if (!insufficient[i][h]) vals.push(withT[i][h]);
    return vals.length ? percentile(Float64Array.from(vals).sort(), 50) : 0;
  });

  const cells: CellResult[] = cellIds.map((h3, i) => ({
    h3,
    poisNearby: poisNearby[i],
    openNearby: Array.from(rawOpen[i], (v) => Math.round(v * 100) / 100),
    insufficient: insufficient[i],
    reportsAdjustment: adjustments[i],
    components: components[i],
    confidence: HOURS.map((h) =>
      confidenceFor(lighting[i] !== null, poisNearby[i], cfg.confidence.minPoisNearby, adjustments[i][h] !== null),
    ),
    scores: HOURS.map((h) =>
      insufficient[i][h]
        ? // Not enough data: road type only (used by routing; the map shows "Not enough data").
          finalScore(roadType[i], null)
        : finalScore(applyTransitFloor(withT[i][h], withoutT[i][h], medians[h]), adjustments[i][h]),
    ),
  }));

  return {
    cells,
    stats: {
      hospitals: hospitalCount,
      anchorHospitals: hospitals.length,
      anchorHospitalsEmergency: emergencyCount,
      police: police.length,
      fuel24x7: fuel.length,
      cellsWithRealLit: lighting.filter((v) => v !== null).length,
      medians,
    },
  };
}
