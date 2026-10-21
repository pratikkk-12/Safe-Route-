import { gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import type { RoadTotals } from "./components";
import { computeCellScores, defaultHoursFor, type PoiInput, type ScoringInput } from "./compute";
import { scoreConfig } from "./config";

// A tiny synthetic city: a busy centre cell, a quiet residential cell 3 km away, and
// 20 empty suburb cells so city-wide percentiles look like a real city (mostly zeros).
const CENTRE = latLngToCell(18.52, 73.85, 9);
const QUIET = latLngToCell(18.545, 73.85, 9);
const SUBURBS = Array.from({ length: 20 }, (_, i) => latLngToCell(18.6 + i * 0.005, 73.95, 9));
// Medium-activity cells (3 cafés each), far enough apart not to share ring-1 neighbours.
const MID = Array.from({ length: 5 }, (_, i) => ({ lat: 18.45, lon: 73.75 + i * 0.01 }));

const poi = (overrides: Partial<PoiInput>): PoiInput => ({
  category: "restaurant",
  name: null,
  openingHours: null,
  is24x7: false,
  emergency: false,
  osmType: "node",
  lon: 73.85,
  lat: 18.52,
  h3: CENTRE,
  ...overrides,
});

function city(extraPois: PoiInput[] = [], roads?: Map<string, RoadTotals>): ScoringInput {
  return {
    pois: [
      ...Array.from({ length: 6 }, () => poi({ category: "restaurant" })),
      poi({ category: "fuel" }),
      poi({ category: "police" }),
      poi({ category: "bus_stop" }),
      ...MID.flatMap((m) =>
        Array.from({ length: 3 }, () => poi({ category: "cafe", ...m, h3: latLngToCell(m.lat, m.lon, 9) })),
      ),
      ...extraPois,
    ],
    roads:
      roads ??
      new Map([
        [CENTRE, { totalM: 1000, mainM: 800, litYesM: 600, litNoM: 0 }],
        [QUIET, { totalM: 1000, mainM: 0, litYesM: 0, litNoM: 0 }],
        ...SUBURBS.map((id) => [id, { totalM: 500, mainM: 0, litYesM: 0, litNoM: 0 }] as const),
      ]),
    reports: new Map(),
  };
}

describe("computeCellScores", () => {
  const { cells, stats } = computeCellScores(city(), scoreConfig);
  const centre = cells.find((c) => c.h3 === CENTRE)!;
  const quiet = cells.find((c) => c.h3 === QUIET)!;

  it("scores every cell with roads or POIs for all 24 hours", () => {
    const midCells = MID.map((m) => latLngToCell(m.lat, m.lon, 9));
    expect(cells.map((c) => c.h3).sort()).toEqual([CENTRE, QUIET, ...SUBURBS, ...midCells].sort());
    for (const c of cells) {
      expect(c.scores).toHaveLength(24);
      expect(c.scores.every((s) => Number.isInteger(s) && s >= 0 && s <= 100)).toBe(true);
    }
  });

  it("rates the busy, lit centre above the quiet street at night", () => {
    expect(centre.scores[22]).toBeGreaterThan(quiet.scores[22]);
  });

  it("drops the centre's score after restaurants close (11:00-23:00 default)", () => {
    expect(centre.components[22].openPlaces).toBeGreaterThan(centre.components[2].openPlaces!);
    expect(centre.scores[22]).toBeGreaterThan(centre.scores[2]);
  });

  it("marks lighting missing (not estimated) where no lit tags exist", () => {
    expect(quiet.components[22].lighting).toBeNull();
    expect(centre.components[22].lighting).not.toBeNull();
  });

  it("sets confidence from real lit data and POIs nearby", () => {
    expect(centre.confidence).toBe("high"); // lit data + 9 POIs
    expect(quiet.confidence).toBe("low");
  });

  it("counts as anchors only emergency=yes, or 'hospital' in the name on a way/relation", () => {
    const r = computeCellScores(
      city([
        poi({ category: "hospital", name: "Sahyadri Hospital", osmType: "way" }),
        poi({ category: "hospital", name: "Sai Hospital", osmType: "node" }),
        poi({ category: "hospital", name: "Dr. Joshi Clinic", osmType: "way" }),
        poi({ category: "hospital", name: "Polyclinic", emergency: true }),
      ]),
      scoreConfig,
    );
    expect(r.stats.hospitals).toBe(4);
    expect(r.stats.anchorHospitals).toBe(2);
    expect(r.stats.anchorHospitalsEmergency).toBe(1);
  });

  it("gives non-anchor hospitals clinic hours (09:00-21:00) and anchors 24x7", () => {
    const clinic = poi({ category: "hospital", name: "Sai Hospital", osmType: "node" });
    const anchor = poi({ category: "hospital", name: "Sahyadri Hospital", osmType: "way" });
    expect(defaultHoursFor(clinic, scoreConfig)).toBe("09:00-21:00");
    expect(defaultHoursFor(anchor, scoreConfig)).toBe("24/7");
    // The clinic is an open place by day, not at night.
    const r = computeCellScores(city([{ ...clinic, h3: QUIET, lat: 18.545 }]), scoreConfig);
    const q = r.cells.find((c) => c.h3 === QUIET)!;
    expect(q.components[12].openPlaces).toBeGreaterThan(0);
    expect(q.components[23].openPlaces).toBe(0);
  });

  it("treats reports as missing when a cell has none", () => {
    expect(centre.components[22].reports).toBeNull();
  });

  it("uses reports only near the reported hour", () => {
    const r = computeCellScores(
      { ...city(), reports: new Map([[CENTRE, [{ hour: 22, sentiment: -1, ageDays: 3 }]]]) },
      scoreConfig,
    );
    const c = r.cells.find((x) => x.h3 === CENTRE)!;
    expect(c.components[22].reports).toBeLessThan(0.5);
    expect(c.components[12].reports).toBeNull();
  });

  it("treats fuel as a 24x7 anchor only when its hours allow", () => {
    expect(stats.fuel24x7).toBe(1); // no tag -> 24x7 default
    const r = computeCellScores(
      { ...city(), pois: city().pois.map((p) => (p.category === "fuel" ? { ...p, openingHours: "06:00-22:00" } : p)) },
      scoreConfig,
    );
    expect(r.stats.fuel24x7).toBe(0);
  });

  it("sums POIs over the cell and its ring-1 neighbours", () => {
    const neighbour = gridDisk(QUIET, 1).find((c) => c !== QUIET)!;
    const r = computeCellScores(city([poi({ category: "cafe", h3: neighbour, lat: 18.546 })]), scoreConfig);
    const q = r.cells.find((c) => c.h3 === QUIET)!;
    expect(q.components[20].openPlaces).toBeGreaterThan(0);
  });
});
