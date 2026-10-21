import { describe, expect, it } from "vitest";
import {
  applyTransitFloor,
  confidenceFor,
  finalScore,
  isInsufficientData,
  weightedScore,
  type Components,
} from "./combine";
import { scoreConfig, validateConfig } from "./config";

const w = scoreConfig.weights;
const all = (v: number): Components => ({ openPlaces: v, lighting: v, roadType: v, anchors: v, transit: v });

describe("weights", () => {
  it("no longer include reports, and keep the original proportions", () => {
    expect(Object.keys(w).sort()).toEqual(["anchors", "lighting", "openPlaces", "roadType", "transit"]);
    // 0.30 / 0.90 etc.
    expect(w.openPlaces).toBeCloseTo(0.3 / 0.9, 3);
    expect(w.lighting).toBeCloseTo(0.2 / 0.9, 3);
    expect(w.transit).toBeCloseTo(0.1 / 0.9, 3);
  });
});

describe("weightedScore", () => {
  it("is the weighted mean when every component is present", () => {
    const c: Components = { openPlaces: 1, lighting: 0, roadType: 0, anchors: 0, transit: 0 };
    expect(weightedScore(c, w)).toBeCloseTo(0.3 / 0.9, 3);
  });

  it("redistributes the lighting weight proportionally when lighting is missing", () => {
    const c: Components = { openPlaces: 1, lighting: null, roadType: 0, anchors: 0, transit: 0 };
    // 0.30 / (0.90 - 0.20)
    expect(weightedScore(c, w)).toBeCloseTo(0.3 / 0.7, 3);
    expect(weightedScore({ ...all(0.6), lighting: null }, w)).toBeCloseTo(0.6);
  });

  it("does not treat missing lighting as dark", () => {
    expect(weightedScore({ ...all(0.8), lighting: null }, w)).toBeGreaterThan(weightedScore({ ...all(0.8), lighting: 0 }, w));
  });

  it("can exclude a component and re-weight the rest", () => {
    const c: Components = { ...all(0.5), transit: 0 };
    expect(weightedScore(c, w, ["transit"])).toBeCloseTo(0.5);
    expect(weightedScore(c, w)).toBeLessThan(0.5);
  });
});

describe("applyTransitFloor", () => {
  const median = 0.5;
  it("does not push an above-median cell below the median for lacking transit", () => {
    expect(applyTransitFloor(0.45, 0.7, median)).toBe(0.5);
  });
  it("lets an above-median cell lose some points down to the median", () => {
    expect(applyTransitFloor(0.6, 0.7, median)).toBe(0.6);
  });
  it("never lowers a below-median cell for lacking transit", () => {
    expect(applyTransitFloor(0.3, 0.35, median)).toBe(0.35);
  });
  it("keeps the bonus when transit raises the score", () => {
    expect(applyTransitFloor(0.75, 0.7, median)).toBe(0.75);
  });
});

describe("finalScore (reports are a post-score adjustment)", () => {
  it("scales to 0..100 and rounds", () => {
    expect(finalScore(0.456, null)).toBe(46);
  });
  it("adds the report adjustment in points", () => {
    expect(finalScore(0.5, 8)).toBe(58);
    expect(finalScore(0.5, -15.4)).toBe(35);
  });
  it("never lowers a high cell for a positive report", () => {
    expect(finalScore(0.9, 2)).toBeGreaterThan(finalScore(0.9, null));
  });
  it("clamps to 0..100", () => {
    expect(finalScore(0.95, 10)).toBe(100);
    expect(finalScore(0.1, -20)).toBe(0);
  });
});

describe("confidenceFor", () => {
  it.each([
    [true, 5, false, "high"],
    [true, 4, false, "medium"],
    [false, 12, false, "medium"],
    [false, 0, false, "low"],
    // qualifying reports raise one level
    [false, 0, true, "medium"],
    [false, 12, true, "high"],
    [true, 5, true, "high"],
  ] as const)("lit=%s pois=%d reports=%s -> %s", (lit, pois, reports, expected) => {
    expect(confidenceFor(lit, pois, 5, reports)).toBe(expected);
  });
});

describe("isInsufficientData", () => {
  it("needs all three: few POIs, no real lighting, no reports", () => {
    expect(isInsufficientData(2, false, false, 3)).toBe(true);
    expect(isInsufficientData(3, false, false, 3)).toBe(false);
    expect(isInsufficientData(0, true, false, 3)).toBe(false);
    expect(isInsufficientData(0, false, true, 3)).toBe(false);
  });
});

describe("validateConfig", () => {
  it("accepts the shipped config", () => {
    expect(() => validateConfig(scoreConfig)).not.toThrow();
  });
  it("rejects weights that don't sum to 1", () => {
    expect(() => validateConfig({ ...scoreConfig, weights: { ...w, openPlaces: 0.5 } })).toThrow(/sum/);
  });
  it("rejects a leftover reports weight", () => {
    const weights = { ...w, reports: 0.1 } as typeof w;
    expect(() => validateConfig({ ...scoreConfig, weights })).toThrow(/unknown weights reports/);
  });
});
