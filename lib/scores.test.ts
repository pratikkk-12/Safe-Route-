import { describe, expect, it, vi } from "vitest";

// lib/scores imports the DB client and next/cache; stub them so parseHour can be tested alone.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
const { parseHour } = await import("./scores");

describe("parseHour", () => {
  it.each([
    ["0", 0],
    ["9", 9],
    ["23", 23],
    ["07", 7],
  ])("%s -> %d", (raw, h) => {
    expect(parseHour(raw)).toBe(h);
  });
  it.each([null, "", "24", "-1", "3.5", "abc", "1e1"])("rejects %j", (raw) => {
    expect(parseHour(raw)).toBeNull();
  });
});
