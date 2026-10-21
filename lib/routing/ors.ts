// OpenRouteService Directions v2. Used only when ROUTING_PROVIDER=ors and ORS_API_KEY is set.
import { USER_AGENT } from "@/lib/config";
import { createTtlCache } from "@/lib/http/throttle";
import { RoutingError, type LatLon, type RouteOption, type RoutingProvider, type TravelMode } from "./types";

const BASE = "https://api.openrouteservice.org/v2/directions";
const PROFILE: Record<TravelMode, string> = { walk: "foot-walking", two_wheeler: "driving-car", car: "driving-car" };
const cache = createTtlCache<RouteOption[]>(10 * 60 * 1000);

interface OrsResponse {
  features?: {
    geometry: RouteOption["geometry"];
    properties: { summary: { distance?: number; duration?: number } };
  }[];
  error?: { code?: number; message?: string };
}

async function request(points: LatLon[], mode: TravelMode, alternatives: boolean): Promise<RouteOption[]> {
  const key = process.env.ORS_API_KEY;
  if (!key) throw new RoutingError("upstream", "ORS_API_KEY is not set");
  const body = {
    coordinates: points.map((p) => [p.lon, p.lat]),
    ...(alternatives ? { alternative_routes: { target_count: 3, weight_factor: 1.6, share_factor: 0.6 } } : {}),
  };
  const cacheKey = `${PROFILE[mode]}|${JSON.stringify(body)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const res = await fetch(`${BASE}/${PROFILE[mode]}/geojson`, {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
      Accept: "application/geo+json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch((err: Error) => {
    throw new RoutingError("upstream", `ORS request failed: ${err.name}`);
  });
  if (res.status === 429) throw new RoutingError("busy", "ORS rate limit");
  const json = (await res.json().catch(() => null)) as OrsResponse | null;
  if (res.status === 404 || json?.error?.code === 2009 || json?.error?.code === 2010) {
    throw new RoutingError("no_route", json?.error?.message ?? "no route");
  }
  if (!res.ok || !json?.features) throw new RoutingError("upstream", `ORS HTTP ${res.status}`);

  const routes = json.features.map((f) => ({
    geometry: f.geometry,
    distance_m: f.properties.summary.distance ?? 0,
    duration_s: f.properties.summary.duration ?? 0,
  }));
  cache.set(cacheKey, routes);
  return routes;
}

export const orsProvider: RoutingProvider = {
  name: "ors",
  attribution: "Routing: openrouteservice.org, data © OpenStreetMap contributors",
  async getRoutes(from, to, mode) {
    return (await request([from, to], mode, true)).slice(0, 3);
  },
  async getRouteVia(from, via, to, mode) {
    try {
      const [route] = await request([from, via, to], mode, false);
      return route ?? null;
    } catch (err) {
      if (err instanceof RoutingError && err.code === "no_route") return null;
      throw err;
    }
  },
};
