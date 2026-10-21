// In-process request throttling and caching for third-party APIs (OSRM, Photon).
// Note: on serverless hosts each instance has its own queue and cache.

/**
 * Runs tasks one at a time with at least `minIntervalMs` between starts, so we stay
 * within a provider's "max 1 request per second" policy.
 */
export function createQueue(minIntervalMs: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      return task();
    });
    // Keep the chain alive even if a task fails.
    chain = run.catch(() => {});
    return run;
  };
}

/** A small time-limited cache (oldest entries evicted first). */
export function createTtlCache<T>(ttlMs: number, maxEntries = 500) {
  const store = new Map<string, { expires: number; value: T }>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T) {
      if (store.size >= maxEntries) store.delete(store.keys().next().value!);
      store.set(key, { expires: Date.now() + ttlMs, value });
    },
  };
}
