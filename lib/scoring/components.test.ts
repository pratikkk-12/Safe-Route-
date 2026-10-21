import { describe, expect, it } from "vitest";
import { scoreConfig } from "./config";
import {
  anchorCredit,
  anchorsValue,
  hourDistance,
  isAnchorHospital,
  lightingValue,
  reportsAdjustment,
  roadTypeValue,
} from "./components";

describe("lightingValue", () => {
  const min = 0.3;
  it("is the lit=yes share of tagged length when enough is tagged", () => {
    expect(lightingValue({ totalM: 1000, mainM: 0, litYesM: 300, litNoM: 100 }, min)).toBeCloseTo(0.75);
  });
  it("is missing (null) when too little road is tagged, even on main roads", () => {
    expect(lightingValue({ totalM: 1000, mainM: 1000, litYesM: 100, litNoM: 0 }, min)).toBeNull();
    expect(lightingValue({ totalM: 1000, mainM: 1000, litYesM: 0, litNoM: 0 }, min)).toBeNull();
  });
  it("is missing for cells without roads", () => {
    expect(lightingValue({ totalM: 0, mainM: 0, litYesM: 0, litNoM: 0 }, min)).toBeNull();
  });
  it("can be 0 when all tagged roads are unlit", () => {
    expect(lightingValue({ totalM: 500, mainM: 0, litYesM: 0, litNoM: 400 }, min)).toBe(0);
  });
});

describe("roadTypeValue", () => {
  it("is the main-road length share", () => {
    expect(roadTypeValue({ totalM: 800, mainM: 200, litYesM: 0, litNoM: 0 })).toBe(0.25);
  });
  it("is 0 without roads", () => {
    expect(roadTypeValue({ totalM: 0, mainM: 0, litYesM: 0, litNoM: 0 })).toBe(0);
  });
});

describe("anchors", () => {
  const cfg = scoreConfig.anchors; // 300 m full, 1500 m zero
  it.each([
    [0, 1],
    [300, 1],
    [900, 0.5],
    [1500, 0],
    [5000, 0],
    [Infinity, 0],
  ])("credit at %d m is %d", (d, expected) => {
    expect(anchorCredit(d, cfg)).toBeCloseTo(expected);
  });
  it("averages police, hospital and fuel", () => {
    expect(anchorsValue({ policeM: 100, hospitalM: 900, fuelM: Infinity }, cfg)).toBeCloseTo(0.5);
  });
});

describe("isAnchorHospital", () => {
  it.each([
    [{ emergency: true, name: "City Clinic", osmType: "node" }, true],
    [{ emergency: false, name: "Ruby Hall Clinic", osmType: "way" }, false],
    [{ emergency: false, name: "Sassoon General HOSPITAL", osmType: "way" }, true],
    [{ emergency: false, name: "Jehangir hospital", osmType: "relation" }, true],
    // "hospital" in the name but only a point: usually a small clinic
    [{ emergency: false, name: "Sai Hospital", osmType: "node" }, false],
    [{ emergency: false, name: null, osmType: "way" }, false],
  ] as const)("%j -> %s", (poi, expected) => {
    expect(isAnchorHospital(poi)).toBe(expected);
  });
});

describe("hourDistance", () => {
  it.each([
    [23, 1, 2],
    [0, 23, 1],
    [10, 14, 4],
    [5, 5, 0],
  ])("%d to %d is %d", (a, b, d) => {
    expect(hourDistance(a, b)).toBe(d);
  });
});

describe("reportsAdjustment", () => {
  const cfg = scoreConfig.reports; // 90 days, +/-2 h, half-life 30, 2 reporters, -20..+10
  const r = (sentiment: number, ipHash: string, hour = 22, ageDays = 1) => ({ hour, sentiment, ageDays, ipHash });

  it("is null with no reports", () => {
    expect(reportsAdjustment([], 22, cfg)).toBeNull();
  });
  it("needs at least 2 distinct reporters", () => {
    expect(reportsAdjustment([r(-1, "a"), r(-1, "a"), r(-1, "a")], 22, cfg)).toBeNull();
    expect(reportsAdjustment([r(-1, "a"), r(-1, "b")], 22, cfg)).toBeLessThan(0);
  });
  it("adds up to +10 points for positive reports", () => {
    const adj = reportsAdjustment([r(1, "a"), r(1, "b")], 22, cfg)!;
    expect(adj).toBeGreaterThan(0);
    expect(adj).toBeLessThanOrEqual(10);
  });
  it("subtracts up to 20 points for negative reports", () => {
    const many = Array.from({ length: 40 }, (_, i) => r(-1, `ip${i}`));
    const adj = reportsAdjustment(many, 22, cfg)!;
    expect(adj).toBeGreaterThanOrEqual(-20);
    expect(adj).toBeCloseTo(-20, 1);
  });
  it("weighs negative reports twice as heavily as positive ones", () => {
    const neg = reportsAdjustment([r(-1, "a"), r(-1, "b")], 22, cfg)!;
    const pos = reportsAdjustment([r(1, "a"), r(1, "b")], 22, cfg)!;
    expect(neg).toBeCloseTo(-2 * pos);
  });
  it("only counts reports within +/- 2 hours, wrapping midnight", () => {
    const reports = [r(-1, "a", 1, 0), r(-1, "b", 0, 0)];
    expect(reportsAdjustment(reports, 23, cfg)).toBeLessThan(0);
    expect(reportsAdjustment(reports, 20, cfg)).toBeNull();
  });
  it("ignores reports older than 90 days", () => {
    expect(reportsAdjustment([r(-1, "a", 22, 91), r(-1, "b", 22, 91)], 22, cfg)).toBeNull();
  });
  it("halves a report's weight every 30 days", () => {
    const fresh = reportsAdjustment([r(-1, "a", 22, 0), r(-1, "b", 22, 0)], 22, cfg)!;
    const old = reportsAdjustment([r(-1, "a", 22, 30), r(-1, "b", 22, 30), r(-1, "c", 22, 30), r(-1, "d", 22, 30)], 22, cfg)!;
    expect(old).toBeCloseTo(fresh, 10);
  });
  it("qualifies but adds nothing when reports cancel out", () => {
    expect(reportsAdjustment([r(1, "a"), r(-1, "b")], 22, cfg)).toBe(0);
  });
});
