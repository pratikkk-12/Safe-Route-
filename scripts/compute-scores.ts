// Computes the Night Activity Score for every H3 cell and hour and writes cell_score.
//
// Usage:
//   npm run compute-scores               # compute, print stats, write to the DB
//   npm run compute-scores -- --dry-run  # compute and print only
import "./load-env";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { cellToLatLng, gridDisk } from "h3-js";
import type { PoiCategory } from "@/lib/osm/classify";
import type { CellResult, PoiInput } from "@/lib/scoring/compute";
import { HOURS, computeCellScores } from "@/lib/scoring/compute";
import type { ReportInput, RoadTotals } from "@/lib/scoring/components";
import { COMPONENT_KEYS, scoreConfig } from "@/lib/scoring/config";
import { percentile } from "@/lib/scoring/normalize";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = 5000;
const SAMPLE_HOUR = 23;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.local");
  const sql = neon(url);
  const t0 = Date.now();

  console.log("Loading POIs, road totals and approved reports...");
  const poiRows = (await sql.query(
    `SELECT category, name, opening_hours, is_24x7, emergency, ST_X(geom) AS lon, ST_Y(geom) AS lat, h3_r9 FROM poi`,
  )) as {
    category: PoiCategory;
    name: string | null;
    opening_hours: string | null;
    is_24x7: boolean;
    emergency: boolean;
    lon: number;
    lat: number;
    h3_r9: string;
  }[];
  const pois: PoiInput[] = poiRows.map((r) => ({
    category: r.category,
    name: r.name,
    openingHours: r.opening_hours,
    is24x7: r.is_24x7,
    emergency: r.emergency,
    lon: Number(r.lon),
    lat: Number(r.lat),
    h3: r.h3_r9,
  }));

  const roadRows = (await sql.query(`
    SELECT h3_r9,
      sum(length_m) AS total_m,
      sum(length_m) FILTER (WHERE highway_class IN ('trunk', 'primary', 'secondary', 'tertiary')) AS main_m,
      sum(length_m) FILTER (WHERE lit = 'yes') AS lit_yes_m,
      sum(length_m) FILTER (WHERE lit = 'no') AS lit_no_m
    FROM road_segment GROUP BY h3_r9`)) as Record<string, string | null>[];
  const roads = new Map<string, RoadTotals>(
    roadRows.map((r) => [
      r.h3_r9!,
      {
        totalM: Number(r.total_m ?? 0),
        mainM: Number(r.main_m ?? 0),
        litYesM: Number(r.lit_yes_m ?? 0),
        litNoM: Number(r.lit_no_m ?? 0),
      },
    ]),
  );

  const reportRows = (await sql.query(
    `SELECT h3_r9, hour, sentiment, EXTRACT(EPOCH FROM now() - created_at) / 86400 AS age_days
     FROM report WHERE status = 'approved' AND created_at > now() - make_interval(days => $1)`,
    [scoreConfig.reports.maxAgeDays],
  )) as { h3_r9: string; hour: number; sentiment: number; age_days: string }[];
  const reports = new Map<string, ReportInput[]>();
  for (const r of reportRows) {
    const list = reports.get(r.h3_r9) ?? [];
    list.push({ hour: r.hour, sentiment: r.sentiment, ageDays: Number(r.age_days) });
    reports.set(r.h3_r9, list);
  }
  console.log(`  ${pois.length} POIs, ${roads.size} road cells, ${reportRows.length} approved reports`);

  console.log("Computing scores...");
  const { cells, stats } = computeCellScores({ pois, roads, reports }, scoreConfig);
  console.log(`  ${cells.length} cells x 24 hours in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  printStats(cells, stats, pois);

  if (DRY_RUN) {
    console.log("\n--dry-run: database not changed.");
    return;
  }
  await writeScores(sql, cells);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
}

function printStats(cells: CellResult[], stats: ReturnType<typeof computeCellScores>["stats"], pois: PoiInput[]) {
  console.log("\nAnchors");
  console.log(`  hospitals qualifying as anchors: ${stats.anchorHospitals} of ${stats.hospitals}`);
  console.log(
    `    via emergency=yes: ${stats.anchorHospitalsEmergency}, via "hospital" in name only: ${stats.anchorHospitals - stats.anchorHospitalsEmergency}`,
  );
  console.log(`  police stations: ${stats.police}, 24x7 fuel stations: ${stats.fuel24x7}`);
  console.log(`  cells with real lit data: ${stats.cellsWithRealLit} of ${cells.length}`);

  console.log("\nScore distribution per hour");
  console.table(
    HOURS.map((h) => {
      const sorted = Float64Array.from(cells, (c) => c.scores[h]).sort();
      return {
        hour: `${String(h).padStart(2, "0")}:00`,
        p10: percentile(sorted, 10),
        p50: percentile(sorted, 50),
        p90: percentile(sorted, 90),
      };
    }),
  );

  console.log("Cells by confidence");
  const byConf = { high: 0, medium: 0, low: 0 };
  for (const c of cells) byConf[c.confidence]++;
  console.table(
    (["high", "medium", "low"] as const).map((k) => ({
      confidence: k,
      cells: byConf[k],
      share: `${((100 * byConf[k]) / cells.length).toFixed(1)}%`,
    })),
  );

  // Names of a few POIs in and around a cell, to recognise the place.
  const poisByCell = new Map<string, PoiInput[]>();
  for (const p of pois) {
    const list = poisByCell.get(p.h3) ?? [];
    list.push(p);
    poisByCell.set(p.h3, list);
  }
  const placeHint = (h3: string) => {
    const nearby = gridDisk(h3, 1).flatMap((id) => poisByCell.get(id) ?? []);
    const names = [...new Set(nearby.filter((p) => p.name).map((p) => p.name!))].slice(0, 3);
    return names.join("; ") || "(no named POIs nearby)";
  };
  const row = (c: CellResult) => {
    const [lat, lng] = cellToLatLng(c.h3);
    const comp = c.components[SAMPLE_HOUR];
    const out: Record<string, string | number> = {
      score: c.scores[SAMPLE_HOUR],
      conf: c.confidence,
      "lat,lon": `${lat.toFixed(4)},${lng.toFixed(4)}`,
    };
    for (const k of COMPONENT_KEYS) out[k] = comp[k] === null ? "missing" : Number(comp[k]!.toFixed(2));
    out.near = placeHint(c.h3);
    return out;
  };

  const byScore = [...cells].sort((a, b) => b.scores[SAMPLE_HOUR] - a.scores[SAMPLE_HOUR]);
  console.log(`\nTop 5 cells at ${SAMPLE_HOUR}:00`);
  console.table(byScore.slice(0, 5).map(row));

  console.log(`Bottom 5 cells at ${SAMPLE_HOUR}:00`);
  console.table(byScore.slice(-5).reverse().map(row));

  console.log(`Bottom 5 at ${SAMPLE_HOUR}:00 among built-up cells (5+ POIs nearby), for a more useful check`);
  console.table(
    byScore
      .filter((c) => gridDisk(c.h3, 1).reduce((s, id) => s + (poisByCell.get(id)?.length ?? 0), 0) >= 5)
      .slice(-5)
      .reverse()
      .map(row),
  );
}

async function writeScores(sql: NeonQueryFunction<false, false>, cells: CellResult[]) {
  const [{ now: runStart }] = (await sql.query("SELECT now() AS now")) as { now: string }[];
  const rows = cells.flatMap((c) =>
    HOURS.map((h) => {
      const comp: Record<string, number | null> = {};
      for (const k of COMPONENT_KEYS) {
        const v = c.components[h][k];
        comp[k] = v === null ? null : Math.round(v * 1000) / 1000;
      }
      return { h3: c.h3, hour: h, score: c.scores[h], confidence: c.confidence, components: JSON.stringify(comp) };
    }),
  );

  console.log(`\nWriting ${rows.length} cell_score rows...`);
  const batches: (typeof rows)[] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
  let done = 0;
  const CONCURRENCY = 4;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(
      batches.slice(i, i + CONCURRENCY).map(async (b) => {
        // Upsert, so the API keeps serving the previous scores while this runs.
        await sql.query(
          `INSERT INTO cell_score (h3_r9, hour, score, confidence, components, updated_at)
           SELECT h, hr, s, c, comp::jsonb, now()
           FROM unnest($1::text[], $2::smallint[], $3::smallint[], $4::text[], $5::text[]) AS u(h, hr, s, c, comp)
           ON CONFLICT (h3_r9, hour) DO UPDATE SET
             score = EXCLUDED.score, confidence = EXCLUDED.confidence,
             components = EXCLUDED.components, updated_at = EXCLUDED.updated_at`,
          [b.map((r) => r.h3), b.map((r) => r.hour), b.map((r) => r.score), b.map((r) => r.confidence), b.map((r) => r.components)],
        );
        done += b.length;
        process.stdout.write(`\r  ${done}/${rows.length}`);
      }),
    );
  }
  process.stdout.write("\n");
  const stale = (await sql.query(`DELETE FROM cell_score WHERE updated_at < $1 RETURNING 1`, [runStart])) as unknown[];
  console.log(`  removed ${stale.length} stale rows`);
  await sql.query("ANALYZE cell_score");
}

main().catch((err) => {
  console.error("\nScoring failed:", err.message ?? err);
  process.exit(1);
});
