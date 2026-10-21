import { describe, expect, it, vi } from "vitest";
import { createQueue, createTtlCache } from "./throttle";

describe("createQueue", () => {
  it("spaces task starts by at least the interval", async () => {
    const enqueue = createQueue(100);
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => enqueue(async () => starts.push(Date.now()))));
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(95);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(95);
  });
  it("keeps going after a failed task", async () => {
    const enqueue = createQueue(0);
    await expect(enqueue(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(enqueue(async () => 42)).resolves.toBe(42);
  });
});

describe("createTtlCache", () => {
  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    const cache = createTtlCache<number>(1000);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(cache.get("a")).toBeUndefined();
    vi.useRealTimers();
  });
  it("evicts the oldest entry when full", () => {
    const cache = createTtlCache<number>(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});
