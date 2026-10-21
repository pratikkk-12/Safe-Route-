import type { LonLat } from "@/lib/geo/line";

export type TravelMode = "walk" | "two_wheeler" | "car";
export const TRAVEL_MODES: TravelMode[] = ["walk", "two_wheeler", "car"];

export interface LatLon {
  lat: number;
  lon: number;
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: LonLat[];
}

/** What every routing provider returns. */
export interface RouteOption {
  geometry: LineStringGeometry;
  distance_m: number;
  duration_s: number;
}

export interface RoutingProvider {
  name: "osrm" | "ors";
  attribution: string;
  /** 1 to 3 routes, fastest first. */
  getRoutes(from: LatLon, to: LatLon, mode: TravelMode): Promise<RouteOption[]>;
  /** A single route forced through `via`, or null if none. */
  getRouteVia(from: LatLon, via: LatLon, to: LatLon, mode: TravelMode): Promise<RouteOption | null>;
}

export type RoutingErrorCode = "busy" | "no_route" | "upstream" | "bad_request";

export class RoutingError extends Error {
  constructor(
    public code: RoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}
