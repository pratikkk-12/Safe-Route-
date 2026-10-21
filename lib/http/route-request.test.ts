import { describe, expect, it } from "vitest";
import { parseRouteRequest } from "./route-request";

const ok = { from: { lat: 18.52, lon: 73.84 }, to: { lat: 18.59, lon: 73.74 }, mode: "two_wheeler", departAt: "2026-10-22T23:00:00+05:30" };

describe("parseRouteRequest", () => {
  it("accepts a valid request", () => {
    const r = parseRouteRequest(ok);
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.departAt.toISOString()).toBe("2026-10-22T17:30:00.000Z");
  });
  it("defaults departAt to now", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    const r = parseRouteRequest({ ...ok, departAt: "now" }, now);
    expect(!("error" in r) && r.departAt).toEqual(now);
  });
  it.each([
    [{ ...ok, from: { lat: 28.6, lon: 77.2 } }, /inside Pune/],
    [{ ...ok, to: undefined }, /inside Pune/],
    [{ ...ok, mode: "bus" }, /mode/],
    [{ ...ok, departAt: "tomorrow-ish" }, /departAt/],
    [{ ...ok, to: ok.from }, /same place/],
    [null, /JSON/],
  ])("rejects %j", (body, msg) => {
    const r = parseRouteRequest(body);
    expect("error" in r && r.error).toMatch(msg);
  });
});
