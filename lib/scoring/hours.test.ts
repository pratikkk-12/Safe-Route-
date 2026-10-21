import { describe, expect, it } from "vitest";
import { scoreConfig } from "./config";
import { openFractionByHour, poiOpenByHour } from "./hours";

const defaults = scoreConfig.openingHoursDefaults;
const fullyOpen = (arr: number[]) => arr.flatMap((v, h) => (v === 1 ? [h] : []));

describe("openFractionByHour (averaged over :00 :15 :30 :45 on 7 days)", () => {
  it("treats 24/7 as open every hour", () => {
    expect(openFractionByHour("24/7")).toEqual(Array(24).fill(1));
  });
  it("counts whole hours as fully open", () => {
    expect(fullyOpen(openFractionByHour("11:00-23:00")!)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(openFractionByHour("11:00-23:00")![23]).toBe(0);
  });
  it("gives partial credit to the hour a place opens or closes mid-way", () => {
    // closes 23:30: open at 23:00 and 23:15 -> 2 of 4 checks
    expect(openFractionByHour("11:00-23:30")![23]).toBe(0.5);
    // opens 05:30: open at 05:30 and 05:45
    expect(openFractionByHour("05:30-23:00")![5]).toBe(0.5);
    expect(openFractionByHour("05:30-23:00")![4]).toBe(0);
    // closes 21:45: open at 21:00, 21:15, 21:30
    expect(openFractionByHour("09:00-21:45")![21]).toBe(0.75);
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
  const none = { openingHours: null, is24x7: false };
  it("uses the fallback when opening_hours is missing", () => {
    const cafe = poiOpenByHour({ category: "cafe", ...none }, defaults.cafe);
    expect(cafe[22]).toBe(1);
    expect(cafe[23]).toBe(0.5); // 11:00-23:30 default
    expect(cafe[0]).toBe(0);
    const bus = poiOpenByHour({ category: "bus_stop", ...none }, defaults.bus_stop);
    expect(bus[5]).toBe(0.5);
    expect(bus[23]).toBe(0);
    const metro = poiOpenByHour({ category: "metro_station", ...none }, defaults.metro_station);
    expect(metro[22]).toBe(0);
    expect(metro[6]).toBe(1);
  });
  it.each(["atm", "hotel", "fuel", "hospital", "police", "railway_station"] as const)(
    "the %s default is 24x7",
    (category) => {
      expect(poiOpenByHour({ category, ...none }, defaults[category])).toEqual(Array(24).fill(1));
    },
  );
  it("lets a real tag override the default", () => {
    const fuel = poiOpenByHour({ category: "fuel", openingHours: "06:00-22:00", is24x7: false }, defaults.fuel);
    expect(fuel[2]).toBe(0);
    expect(fuel[12]).toBe(1);
    const cafe = poiOpenByHour({ category: "cafe", openingHours: "Mo-Su 12:00-01:00", is24x7: false }, defaults.cafe);
    expect(cafe[23]).toBe(1);
    expect(cafe[0]).toBe(1);
  });
  it("falls back to the default when the tag can't be parsed", () => {
    const r = poiOpenByHour({ category: "restaurant", openingHours: "ask the owner", is24x7: false }, defaults.restaurant);
    expect(r).toEqual(openFractionByHour("11:00-23:30"));
  });
});
