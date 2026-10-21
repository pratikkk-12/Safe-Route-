import { describe, expect, it } from "vitest";
import { applyTransitFloor, confidenceFor, toScore, weightedScore, type Components } from "./combine";
import { scoreConfig, validateConfig } from "./config";

const w = scoreConfig.weights;
const all = (v: number): Components => ({ openPlaces: v, lighting: v, roadType: v, anchors: v, transit: v, reports: v });

describe("weightedScore", () => {
  it("is the weighted mean when every component is present", () => {
    const c: Components = { openPlaces: 1, lighting: 0, roadType: 0, anchors: 0, transit: 0, reports: 0 };
    expect(weightedScore(c, w)).toBeCloseTo(0.3);
  });

  it("redistributes the lighting weight proportionally when lighting is missing", () => {
    const c: Components = { openPlaces: 1, lighting: null, roadType: 0, anchors: 0, transit: 0, reports: 0 };
    // 0.30 / (1 - 0.20) = 0.375: open places keeps its share relative to the others
    expect(weightedScore(c, w)).toBeCloseTo(0.375);
    // A uniform cell scores the same with or without lighting.
    expect(weightedScore({ ...all(0.6), lighting: null }, w)).toBeCloseTo(0.6);
  });

  it("does not treat missing lighting as dark", () => {
    const missing = weightedScore({ ...all(0.8), lighting: null }, w);
    const dark = weightedScore({ ...all(0.8), lighting: 0 }, w);
    expect(missing).toBeGreaterThan(dark);
  });

  it("can exclude a component and re-weight the rest", () => {
    const c: Components = { ...all(0.5), transit: 0 };
    expect(weightedScore(c, w, ["transit"])).toBeCloseTo(0.5);
    expect(weightedScore(c, w)).toBeCloseTo(0.45);
  });
});

describe("applyTransitFloor", () => {
  const median = 0.5;
  it("does not push an above-median cell below the median for lacking transit", () => {
    // without transit 0.7; with zero transit 0.45 -> held at the median
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

describe("toScore", () => {
  it("scales to 0..100 and rounds", () => {
    expect(toScore(0.456)).toBe(46);
    expect(toScore(1.2)).toBe(100);
    expect(toScore(-0.1)).toBe(0);
  });
});

describe("confidenceFor", () => {
  it.each([
    [true, 5, "high"],
    [true, 4, "medium"],
    [false, 12, "medium"],
    [false, 0, "low"],
  ] as const)("lit=%s pois=%d -> %s", (lit, pois, expected) => {
    expect(confidenceFor(lit, pois, 5)).toBe(expected);
  });
});

describe("validateConfig", () => {
  it("accepts the shipped config", () => {
    expect(() => validateConfig(scoreConfig)).not.toThrow();
  });
  it("rejects weights that don't sum to 1", () => {
    expect(() => validateConfig({ ...scoreConfig, weights: { ...w, openPlaces: 0.5 } })).toThrow(/sum/);
  });
});
