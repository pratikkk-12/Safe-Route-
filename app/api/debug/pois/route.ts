// Debug endpoint: POIs inside a bbox as GeoJSON, for the map's debug layer.
// GET /api/debug/pois?bbox=w,s,e,n
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { parseBbox } from "@/lib/http/bbox";

const LIMIT = 5000;

export async function GET(request: Request) {
  const bbox = parseBbox(new URL(request.url).searchParams.get("bbox"));
  if (!bbox) {
    return Response.json({ error: "bbox=w,s,e,n is required" }, { status: 400 });
  }

  const { rows } = await db.execute<{
    osm_id: string;
    category: string;
    name: string | null;
    opening_hours: string | null;
    is_24x7: boolean;
    lon: number;
    lat: number;
  }>(sql`
    SELECT osm_id, category, name, opening_hours, is_24x7, ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM poi
    WHERE geom && ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}, 4326)
    LIMIT ${LIMIT + 1}
  `);

  const truncated = rows.length > LIMIT;
  return Response.json({
    type: "FeatureCollection",
    truncated,
    features: rows.slice(0, LIMIT).map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(r.lon), Number(r.lat)] },
      properties: {
        osm_id: String(r.osm_id),
        category: r.category,
        name: r.name,
        opening_hours: r.opening_hours,
        is_24x7: r.is_24x7,
      },
    })),
  });
}
