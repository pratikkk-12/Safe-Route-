import { describe, expect, it } from "vitest";
import { encodeOsmId, highwayClass, isOpen24x7, normalizeLit, poiCategory } from "./classify";

describe("encodeOsmId", () => {
  it("keeps node, way and relation ids distinct", () => {
    const ids = [encodeOsmId("node", 123), encodeOsmId("way", 123), encodeOsmId("relation", 123)];
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([1230, 1231, 1232]);
  });
  it("stays a safe integer for current OSM ids", () => {
    expect(Number.isSafeInteger(encodeOsmId("node", 13_000_000_000))).toBe(true);
  });
});

describe("poiCategory", () => {
  it.each([
    [{ amenity: "fuel" }, "fuel"],
    [{ amenity: "fast_food" }, "fast_food"],
    [{ shop: "convenience" }, "convenience"],
    [{ tourism: "hotel" }, "hotel"],
    [{ highway: "bus_stop" }, "bus_stop"],
    [{ amenity: "bus_station" }, "bus_station"],
    [{ railway: "station", station: "subway" }, "metro_station"],
    [{ railway: "station", network: "Pune Metro" }, "metro_station"],
    [{ railway: "station" }, "railway_station"],
    [{ railway: "halt" }, "railway_station"],
    [{ amenity: "bench" }, null],
    [{}, null],
  ])("%j -> %s", (tags, expected) => {
    expect(poiCategory(tags)).toBe(expected);
  });
});

describe("highwayClass", () => {
  it.each([
    ["motorway", "trunk"],
    ["primary_link", "primary"],
    ["living_street", "residential"],
    ["steps", "footway"],
    ["cycleway", "path"],
    ["construction", null],
    [undefined, null],
  ])("%s -> %s", (input, expected) => {
    expect(highwayClass(input)).toBe(expected);
  });
});

describe("normalizeLit", () => {
  it.each([
    ["yes", "yes"],
    ["24/7", "yes"],
    ["automatic", "yes"],
    ["No", "no"],
    ["disused", "no"],
    ["maybe", null],
    [undefined, null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeLit(input)).toBe(expected);
  });
});

describe("isOpen24x7", () => {
  it.each([
    ["24/7", true],
    ["Mo-Su 00:00-24:00", true],
    ["Mo-Su 07:00-24:00", false],
    ["Mo-Sa 09:00-21:00; PH off", false],
    ["not a schedule", false],
    [null, false],
    [undefined, false],
  ])("%s -> %s", (input, expected) => {
    expect(isOpen24x7(input)).toBe(expected);
  });
});
