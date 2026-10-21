// Server-side reads of cell_score. Scores change once a night, so each hour's
// city-wide set is cached in memory for an hour.
import { cellToLatLng, isValidCell } from "h3-js";
import { cacheLife } from "next/cache";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { Bbox } from "@/lib/http/bbox";
import type { Components, Confidence } from "@/lib/scoring/combine";

export interface CellScore {
  h3: string;
  score: number;
  confidence: Confidence;
  /** Too little mapped data: the map shows "Not enough data" instead of a score colour. */
  insufficient: boolean;
}

interface HourScores {
  h3: string[];
  score: number[];
  confidence: Confidence[];
  insufficient: boolean[];
  lat: number[];
  lon: number[];
}

/** Hour as an integer 0..23, or null if invalid. */
export function parseHour(raw: string | null): number | null {
  if (raw === null || !/^\d{1,2}$/.test(raw)) return null;
  const h = Number(raw);
  return h >= 0 && h <= 23 ? h : null;
}

async function getHourScores(hour: number): Promise<HourScores> {
  "use cache";
  cacheLife("hours");
  const { rows } = await db.execute<{ h3_r9: string; score: number; confidence: Confidence; insufficient_data: boolean }>(
    sql`SELECT h3_r9, score, confidence, insufficient_data FROM cell_score WHERE hour = ${hour}`,
  );
  const out: HourScores = { h3: [], score: [], confidence: [], insufficient: [], lat: [], lon: [] };
  for (const r of rows) {
    const [lat, lon] = cellToLatLng(r.h3_r9);
    out.h3.push(r.h3_r9);
    out.score.push(Number(r.score));
    out.confidence.push(r.confidence);
    out.insufficient.push(r.insufficient_data);
    out.lat.push(lat);
    out.lon.push(lon);
  }
  return out;
}

// A res-9 cell's centre is at most ~200 m from its edge, so pad the bbox to keep
// cells that straddle the viewport edge.
const PAD_DEG = 0.003;

export async function getCellScores(hour: number, bbox: Bbox): Promise<CellScore[]> {
  const s = await getHourScores(hour);
  const out: CellScore[] = [];
  for (let i = 0; i < s.h3.length; i++) {
    if (
      s.lat[i] >= bbox.south - PAD_DEG &&
      s.lat[i] <= bbox.north + PAD_DEG &&
      s.lon[i] >= bbox.west - PAD_DEG &&
      s.lon[i] <= bbox.east + PAD_DEG
    ) {
      out.push({ h3: s.h3[i], score: s.score[i], confidence: s.confidence[i], insufficient: s.insufficient[i] });
    }
  }
  return out;
}

export interface CellDetail extends CellScore {
  hour: number;
  components: Components & { reportsAdjustment: number | null };
}

export async function getCellDetail(h3: string, hour: number): Promise<CellDetail | null> {
  if (!isValidCell(h3)) return null;
  const { rows } = await db.execute<{
    score: number;
    confidence: Confidence;
    insufficient_data: boolean;
    components: CellDetail["components"];
  }>(sql`SELECT score, confidence, insufficient_data, components FROM cell_score WHERE h3_r9 = ${h3} AND hour = ${hour}`);
  const r = rows[0];
  return r
    ? {
        h3,
        hour,
        score: Number(r.score),
        confidence: r.confidence,
        insufficient: r.insufficient_data,
        components: r.components,
      }
    : null;
}
