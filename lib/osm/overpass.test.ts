import { describe, expect, it } from "vitest";
import { tileBbox } from "./overpass";

describe("tileBbox", () => {
  const parent = { south: 18.64, west: 73.9575, north: 18.72, east: 74.05 };

  it("splits a tile into 2 x 2 sub-tiles that exactly cover it", () => {
    const subs = tileBbox(parent, 2, 2);
    expect(subs).toHaveLength(4);
    expect(Math.min(...subs.map((s) => s.south))).toBeCloseTo(parent.south, 6);
    expect(Math.max(...subs.map((s) => s.north))).toBeCloseTo(parent.north, 6);
    expect(Math.min(...subs.map((s) => s.west))).toBeCloseTo(parent.west, 6);
    expect(Math.max(...subs.map((s) => s.east))).toBeCloseTo(parent.east, 6);
    const area = (b: typeof parent) => (b.north - b.south) * (b.east - b.west);
    const total = subs.reduce((sum, s) => sum + area(s), 0);
    expect(total).toBeCloseTo(area(parent), 9); // no gaps, no overlaps
  });

  it("orders tiles south-west first, row by row", () => {
    const [a, b, c, d] = tileBbox(parent, 2, 2);
    expect(a.south).toBe(parent.south);
    expect(a.west).toBe(parent.west);
    expect(b.west).toBeGreaterThan(a.west);
    expect(c.south).toBeGreaterThan(a.south);
    expect(d.north).toBe(parent.north);
    expect(d.east).toBe(parent.east);
  });
});
