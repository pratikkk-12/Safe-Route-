// Raw component values for one cell. Each is normalized city-wide afterwards.
import type { ScoreConfig } from "./config";

export const MAIN_ROAD_CLASSES = new Set(["trunk", "primary", "secondary", "tertiary"]);
export const TRANSIT_CATEGORIES = new Set(["bus_stop", "bus_station", "metro_station", "railway_station"]);

export interface RoadTotals {
  totalM: number;
  mainM: number;
  litYesM: number;
  litNoM: number;
}

/**
 * Share of the *tagged* road length with lit=yes, or null when the cell has no real
 * lit data (tagged share below minTaggedShare). Never estimated from road class.
 */
export function lightingValue(r: RoadTotals, minTaggedShare: number): number | null {
  const tagged = r.litYesM + r.litNoM;
  if (r.totalM <= 0 || tagged / r.totalM < minTaggedShare) return null;
  return r.litYesM / tagged;
}

/** Length share of trunk/primary/secondary/tertiary roads. 0 when the cell has no roads. */
export function roadTypeValue(r: RoadTotals): number {
  return r.totalM > 0 ? r.mainM / r.totalM : 0;
}

/** Linear credit: 1 within fullCreditM, 0 beyond zeroCreditM. */
export function anchorCredit(distM: number, cfg: ScoreConfig["anchors"]): number {
  if (distM <= cfg.fullCreditM) return 1;
  if (distM >= cfg.zeroCreditM) return 0;
  return (cfg.zeroCreditM - distM) / (cfg.zeroCreditM - cfg.fullCreditM);
}

/** Mean credit for the nearest police, anchor hospital and 24x7 fuel (Infinity = none). */
export function anchorsValue(
  nearest: { policeM: number; hospitalM: number; fuelM: number },
  cfg: ScoreConfig["anchors"],
): number {
  return (anchorCredit(nearest.policeM, cfg) + anchorCredit(nearest.hospitalM, cfg) + anchorCredit(nearest.fuelM, cfg)) / 3;
}

/**
 * A hospital is a safety anchor with emergency=yes, or with "hospital" in its name AND
 * mapped as a building outline (way/relation). Name-only nodes are mostly clinics.
 */
export function isAnchorHospital(poi: {
  emergency: boolean;
  name: string | null;
  osmType: "node" | "way" | "relation";
}): boolean {
  return poi.emergency || (/hospital/i.test(poi.name ?? "") && poi.osmType !== "node");
}

/** Distance between two hours on a 24 h clock (23 and 1 are 2 apart). */
export function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

export interface ReportInput {
  hour: number;
  sentiment: number; // -1 or +1
  ageDays: number;
}

/**
 * null (missing) when no approved report falls within maxAgeDays and +/- windowHours of
 * `hour`. Otherwise 0.5 + 0.5 x tanh(decayed sentiment sum / saturation): below 0.5 for
 * mostly negative reports, above for mostly positive.
 */
export function reportsValue(reports: ReportInput[], hour: number, cfg: ScoreConfig["reports"]): number | null {
  let sum = 0;
  let counted = 0;
  for (const r of reports) {
    if (r.ageDays < 0 || r.ageDays > cfg.maxAgeDays) continue;
    if (hourDistance(r.hour, hour) > cfg.windowHours) continue;
    sum += r.sentiment * 0.5 ** (r.ageDays / cfg.halfLifeDays);
    counted++;
  }
  return counted === 0 ? null : 0.5 + 0.5 * Math.tanh(sum / cfg.saturation);
}
