import { describe, expect, it } from "vitest";
import { haversineM, lineLengthM, pointAlong, splitLine, type LonLat } from "./line";

// ~0.0009 deg latitude ≈ 100 m
const north = (lat: number): LonLat => [73.85, lat];

describe("haversineM", () => {
  it("measures one degree of latitude as ~111 km", () => {
    expect(haversineM([73.85, 18], [73.85, 19])).toBeCloseTo(111_195, -2);
  });
  it("is zero for identical points", () => {
    expect(haversineM([73.85, 18.52], [73.85, 18.52])).toBe(0);
  });
});

describe("pointAlong", () => {
  it("finds the midpoint of a straight line", () => {
    const line = [north(18.5), north(18.502)];
    const mid = pointAlong(line, lineLengthM(line) / 2);
    expect(mid[1]).toBeCloseTo(18.501, 6);
  });
  it("clamps past the end", () => {
    const line = [north(18.5), north(18.501)];
    expect(pointAlong(line, 1e6)).toEqual(north(18.501));
  });
});

describe("splitLine", () => {
  it("keeps a short line as one piece", () => {
    const line = [north(18.5), north(18.5005)]; // ~56 m
    const pieces = splitLine(line, 100);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].coords).toEqual(line);
  });

  it("splits a 350 m line into 4 equal pieces of at most 100 m", () => {
    const line = [north(18.5), north(18.5 + 350 / 111_195)];
    const pieces = splitLine(line, 100);
    expect(pieces).toHaveLength(4);
    for (const p of pieces) {
      expect(p.lengthM).toBeLessThanOrEqual(100.001);
      expect(p.lengthM).toBeCloseTo(87.5, 0);
    }
  });

  it("preserves total length and connects pieces end to start", () => {
    const line: LonLat[] = [
      [73.85, 18.5],
      [73.852, 18.5],
      [73.852, 18.503],
      [73.849, 18.504],
    ];
    const pieces = splitLine(line, 100);
    const sum = pieces.reduce((s, p) => s + p.lengthM, 0);
    expect(sum).toBeCloseTo(lineLengthM(line), 0);
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].coords[0]).toEqual(pieces[i - 1].coords.at(-1));
    }
    expect(pieces[0].coords[0]).toEqual(line[0]);
    expect(pieces.at(-1)!.coords.at(-1)).toEqual(line.at(-1));
    // Original interior vertices are kept, so bends are not cut off.
    const allCoords = pieces.flatMap((p) => p.coords);
    expect(allCoords).toContainEqual(line[1]);
    expect(allCoords).toContainEqual(line[2]);
  });

  it("returns nothing for degenerate lines", () => {
    expect(splitLine([north(18.5)])).toEqual([]);
    expect(splitLine([north(18.5), north(18.5)])).toEqual([]);
  });
});
