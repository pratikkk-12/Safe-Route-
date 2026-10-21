import { latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import type { LonLat } from "@/lib/geo/line";
import type { Components } from "./combine";
import { scoreConfig } from "./config";
import { bandFor, scoreRoute, type CellHourScore, type ScoreLookup } from "./route";

const W = scoreConfig.weights;
const M_PER_DEG_LAT = 111_195;

// A straight 2 km route due north from Deccan.
const START: LonLat = [73.84, 18.51];
const lineNorth = (metres: number): LonLat[] => [START, [START[0], START[1] + metres / M_PER_DEG_LAT]];
const latAt = (m: number) => START[1] + m / M_PER_DEG_LAT;

const comps = (v: number, over: Partial<Components> = {}): Components => ({
  openPlaces: v,
  lighting: null,
  roadType: v,
  anchors: v,
  transit: v,
  ...over,
});
const cell = (score: number, over: Partial<CellHourScore> = {}): CellHourScore => ({
  score,
  confidence: "medium",
  insufficient: false,
  components: comps(score / 100),
  ...over,
});

/** Lookup where cells between lat a..b (metres from start) get a different score. */
function lookupWith(base: CellHourScore, dip?: { fromM: number; toM: number; s: CellHourScore }): ScoreLookup {
  const dipCells = new Set<string>();
  if (dip) for (let m = dip.fromM; m <= dip.toM; m += 10) dipCells.add(latLngToCell(latAt(m), START[0], 9));
  return (h3) => (dipCells.has(h3) ? dip!.s : base);
}

describe("bandFor", () => {
  it.each([
    [70, false, "green"],
    [69, false, "amber"],
    [40, false, "amber"],
    [39, false, "red"],
    [90, true, "limited"],
  ] as const)("%d insufficient=%s -> %s", (s, ins, band) => {
    expect(bandFor(s, ins)).toBe(band);
  });
});

describe("scoreRoute", () => {
  it("scores a uniform route at that score", () => {
    const r = scoreRoute(lineNorth(2000), 600, 23 * 60, lookupWith(cell(80)), W);
    expect(r.score).toBe(80);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].band).toBe("green");
    expect(r.limitedDataShare).toBe(0);
    expect(r.longestLowRunM).toBe(0);
  });

  it("penalizes one dark stretch: 0.7 x mean + 0.3 x lowest 200 m", () => {
    const r = scoreRoute(
      lineNorth(2000),
      600,
      23 * 60,
      lookupWith(cell(80), { fromM: 900, toM: 1300, s: cell(10, { components: comps(0.1) }) }),
      W,
    );
    expect(r.minWindowScore).toBe(10);
    expect(r.meanScore).toBeLessThan(80);
    expect(r.score).toBe(Math.round(0.7 * r.meanScore + 0.3 * 10));
    expect(r.score).toBeLessThan(r.meanScore);
  });

  it("returns the weakest stretch as the whole low-activity run with reasons", () => {
    const low = cell(15, { components: comps(0.6, { openPlaces: 0, transit: 0 }) });
    const r = scoreRoute(lineNorth(2000), 600, 23 * 60, lookupWith(cell(80), { fromM: 800, toM: 1400, s: low }), W);
    expect(r.weakest.lowActivity).toBe(true);
    // Cells are ~350 m wide, so the run is at least the 600 m we lowered.
    expect(r.weakest.lengthM).toBeGreaterThanOrEqual(550);
    expect(r.weakest.lengthM).toBeLessThan(1400);
    expect(r.longestLowRunM).toBeCloseTo(r.weakest.lengthM, 0);
    expect(r.weakest.score).toBe(15);
    expect(r.weakest.reasons).toEqual(["openPlaces", "transit"]);
    expect(r.segments.map((s) => s.band)).toEqual(["green", "red", "green"]);
  });

  it("does not call missing lighting a reason, only roads mapped as unlit", () => {
    const unlit = cell(20, { components: comps(0.9, { lighting: 0, openPlaces: 0.2 }) });
    const r = scoreRoute(lineNorth(1000), 300, 22 * 60, lookupWith(unlit), W);
    // open places costs 0.333 x 0.8 = 0.27, unlit roads 0.222 x 1 = 0.22
    expect(r.weakest.reasons).toEqual(["openPlaces", "lighting"]);
    const missing = cell(20, { components: comps(0.9, { lighting: null, openPlaces: 0.2 }) });
    const r2 = scoreRoute(lineNorth(1000), 300, 22 * 60, lookupWith(missing), W);
    expect(r2.weakest.reasons).not.toContain("lighting");
  });

  it("reports the share of the route through limited-data cells", () => {
    const limited = cell(30, { insufficient: true, confidence: "low" });
    const r = scoreRoute(lineNorth(2000), 600, 23 * 60, lookupWith(cell(70), { fromM: 0, toM: 1000, s: limited }), W);
    expect(r.limitedDataShare).toBeGreaterThan(0.4);
    expect(r.limitedDataShare).toBeLessThan(0.7);
    expect(r.segments[0].band).toBe("limited");
    // Limited data is not "low activity".
    expect(r.longestLowRunM).toBe(0);
  });

  it("treats points outside every scored cell as limited data", () => {
    const r = scoreRoute(lineNorth(500), 120, 23 * 60, () => undefined, W);
    expect(r.limitedDataShare).toBe(1);
    expect(r.score).toBe(0);
    expect(r.weakest.reasons).toEqual(["limitedData"]);
  });

  it("uses the hour each point is reached", () => {
    const seen: number[] = [];
    // depart 22:50, 40 minutes long -> crosses into 23:00
    scoreRoute(lineNorth(2000), 2400, 22 * 60 + 50, (_h3, hour) => (seen.push(hour), cell(50)), W);
    expect(new Set(seen)).toEqual(new Set([22, 23]));
    const r = scoreRoute(lineNorth(2000), 2400, 23 * 60 + 50, lookupWith(cell(50)), W);
    expect(r.hours).toEqual([0, 23]); // wraps past midnight
  });

  it("mixes confidence by length and picks the dominant level", () => {
    const r = scoreRoute(
      lineNorth(2000),
      600,
      23 * 60,
      lookupWith(cell(60, { confidence: "low" }), { fromM: 0, toM: 1500, s: cell(60, { confidence: "high" }) }),
      W,
    );
    expect(r.confidence.level).toBe("high");
    expect(r.confidence.shares.high + r.confidence.shares.medium + r.confidence.shares.low).toBeCloseTo(1);
  });
});
