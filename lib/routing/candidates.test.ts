import { describe, expect, it } from "vitest";
import type { LonLat } from "@/lib/geo/line";
import { pickViaPoints, selectCandidates } from "./candidates";
import type { RouteOption } from "./types";

const from = { lat: 18.5, lon: 73.8 };
const to = { lat: 18.52, lon: 73.8 }; // midpoint 18.51, 73.8
const M = 1 / 111_195; // degrees latitude per metre

describe("pickViaPoints", () => {
  it("takes the best cells within 1 km of the midpoint, at least 300 m apart", () => {
    const cells = [
      { score: 95, lat: 18.51, lon: 73.8 + 2000 * M }, // ~2.1 km away: too far
      { score: 90, lat: 18.51 + 500 * M, lon: 73.8 },
      { score: 89, lat: 18.51 + 600 * M, lon: 73.8 }, // 100 m from the first pick: too close
      { score: 80, lat: 18.51 - 400 * M, lon: 73.8 },
      { score: 99, lat: 18.51, lon: 73.8, insufficient: true }, // no data: skipped
    ];
    const picks = pickViaPoints(from, to, cells);
    expect(picks).toEqual([
      { lat: 18.51 + 500 * M, lon: 73.8 },
      { lat: 18.51 - 400 * M, lon: 73.8 },
    ]);
  });
  it("returns fewer when there aren't enough cells", () => {
    expect(pickViaPoints(from, to, [])).toEqual([]);
  });
});

const route = (coords: LonLat[], duration_s: number): RouteOption => ({
  geometry: { type: "LineString", coordinates: coords },
  distance_m: 0,
  duration_s,
});
const A = route([[73.8, 18.5], [73.8, 18.52]], 600);
const sameAsA = route([[73.8, 18.5], [73.8, 18.52]], 620);
const east = route([[73.8, 18.5], [73.81, 18.51], [73.8, 18.52]], 700);
const west = route([[73.8, 18.5], [73.79, 18.51], [73.8, 18.52]], 720);
const slow = route([[73.8, 18.5], [73.83, 18.51], [73.8, 18.52]], 1000); // > 1.5 x 600

describe("selectCandidates", () => {
  it("drops routes more than 50% slower than the fastest", () => {
    expect(selectCandidates([A], [slow])).toEqual([A]);
  });
  it("drops candidates sharing more than 80% of their length with a kept route", () => {
    expect(selectCandidates([A], [sameAsA, east])).toEqual([A, east]);
  });
  it("keeps up to three distinct routes, provider routes first", () => {
    expect(selectCandidates([A, east], [west, sameAsA])).toEqual([A, east, west]);
  });
});
