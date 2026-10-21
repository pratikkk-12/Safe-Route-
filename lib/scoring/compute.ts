// Computes the Night Activity Score for every cell and hour from loaded data.
// Pure: no database access, so it can be unit-tested with a tiny synthetic city.
import { cellToLatLng, gridDisk } from "h3-js";
import { haversineM, type LonLat } from "@/lib/geo/line";
import type { PoiCategory } from "@/lib/osm/classify";
import { applyTransitFloor, confidenceFor, toScore, weightedScore, type Components, type Confidence } from "./combine";
import {
  TRANSIT_CATEGORIES,
  anchorsValue,
  isAnchorHospital,
  lightingValue,
  reportsValue,
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
  lon: number;
  lat: number;
  h3: string;
}

export interface ScoringInput {
  pois: PoiInput[];
  roads: Map<string, RoadTotals>;
  reports: Map<string, ReportInput[]>;
}

export interface CellResult {
  h3: string;
  confidence: Confidence;
  /** Index = hour. */
  scores: number[];
  /** Normalized components per hour (lighting null when missing). */
  components: Components[];
}

export interface ScoringResult {
  cells: CellResult[];
  stats: {
    hospitals: number;
    anchorHospitals: number;
    /** Anchor hospitals that qualify via emergency=yes (the rest qualify by name). */
    anchorHospitalsEmergency: number;
    police: number;
    fuel24x7: number;
    cellsWithRealLit: number;
    /** City median of the with-transit score per hour (0..1). */
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
  const defaults = cfg.openingHoursDefaults;

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
    const hours = poiOpenByHour(p, defaults);
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

  // Raw values.
  const rawOpen: Float64Array[] = [];
  const rawTransit: Float64Array[] = [];
  const rawLighting: (number | null)[] = [];
  const rawRoadType: number[] = [];
  const rawAnchors: number[] = [];
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
    rawTransit.push(transit);
    poisNearby.push(count);

    const roads = input.roads.get(id) ?? EMPTY_ROADS;
    rawLighting.push(lightingValue(roads, cfg.lighting.minTaggedShare));
    rawRoadType.push(roadTypeValue(roads));

    const [lat, lng] = cellToLatLng(id);
    const centre: LonLat = [lng, lat];
    rawAnchors.push(
      anchorsValue(
        { policeM: nearestM(centre, police), hospitalM: nearestM(centre, hospitals), fuelM: nearestM(centre, fuel) },
        cfg.anchors,
      ),
    );
  }

  // City-wide normalizers. Hourly components use all cell-hours, so night stays lower than day.
  const clip = cfg.percentileClip;
  const flat = (arrs: Float64Array[]) => {
    const out = new Float64Array(arrs.length * 24);
    arrs.forEach((a, i) => out.set(a, i * 24));
    return out;
  };
  const normOpen = makeNormalizer(flat(rawOpen), clip);
  const normTransit = makeNormalizer(flat(rawTransit), clip);
  const litValues = rawLighting.filter((v): v is number => v !== null);
  const normLighting = litValues.length > 0 ? makeNormalizer(litValues, clip) : null;
  const normRoadType = makeNormalizer(rawRoadType, clip);
  const normAnchors = makeNormalizer(rawAnchors, clip);

  // Components and both weighted scores per cell-hour.
  const components: Components[][] = [];
  const withT: Float64Array[] = [];
  const withoutT: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const cellReports = input.reports.get(cellIds[i]) ?? [];
    const lighting = rawLighting[i] === null || !normLighting ? null : normLighting(rawLighting[i]!);
    const roadType = normRoadType(rawRoadType[i]);
    const anchors = normAnchors(rawAnchors[i]);
    const perHour: Components[] = [];
    const w = new Float64Array(24);
    const wo = new Float64Array(24);
    for (const h of HOURS) {
      const c: Components = {
        openPlaces: normOpen(rawOpen[i][h]),
        lighting,
        roadType,
        anchors,
        transit: normTransit(rawTransit[i][h]),
        reports: reportsValue(cellReports, h, cfg.reports),
      };
      perHour.push(c);
      w[h] = weightedScore(c, cfg.weights);
      wo[h] = weightedScore(c, cfg.weights, ["transit"]);
    }
    components.push(perHour);
    withT.push(w);
    withoutT.push(wo);
  }

  const medians = HOURS.map((h) => percentile(Float64Array.from(withT, (w) => w[h]).sort(), 50));

  const cells: CellResult[] = cellIds.map((h3, i) => ({
    h3,
    confidence: confidenceFor(rawLighting[i] !== null, poisNearby[i], cfg.confidence.minPoisNearby),
    scores: HOURS.map((h) => toScore(applyTransitFloor(withT[i][h], withoutT[i][h], medians[h]))),
    components: components[i],
  }));

  return {
    cells,
    stats: {
      hospitals: hospitalCount,
      anchorHospitals: hospitals.length,
      anchorHospitalsEmergency: emergencyCount,
      police: police.length,
      fuel24x7: fuel.length,
      cellsWithRealLit: litValues.length,
      medians,
    },
  };
}
