import { describe, expect, it } from "vitest";
import { scoreConfig } from "./config";
import { openFractionByHour, poiOpenByHour } from "./hours";

const defaults = scoreConfig.openingHoursDefaults;
const openHours = (arr: number[]) => arr.flatMap((v, h) => (v === 1 ? [h] : []));

describe("openFractionByHour", () => {
  it("treats 24/7 as open every hour", () => {
    expect(openFractionByHour("24/7")).toEqual(Array(24).fill(1));
  });
  it("checks each hour at h:30", () => {
    // 11:00-23:00 is open 11:30 ... 22:30
    expect(openHours(openFractionByHour("11:00-23:00")!)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    // 05:30-23:00 includes 05:30
    expect(openFractionByHour("05:30-23:00")![5]).toBe(1);
    expect(openFractionByHour("05:30-23:00")![4]).toBe(0);
  });
  it("averages over the week for day-specific schedules", () => {
    const f = openFractionByHour("Mo-Sa 09:00-21:00")!;
    expect(f[10]).toBeCloseTo(6 / 7);
    expect(f[22]).toBe(0);
  });
  it("handles schedules crossing midnight", () => {
    const f = openFractionByHour("Mo-Su 18:00-02:00")!;
    expect(f[23]).toBe(1);
    expect(f[1]).toBe(1);
    expect(f[12]).toBe(0);
  });
  it("returns null for unparseable values", () => {
    expect(openFractionByHour("call us!")).toBeNull();
  });
});

describe("poiOpenByHour", () => {
  it("uses the per-category default when opening_hours is missing", () => {
    const cafe = poiOpenByHour({ category: "cafe", openingHours: null, is24x7: false }, defaults);
    expect(cafe[23]).toBe(0);
    expect(cafe[22]).toBe(1);
    const bus = poiOpenByHour({ category: "bus_stop", openingHours: null, is24x7: false }, defaults);
    expect(bus[5]).toBe(1);
    expect(bus[23]).toBe(0);
    const metro = poiOpenByHour({ category: "metro_station", openingHours: null, is24x7: false }, defaults);
    expect(metro[22]).toBe(0);
    expect(metro[6]).toBe(1);
  });
  it.each(["atm", "hotel", "fuel", "hospital", "police", "railway_station"] as const)(
    "defaults %s to 24x7",
    (category) => {
      expect(poiOpenByHour({ category, openingHours: null, is24x7: false }, defaults)).toEqual(Array(24).fill(1));
    },
  );
  it("lets a real tag override the default", () => {
    // fuel defaults to 24x7, but this one closes at night
    const fuel = poiOpenByHour({ category: "fuel", openingHours: "06:00-22:00", is24x7: false }, defaults);
    expect(fuel[2]).toBe(0);
    expect(fuel[12]).toBe(1);
    // a late-night cafe stays open past the 23:00 default
    const cafe = poiOpenByHour({ category: "cafe", openingHours: "Mo-Su 12:00-01:00", is24x7: false }, defaults);
    expect(cafe[23]).toBe(1);
  });
  it("falls back to the default when the tag can't be parsed", () => {
    const r = poiOpenByHour({ category: "restaurant", openingHours: "ask the owner", is24x7: false }, defaults);
    expect(r).toEqual(openFractionByHour("11:00-23:00"));
  });
});
