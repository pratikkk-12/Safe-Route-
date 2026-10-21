// One-time OSM ingestion: pulls POIs and roads for the Pune + PCMC bbox from
// Overpass (in tiles, cached under data/overpass/), assigns H3 cells, splits
// roads into <=100 m segments, and replaces the poi and road_segment tables.
//
// Usage:
//   npm run ingest-osm                 # uses cached tiles when present
//   npm run ingest-osm -- --refresh    # re-download every tile from Overpass
//   npm run ingest-osm -- --tiles=6    # 6 x 6 tiles (if Overpass times out)
//   npm run ingest-osm -- --dry-run    # fetch and count, don't touch the DB
import "./load-env";
import { neon } from "@neondatabase/serverless";
import { PUNE_BBOX } from "@/lib/config";
import { OSM_HIGHWAY_VALUES, POI_CATEGORIES } from "@/lib/osm/classify";
import { isCached, overpass, tileBbox, type Bbox } from "@/lib/osm/overpass";
import {
  buildPoiRows,
  buildRoadRows,
  mergeElements,
  type ElementStore,
  type PoiRow,
  type RoadRow,
} from "@/lib/osm/rows";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string, fallback: number) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};

const TILES = option("tiles", 4);
const PAUSE_MS = option("pause", 5) * 1000;
const REFRESH = flag("refresh");
const DRY_RUN = flag("dry-run");
const CACHE_DIR = "data/overpass";
const BATCH = 2000;

const bboxStr = (b: Bbox) => `${b.south},${b.west},${b.north},${b.east}`;

const poiQuery = (b: Bbox) => `[out:json][timeout:180];
(
  nwr["amenity"~"^(fuel|pharmacy|hospital|police|restaurant|fast_food|cafe|atm|bus_station)$"](${bboxStr(b)});
  nwr["shop"="convenience"](${bboxStr(b)});
  nwr["tourism"="hotel"](${bboxStr(b)});
  node["highway"="bus_stop"](${bboxStr(b)});
  nwr["railway"~"^(station|halt)$"](${bboxStr(b)});
);
out center tags;`;

const roadQuery = (b: Bbox) => `[out:json][timeout:180];
way["highway"~"^(${OSM_HIGHWAY_VALUES.join("|")})$"](${bboxStr(b)});
out geom;`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SUB_TILE_IDS = ["a", "b", "c", "d"] as const;

async function fetchAll() {
  const tiles = tileBbox(PUNE_BBOX, TILES, TILES);
  // De-duped on OSM type + id across tiles, BEFORE roads are split into segments.
  const pois: ElementStore = new Map();
  const ways: ElementStore = new Map();
  let lastWasNetwork = false;

  // Fetch one (sub-)tile through the cache, pausing between network requests.
  const fetchOne = async (bbox: Bbox, kind: "poi" | "road", cacheKey: string) => {
    if (lastWasNetwork) await sleep(PAUSE_MS);
    try {
      const res = await overpass(kind === "poi" ? poiQuery(bbox) : roadQuery(bbox), {
        cacheDir: CACHE_DIR,
        cacheKey,
        refresh: REFRESH,
      });
      lastWasNetwork = !res.fromCache;
      return res;
    } catch (err) {
      lastWasNetwork = true;
      throw err;
    }
  };

  for (const [i, tile] of tiles.entries()) {
    for (const kind of ["poi", "road"] as const) {
      const tileKey = `${TILES}x${TILES}-${i}`;
      const cacheKey = `${tileKey}-${kind}`;
      const subKeys = SUB_TILE_IDS.map((id) => `${tileKey}-${id}-${kind}`);
      const subTiles = tileBbox(tile, 2, 2);
      const target = kind === "poi" ? pois : ways;
      const label = `tile ${i + 1}/${tiles.length} ${kind}`;

      // A tile that previously had to be split is read back from its sub-tiles.
      const useSubTiles =
        !REFRESH && !isCached(CACHE_DIR, cacheKey) && subKeys.every((k) => isCached(CACHE_DIR, k));

      if (!useSubTiles) {
        try {
          const { elements, fromCache } = await fetchOne(tile, kind, cacheKey);
          console.log(`  ${label} [${cacheKey}]: ${elements.length} elements${fromCache ? " (cached)" : ""}`);
          mergeElements(target, elements);
          continue;
        } catch (err) {
          console.warn(`  ${label} [${cacheKey}] failed on all servers: ${(err as Error).message.split("\n")[0]}`);
          console.warn(`  splitting ${tileKey} into 4 sub-tiles (${subKeys.join(", ")})`);
        }
      }

      // Smaller queries are less likely to hit "server at capacity". Elements are
      // de-duped on type + id, so ways crossing sub-tile edges are only counted once.
      for (const [j, sub] of subTiles.entries()) {
        const { elements, fromCache } = await fetchOne(sub, kind, subKeys[j]);
        console.log(`  ${label} [${subKeys[j]}]: ${elements.length} elements${fromCache ? " (cached)" : ""}`);
        mergeElements(target, elements);
      }
    }
  }
  return { pois, ways };
}

