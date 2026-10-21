// Plans and scores 1-3 routes for a trip. Server-only (database + routing provider).
import { cellToLatLng, latLngToCell } from "h3-js";
import { sql } from "drizzle-orm";
import { H3_RESOLUTION } from "@/lib/config";
import { db } from "@/lib/db";
import { sampleLine, type LonLat } from "@/lib/geo/line";
import { getCellScores } from "@/lib/scores";
import type { Components, Confidence } from "@/lib/scoring/combine";
import type { ComponentKey } from "@/lib/scoring/config";
import { scoreConfig } from "@/lib/scoring/config";
import { REASON_TEXT, SAMPLE_STEP_M, scoreRoute, type Band, type CellHourScore, type ReasonKey } from "@/lib/scoring/route";
import { midpoint, pickViaPoints, selectCandidates, VIA_RADIUS_M } from "./candidates";
import { labelRoutes, pickFastestSafest, tradeoffText, type RouteLabel } from "./labels";
import { getProvider } from "./provider";
import type { LatLon, LineStringGeometry, RouteOption, TravelMode } from "./types";

export interface PlanRequest {
  from: LatLon;
  to: LatLon;
  mode: TravelMode;
  departAt: Date;
}

export interface PlannedRoute {
  id: number;
  label: RouteLabel;
  /** "via" = an extra candidate through a high-activity area. */
  source: "provider" | "via";
  distance_m: number;
  duration_s: number;
  score: number;
  confidence: { level: Confidence; shares: Record<Confidence, number> };
  /** Rounded % of the route through areas with limited mapped data. */
  limitedDataPercent: number;
  tradeoff: string;
  geometry: LineStringGeometry;
  segments: { band: Band; geometry: LineStringGeometry; length_m: number }[];
  weakestStretch: {
    geometry: LineStringGeometry;
    length_m: number;
    score: number;
    lowActivity: boolean;
    reasons: { key: ReasonKey; text: string }[];
    near: string | null;
  };
  /** Length-weighted component averages over the scored parts of the route. */
  breakdown: Record<ComponentKey, number | null>;
}

export interface PlanResponse {
  mode: TravelMode;
  departAt: string;
  departHour: number;
  provider: string;
  attribution: string;
  routes: PlannedRoute[];
}

