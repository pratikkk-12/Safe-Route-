import { describe, expect, it } from "vitest";
import { article, formatDistance, formatDuration, labelRoutes, tradeoffText, type LabelInput } from "./labels";

const r = (durationS: number, score: number, lowRunM = 0, weakestNear: string | null = null): LabelInput => ({
  durationS,
  score,
  lowRunM,
  weakestNear,
});

describe("labelRoutes", () => {
  it("labels fastest and safest", () => {
    expect(labelRoutes([r(600, 50), r(900, 80)])).toEqual(["Fastest", "Safest"]);
  });
  it("adds Balanced when a third route exists", () => {
    expect(labelRoutes([r(600, 50), r(900, 80), r(700, 65)])).toEqual(["Fastest", "Safest", "Balanced"]);
  });
  it("combines the label when one route is both", () => {
    expect(labelRoutes([r(600, 80), r(700, 60)])).toEqual(["Safest and fastest", "Alternative"]);
    expect(labelRoutes([r(600, 80), r(700, 60), r(800, 70)])).toEqual(["Safest and fastest", "Alternative", "Balanced"]);
  });
  it("breaks score ties toward the faster route", () => {
    expect(labelRoutes([r(900, 70), r(600, 70)])).toEqual(["Alternative", "Safest and fastest"]);
  });
});

describe("tradeoffText", () => {
  const fastest = r(600, 45, 900, "Shivaji Nagar");
  it("says how much longer and what it avoids", () => {
    expect(tradeoffText(r(960, 75, 0), fastest, "Safest")).toBe(
      "6 min longer, avoids a 900 m low-activity stretch near Shivaji Nagar.",
    );
  });
  it("describes the fastest route's weakest stretch calmly", () => {
    expect(tradeoffText(fastest, fastest, "Fastest")).toBe(
      "Quickest, but includes a 900 m low-activity stretch near Shivaji Nagar.",
    );
  });
  it("falls back to the score difference when there's no long low stretch", () => {
    expect(tradeoffText(r(780, 70, 0), r(600, 55, 50), "Safest")).toBe("3 min longer, busier and better-lit overall (70 vs 55).");
  });
  it("handles a route that is both fastest and safest", () => {
    expect(tradeoffText(fastest, fastest, "Safest and fastest")).toBe("The fastest route is also the busiest, best-lit option.");
  });
  it("never uses alarmist words", () => {
    const texts = [
      tradeoffText(fastest, fastest, "Fastest"),
      tradeoffText(r(960, 75), fastest, "Safest"),
      tradeoffText(r(700, 40), r(600, 50), "Alternative"),
    ];
    for (const t of texts) expect(t).not.toMatch(/unsafe|danger|avoid this area/i);
  });
});

describe("article", () => {
  it.each([
    ["800 m", "an"],
    ["850 m", "an"],
    ["8.2 km", "an"],
    ["11.0 km", "an"],
    ["18.4 km", "an"],
    ["900 m", "a"],
    ["1.1 km", "a"],
    ["100 m", "a"],
    ["110 m", "a"],
  ])("%s -> %s", (d, a) => expect(article(d)).toBe(a));
  it("is used in the tradeoff text", () => {
    expect(tradeoffText(r(600, 40, 800, "Rakshak Chowk"), r(600, 40, 800, "Rakshak Chowk"), "Fastest")).toBe(
      "Quickest, but includes an 800 m low-activity stretch near Rakshak Chowk.",
    );
  });
});

describe("formatting", () => {
  it.each([
    [940, "950 m"],
    [1234, "1.2 km"],
  ])("%d m -> %s", (m, s) => expect(formatDistance(m)).toBe(s));
  it.each([
    [20, "1 min"],
    [600, "10 min"],
    [4500, "1 h 15 min"],
  ])("%d s -> %s", (s, t) => expect(formatDuration(s)).toBe(t));
});
