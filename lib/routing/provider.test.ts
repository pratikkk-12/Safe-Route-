import { describe, expect, it } from "vitest";
import { osrmUrl } from "./osrm";
import { chooseProvider } from "./provider";

describe("chooseProvider", () => {
  it("defaults to osrm", () => {
    expect(chooseProvider({}).provider.name).toBe("osrm");
    expect(chooseProvider({}).warning).toBeUndefined();
  });
  it("uses ors when a key is set", () => {
    expect(chooseProvider({ ROUTING_PROVIDER: "ors", ORS_API_KEY: "k" }).provider.name).toBe("ors");
  });
  it("falls back to osrm with a warning when the ors key is missing", () => {
    const c = chooseProvider({ ROUTING_PROVIDER: "ors", ORS_API_KEY: "" });
    expect(c.provider.name).toBe("osrm");
    expect(c.warning).toMatch(/ORS_API_KEY/);
  });
});

describe("osrmUrl", () => {
  const from = { lat: 18.524, lon: 73.841 };
  const to = { lat: 18.591, lon: 73.738 };
  it("uses the car profile for two-wheelers and the foot profile for walking", () => {
    expect(osrmUrl([from, to], "two_wheeler", true)).toBe(
      "https://routing.openstreetmap.de/routed-car/route/v1/driving/73.841000,18.524000;73.738000,18.591000?alternatives=3&overview=full&geometries=geojson",
    );
    expect(osrmUrl([from, to], "walk", true)).toContain("/routed-foot/route/v1/driving/");
  });
  it("puts a via point between from and to with alternatives off", () => {
    const via = { lat: 18.55, lon: 73.79 };
    expect(osrmUrl([from, via, to], "car", false)).toContain(
      "73.841000,18.524000;73.790000,18.550000;73.738000,18.591000?alternatives=false",
    );
  });
});
