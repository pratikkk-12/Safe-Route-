import { describe, expect, it } from "vitest";
import { makeNormalizer, percentile } from "./normalize";

describe("percentile", () => {
  it("interpolates linearly", () => {
    const s = [0, 10, 20, 30, 40];
    expect(percentile(s, 0)).toBe(0);
    expect(percentile(s, 50)).toBe(20);
    expect(percentile(s, 100)).toBe(40);
    expect(percentile(s, 12.5)).toBe(5);
  });
});

describe("makeNormalizer", () => {
  const values = Array.from({ length: 101 }, (_, i) => i); // 0..100
  const norm = makeNormalizer(values, [5, 95]);
  it("clips at p5 and p95", () => {
    expect(norm.lo).toBe(5);
    expect(norm.hi).toBe(95);
    expect(norm(0)).toBe(0);
    expect(norm(5)).toBe(0);
    expect(norm(50)).toBeCloseTo(0.5);
    expect(norm(95)).toBe(1);
    expect(norm(1000)).toBe(1);
  });
  it("handles a degenerate range (e.g. mostly zeros)", () => {
    const zeros = makeNormalizer([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [5, 95]);
    expect(zeros(0)).toBe(0);
    expect(zeros(3)).toBe(1);
  });
});
