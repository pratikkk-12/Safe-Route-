// FOSSGIS public OSRM (routing.openstreetmap.de). No key; max 1 request/second.
import { USER_AGENT } from "@/lib/config";
import { createQueue, createTtlCache } from "@/lib/http/throttle";
import { RoutingError, type LatLon, type RouteOption, type RoutingProvider, type TravelMode } from "./types";

const BASE = process.env.OSRM_BASE_URL ?? "https://routing.openstreetmap.de";
const PROFILE: Record<TravelMode, string> = { walk: "routed-foot", two_wheeler: "routed-car", car: "routed-car" };
const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1500;

const enqueue = createQueue(1000);
const cache = createTtlCache<RouteOption[]>(10 * 60 * 1000);

const lonLat = (p: LatLon) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`;

export function osrmUrl(points: LatLon[], mode: TravelMode, alternatives: boolean): string {
  const path = points.map(lonLat).join(";");
  const alt = alternatives ? "alternatives=3" : "alternatives=false";
  return `${BASE}/${PROFILE[mode]}/route/v1/driving/${path}?${alt}&overview=full&geometries=geojson`;
}

interface OsrmResponse {
  code: string;
  message?: string;
  routes?: { distance: number; duration: number; geometry: RouteOption["geometry"] }[];
}

async function fetchRoutes(url: string): Promise<RouteOption[]> {
  const cached = cache.get(url);
  if (cached) return cached;

  const call = () =>
    enqueue(() => fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) })).catch(
      (err: Error) => {
        throw new RoutingError("upstream", `OSRM request failed: ${err.name}`);
      },
    );
  let res = await call();
  // The public server occasionally returns a transient 5xx: retry once after a pause.
  if (res.status >= 500) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    res = await call();
    if (res.status >= 500) throw new RoutingError("busy", `OSRM HTTP ${res.status}`);
  }
  if (res.status === 429) throw new RoutingError("busy", "OSRM rate limit");
  const body = (await res.json().catch(() => null)) as OsrmResponse | null;
  if (!body) throw new RoutingError("upstream", `OSRM HTTP ${res.status}`);
  if (body.code === "NoRoute" || body.code === "NoSegment") throw new RoutingError("no_route", body.code);
  if (body.code !== "Ok" || !body.routes) throw new RoutingError("upstream", `OSRM ${body.code}: ${body.message ?? res.status}`);

  const routes = body.routes.map((r) => ({ geometry: r.geometry, distance_m: r.distance, duration_s: r.duration }));
  cache.set(url, routes);
  return routes;
}

export const osrmProvider: RoutingProvider = {
  name: "osrm",
  attribution: "Routing: OSRM by FOSSGIS (routing.openstreetmap.de), data © OpenStreetMap contributors",
  async getRoutes(from, to, mode) {
    return (await fetchRoutes(osrmUrl([from, to], mode, true))).slice(0, 3);
  },
  async getRouteVia(from, via, to, mode) {
    try {
      const [route] = await fetchRoutes(osrmUrl([from, via, to], mode, false));
      return route ?? null;
    } catch (err) {
      if (err instanceof RoutingError && err.code === "no_route") return null;
      throw err;
    }
  },
};
