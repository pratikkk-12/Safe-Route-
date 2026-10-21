// Validation for POST /api/route bodies.
import { PUNE_BBOX } from "@/lib/config";
import { TRAVEL_MODES, type LatLon, type TravelMode } from "@/lib/routing/types";

// Allow a little beyond the scored area so trips starting at the edge still work.
const PAD = 0.1;

export interface RouteRequest {
  from: LatLon;
  to: LatLon;
  mode: TravelMode;
  departAt: Date;
}

function point(v: unknown): LatLon | null {
  if (!v || typeof v !== "object") return null;
  const { lat, lon } = v as Record<string, unknown>;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < PUNE_BBOX.south - PAD || lat > PUNE_BBOX.north + PAD) return null;
  if (lon < PUNE_BBOX.west - PAD || lon > PUNE_BBOX.east + PAD) return null;
  return { lat, lon };
}

/** Returns the parsed request, or an error message for the user. */
export function parseRouteRequest(body: unknown, now = new Date()): RouteRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "Send JSON with from, to, mode and departAt." };
  const b = body as Record<string, unknown>;
  const from = point(b.from);
  const to = point(b.to);
  if (!from || !to) return { error: "from and to must be { lat, lon } inside Pune / PCMC." };
  if (Math.abs(from.lat - to.lat) < 1e-5 && Math.abs(from.lon - to.lon) < 1e-5) {
    return { error: "Start and destination are the same place." };
  }
  if (typeof b.mode !== "string" || !TRAVEL_MODES.includes(b.mode as TravelMode)) {
    return { error: `mode must be one of ${TRAVEL_MODES.join(", ")}.` };
  }
  let departAt = now;
  if (b.departAt !== undefined && b.departAt !== "now") {
    const d = typeof b.departAt === "string" ? new Date(b.departAt) : null;
    if (!d || Number.isNaN(d.getTime())) return { error: "departAt must be an ISO date-time or \"now\"." };
    departAt = d;
  }
  return { from, to, mode: b.mode as TravelMode, departAt };
}
