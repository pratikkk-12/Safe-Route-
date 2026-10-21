import { describe, expect, it } from "vitest";
import { scoreConfig } from "./config";
import {
  anchorCredit,
  anchorsValue,
  hourDistance,
  isAnchorHospital,
  lightingValue,
  reportsValue,
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
    [{ emergency: true, name: "City Clinic" }, true],
    [{ emergency: false, name: "Ruby Hall Clinic" }, false],
    [{ emergency: false, name: "Sassoon General HOSPITAL" }, true],
    [{ emergency: false, name: "Jehangir hospital" }, true],
    [{ emergency: false, name: null }, false],
  ])("%j -> %s", (poi, expected) => {
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

describe("reportsValue", () => {
  const cfg = scoreConfig.reports; // 90 days, +/-2 h, half-life 30, saturation 3
  it("is neutral (0.5) with no reports", () => {
    expect(reportsValue([], 22, cfg)).toBe(0.5);
  });
  it("goes down for negative and up for positive reports", () => {
    expect(reportsValue([{ hour: 22, sentiment: -1, ageDays: 1 }], 22, cfg)).toBeLessThan(0.5);
    expect(reportsValue([{ hour: 22, sentiment: 1, ageDays: 1 }], 22, cfg)).toBeGreaterThan(0.5);
  });
  it("only counts reports within +/- 2 hours, wrapping midnight", () => {
    const r = [{ hour: 1, sentiment: -1, ageDays: 0 }];
    expect(reportsValue(r, 23, cfg)).toBeLessThan(0.5);
    expect(reportsValue(r, 20, cfg)).toBe(0.5);
  });
  it("ignores reports older than 90 days", () => {
    expect(reportsValue([{ hour: 22, sentiment: -1, ageDays: 91 }], 22, cfg)).toBe(0.5);
  });
  it("halves a report's weight every 30 days", () => {
    const fresh = reportsValue([{ hour: 22, sentiment: -1, ageDays: 0 }], 22, cfg);
    const twoFresh = reportsValue(
      [
        { hour: 22, sentiment: -1, ageDays: 30 },
        { hour: 22, sentiment: -1, ageDays: 30 },
      ],
      22,
      cfg,
    );
    expect(twoFresh).toBeCloseTo(fresh, 10);
  });
  it("saturates instead of growing without bound", () => {
    const many = Array.from({ length: 50 }, () => ({ hour: 22, sentiment: -1, ageDays: 0 }));
    expect(reportsValue(many, 22, cfg)).toBeGreaterThanOrEqual(0);
    expect(reportsValue(many, 22, cfg)).toBeCloseTo(0, 3);
  });
});
