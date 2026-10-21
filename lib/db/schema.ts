import {
  bigint,
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * PostGIS geometry column. Values are passed as EWKT on insert
 * (e.g. "SRID=4326;POINT(73.85 18.52)") and read back as hex EWKB.
 * Use ST_AsGeoJSON / ST_X / ST_Y in queries when you need coordinates.
 */
const geometry = (name: string, kind: "Point" | "LineString") =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return `geometry(${kind}, 4326)`;
    },
  })(name);

export const poi = pgTable(
  "poi",
  {
    id: serial("id").primaryKey(),
    osmId: bigint("osm_id", { mode: "number" }).notNull().unique(),
    category: text("category").notNull(),
    name: text("name"),
    openingHours: text("opening_hours"),
    is24x7: boolean("is_24x7").notNull().default(false),
    geom: geometry("geom", "Point").notNull(),
    h3R9: text("h3_r9").notNull(),
  },
  (t) => [
    index("poi_h3_r9_idx").on(t.h3R9),
    index("poi_category_idx").on(t.category),
    index("poi_geom_idx").using("gist", t.geom),
  ],
);

export const roadSegment = pgTable(
  "road_segment",
  {
    id: serial("id").primaryKey(),
    osmId: bigint("osm_id", { mode: "number" }).notNull(),
    highwayClass: text("highway_class").notNull(),
    lit: text("lit"),
    lengthM: real("length_m").notNull(),
    geom: geometry("geom", "LineString").notNull(),
    h3R9: text("h3_r9").notNull(),
  },
  (t) => [
    index("road_segment_h3_r9_idx").on(t.h3R9),
    index("road_segment_osm_id_idx").on(t.osmId),
    index("road_segment_geom_idx").using("gist", t.geom),
  ],
);

export const cellScore = pgTable(
  "cell_score",
  {
    h3R9: text("h3_r9").notNull(),
    hour: smallint("hour").notNull(),
    score: smallint("score").notNull(),
    confidence: text("confidence").notNull(),
    components: jsonb("components").$type<Record<string, number>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.h3R9, t.hour] }), index("cell_score_hour_idx").on(t.hour)],
);

export const report = pgTable(
  "report",
  {
    id: serial("id").primaryKey(),
    // Location is stored ONLY as the H3 cell, never raw coordinates.
    h3R9: text("h3_r9").notNull(),
    category: text("category").notNull(),
    sentiment: smallint("sentiment").notNull(),
    hour: smallint("hour").notNull(),
    // HMAC of the IP with IP_HASH_SECRET, used only for rate limiting.
    ipHash: text("ip_hash").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("report_h3_r9_idx").on(t.h3R9),
    index("report_status_idx").on(t.status),
    index("report_ip_hash_created_idx").on(t.ipHash, t.createdAt),
  ],
);

