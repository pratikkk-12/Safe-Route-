import { describe, expect, it } from "vitest";
import { parseBbox } from "./bbox";

describe("parseBbox", () => {
  it("parses w,s,e,n", () => {
    expect(parseBbox("73.8,18.5,73.9,18.6")).toEqual({ west: 73.8, south: 18.5, east: 73.9, north: 18.6 });
  });
  it("clamps to the Pune area", () => {
    expect(parseBbox("70,15,80,20")).toEqual({ west: 73.68, south: 18.4, east: 74.05, north: 18.72 });
  });
  it.each([null, "", "1,2,3", "a,b,c,d", "73.9,18.5,73.8,18.6", "73.8,18.6,73.9,18.5"])(
    "rejects %j",
    (raw) => {
      expect(parseBbox(raw)).toBeNull();
    },
  );
});