/** Minutes after midnight in Pune (IST) for a given instant. */
export function istMinutes(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone: "Asia/Kolkata",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

const line = (coordinates: LonLat[]): LineStringGeometry => ({ type: "LineString", coordinates });

async function viaCandidates(req: PlanRequest, hour: number): Promise<RouteOption[]> {
  const mid = midpoint(req.from, req.to);
  const pad = (VIA_RADIUS_M + 200) / 111_000;
  const cells = await getCellScores(hour, {
    west: mid.lon - pad,
    east: mid.lon + pad,
    south: mid.lat - pad,
    north: mid.lat + pad,
  });
  const points = cells.map((c) => {
    const [lat, lon] = cellToLatLng(c.h3);
    return { score: c.score, insufficient: c.insufficient, lat, lon };
  });
  const out: RouteOption[] = [];
  // Sequential: every call goes through the provider's 1 request/second queue anyway.
  for (const via of pickViaPoints(req.from, req.to, points)) {
    const r = await getProvider().getRouteVia(req.from, via, req.to, req.mode);
    if (r) out.push(r);
  }
  return out;
}

/** A Postgres array literal for one bind parameter (H3 ids are hex, hours are integers). */
const pgArray = (values: (string | number)[]) => `{${values.join(",")}}`;

async function loadScores(routes: RouteOption[], hours: number[]): Promise<Map<string, CellHourScore>> {
  const cells = new Set<string>();
  for (const r of routes) {
    for (const s of sampleLine(r.geometry.coordinates, SAMPLE_STEP_M)) {
      cells.add(latLngToCell(s.point[1], s.point[0], H3_RESOLUTION));
    }
  }
  const { rows } = await db.execute<{
    h3_r9: string;
    hour: number;
    score: number;
    confidence: Confidence;
    insufficient_data: boolean;
    components: Components;
  }>(sql`
    SELECT h3_r9, hour, score, confidence, insufficient_data, components FROM cell_score
    WHERE h3_r9 = ANY(${pgArray([...cells])}::text[]) AND hour = ANY(${pgArray(hours)}::smallint[])`);
  return new Map(
    rows.map((r) => [
      `${r.h3_r9}|${r.hour}`,
      { score: Number(r.score), confidence: r.confidence, insufficient: r.insufficient_data, components: r.components },
    ]),
  );
}

/** A recognisable name near a point: prefer bus stops / stations (named after localities). */
async function nameNear([lon, lat]: LonLat): Promise<string | null> {
  const { rows } = await db.execute<{ name: string }>(sql`
    SELECT name FROM poi
    WHERE name IS NOT NULL
      AND ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, 600)
    ORDER BY CASE WHEN category IN ('bus_stop', 'bus_station', 'metro_station', 'railway_station') THEN 0 ELSE 1 END,
      geom <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
    LIMIT 1`);
  return rows[0]?.name ?? null;
}

export async function planRoutes(req: PlanRequest): Promise<PlanResponse> {
  const provider = getProvider();
  const departMinutes = istMinutes(req.departAt);
  const departHour = Math.floor(departMinutes / 60);

  const base = await provider.getRoutes(req.from, req.to, req.mode);
  const extra = base.length > 0 && base.length < 3 ? await viaCandidates(req, departHour) : [];
  const chosen = selectCandidates(base, extra);
  const sources = new Map<RouteOption, "provider" | "via">([
    ...base.map((r) => [r, "provider"] as const),
    ...extra.map((r) => [r, "via"] as const),
  ]);

  const maxHours = Math.ceil(Math.max(0, ...chosen.map((r) => r.duration_s)) / 3600) + 1;
  const hours = Array.from({ length: maxHours + 1 }, (_, i) => (departHour + i) % 24);
  const scores = await loadScores(chosen, hours);
  const lookup = (h3: string, hour: number) => scores.get(`${h3}|${hour}`);

  const scored = chosen.map((r) => ({
    r,
    s: scoreRoute(r.geometry.coordinates, r.duration_s, departMinutes, lookup, scoreConfig.weights),
  }));
  const nears = await Promise.all(
    scored.map(({ s }) => {
      const c = s.weakest.coords;
      return c.length ? nameNear(c[Math.floor(c.length / 2)]) : Promise.resolve(null);
    }),
  );

  const inputs = scored.map(({ r, s }, i) => ({
    durationS: r.duration_s,
    score: s.score,
    // The tradeoff sentence describes the same stretch that is highlighted and named.
    lowRunM: s.weakest.lowActivity ? s.weakest.lengthM : 0,
    weakestNear: nears[i],
  }));
  const labels = labelRoutes(inputs);
  const { fastest } = pickFastestSafest(inputs);

  const routes: PlannedRoute[] = scored.map(({ r, s }, i) => ({
    id: i,
    label: labels[i],
    source: sources.get(r) ?? "provider",
    distance_m: Math.round(r.distance_m),
    duration_s: Math.round(r.duration_s),
    score: s.score,
    confidence: s.confidence,
    limitedDataPercent: Math.round(s.limitedDataShare * 100),
    tradeoff: tradeoffText(inputs[i], inputs[fastest], labels[i]),
    geometry: r.geometry,
    segments: s.segments.map((seg) => ({ band: seg.band, geometry: line(seg.coords), length_m: Math.round(seg.lengthM) })),
    weakestStretch: {
      geometry: line(s.weakest.coords),
      length_m: Math.round(s.weakest.lengthM),
      score: s.weakest.score,
      lowActivity: s.weakest.lowActivity,
      reasons: s.weakest.reasons.map((key) => ({ key, text: REASON_TEXT[key] })),
      near: nears[i],
    },
    breakdown: s.breakdown,
  }));

  // Safest first, then by time.
  const order: Record<RouteLabel, number> = { "Safest and fastest": 0, Safest: 0, Balanced: 1, Fastest: 2, Alternative: 3 };
  routes.sort((a, b) => order[a.label] - order[b.label] || a.duration_s - b.duration_s);

  return {
    mode: req.mode,
    departAt: req.departAt.toISOString(),
    departHour,
    provider: provider.name,
    attribution: provider.attribution,
    routes,
  };
}
