import { describe, expect, it } from "vitest";
import { currentPuneHour, formatHour } from "./score-display";

describe("currentPuneHour", () => {
  it("uses IST (UTC+5:30) regardless of device time zone", () => {
    expect(currentPuneHour(new Date("2026-10-21T17:45:00Z"))).toBe(23);
    expect(currentPuneHour(new Date("2026-10-21T18:30:00Z"))).toBe(0);
    expect(currentPuneHour(new Date("2026-10-21T18:29:00Z"))).toBe(23);
  });
});

describe("formatHour", () => {
  it("pads to HH:00", () => {
    expect(formatHour(7)).toBe("07:00");
    expect(formatHour(23)).toBe("23:00");
  });
});