async function writeDb(pois: PoiRow[], roads: RoadRow[]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set in .env.local");
  const sql = neon(url);

  console.log("\nReplacing poi and road_segment tables...");
  await sql.query("TRUNCATE poi, road_segment RESTART IDENTITY");

  for (let i = 0; i < pois.length; i += BATCH) {
    const b = pois.slice(i, i + BATCH);
    await sql.query(
      `INSERT INTO poi (osm_id, category, name, opening_hours, is_24x7, emergency, geom, h3_r9)
       SELECT o, c, n, oh, t, e, ST_SetSRID(ST_MakePoint(x, y), 4326), h
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::boolean[], $6::boolean[],
                   $7::float8[], $8::float8[], $9::text[]) AS u(o, c, n, oh, t, e, x, y, h)`,
      [
        b.map((r) => r.osmId),
        b.map((r) => r.category),
        b.map((r) => r.name),
        b.map((r) => r.openingHours),
        b.map((r) => r.is24x7),
        b.map((r) => r.emergency),
        b.map((r) => r.lon),
        b.map((r) => r.lat),
        b.map((r) => r.h3),
      ],
    );
  }
  console.log(`  poi: ${pois.length} rows`);

  let done = 0;
  const batches: RoadRow[][] = [];
  for (let i = 0; i < roads.length; i += BATCH) batches.push(roads.slice(i, i + BATCH));
  const insertRoads = async (b: RoadRow[]) => {
    await sql.query(
      `INSERT INTO road_segment (osm_id, highway_class, lit, length_m, geom, h3_r9)
       SELECT o, c, l, len, ST_GeomFromText(w, 4326), h
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::real[], $5::text[], $6::text[])
         AS u(o, c, l, len, w, h)`,
      [
        b.map((r) => r.osmId),
        b.map((r) => r.highwayClass),
        b.map((r) => r.lit),
        b.map((r) => r.lengthM),
        b.map((r) => r.wkt),
        b.map((r) => r.h3),
      ],
    );
    done += b.length;
    process.stdout.write(`\r  road_segment: ${done}/${roads.length} rows`);
  };
  // A few batches in parallel keeps this to a couple of minutes.
  const CONCURRENCY = 4;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(insertRoads));
  }
  process.stdout.write("\n");
  await sql.query("ANALYZE poi");
  await sql.query("ANALYZE road_segment");
}

function printSummary(pois: PoiRow[], roads: RoadRow[]) {
  console.log("\nPOIs per category");
  const byCat = new Map<string, { n: number; hours: number; allDay: number }>();
  for (const c of POI_CATEGORIES) byCat.set(c, { n: 0, hours: 0, allDay: 0 });
  for (const p of pois) {
    const s = byCat.get(p.category)!;
    s.n++;
    if (p.openingHours) s.hours++;
    if (p.is24x7) s.allDay++;
  }
  console.table(
    [...byCat].map(([category, s]) => ({
      category,
      count: s.n,
      "with opening_hours": s.hours,
      "24x7": s.allDay,
    })),
  );
  console.log(`Total POIs: ${pois.length}`);

  console.log("\nRoads per class");
  const byCls = new Map<string, { n: number; km: number; litYes: number; litNo: number }>();
  for (const r of roads) {
    const s = byCls.get(r.highwayClass) ?? { n: 0, km: 0, litYes: 0, litNo: 0 };
    s.n++;
    s.km += r.lengthM / 1000;
    if (r.lit === "yes") s.litYes += r.lengthM / 1000;
    if (r.lit === "no") s.litNo += r.lengthM / 1000;
    byCls.set(r.highwayClass, s);
  }
  console.table(
    [...byCls]
      .sort((a, b) => b[1].km - a[1].km)
      .map(([cls, s]) => ({
        class: cls,
        segments: s.n,
        km: Math.round(s.km),
        "lit=yes %": +((100 * s.litYes) / s.km).toFixed(1),
        "lit=no %": +((100 * s.litNo) / s.km).toFixed(1),
      })),
  );
  const totalKm = roads.reduce((s, r) => s + r.lengthM, 0) / 1000;
  console.log(`Total road segments: ${roads.length} (${Math.round(totalKm)} km)`);
  const cells = new Set([...pois.map((p) => p.h3), ...roads.map((r) => r.h3)]);
  console.log(`Distinct H3 r9 cells with data: ${cells.size}`);
}

async function main() {
  console.log(
    `Fetching OSM data for bbox ${bboxStr(PUNE_BBOX)} in ${TILES}x${TILES} tiles` +
      (REFRESH ? " (refreshing cache)" : ""),
  );
  const { pois: poiEls, ways } = await fetchAll();
  const pois = buildPoiRows(poiEls);
  const roads = buildRoadRows(ways);
  printSummary(pois, roads);
  if (DRY_RUN) {
    console.log("\n--dry-run: database not changed.");
    return;
  }
  await writeDb(pois, roads);
  console.log("Done.");
}

main().catch((err) => {
  console.error("\nIngestion failed:", err.message ?? err);
  process.exit(1);
});
