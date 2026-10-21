// Pure helpers that turn raw OSM tags into the values stored in the database.
import OpeningHours from "opening_hours";

export type OsmTags = Record<string, string | undefined>;
export type OsmType = "node" | "way" | "relation";

export const POI_CATEGORIES = [
  "fuel",
  "pharmacy",
  "hospital",
  "police",
  "restaurant",
  "fast_food",
  "cafe",
  "convenience",
  "atm",
  "hotel",
  "bus_stop",
  "bus_station",
  "metro_station",
  "railway_station",
] as const;
export type PoiCategory = (typeof POI_CATEGORIES)[number];

export const HIGHWAY_CLASSES = [
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "service",
  "unclassified",
  "track",
  "path",
  "footway",
] as const;
export type HighwayClass = (typeof HIGHWAY_CLASSES)[number];

/**
 * OSM node, way and relation ids overlap, so encode the type into one bigint:
 * id * 10 + (0 node | 1 way | 2 relation). Max ~1.3e11, well inside JS safe integers.
 */
export function encodeOsmId(type: OsmType, id: number): number {
  return id * 10 + (type === "node" ? 0 : type === "way" ? 1 : 2);
}

/** Inverse of encodeOsmId's type digit. */
export function decodeOsmType(encodedId: number): OsmType {
  const t = encodedId % 10;
  return t === 0 ? "node" : t === 1 ? "way" : "relation";
}

const AMENITY_CATEGORIES: Record<string, PoiCategory> = {
  fuel: "fuel",
  pharmacy: "pharmacy",
  hospital: "hospital",
  police: "police",
  restaurant: "restaurant",
  fast_food: "fast_food",
  cafe: "cafe",
  atm: "atm",
  bus_station: "bus_station",
};

/** Map OSM tags to one of our POI categories, or null if not relevant. */
export function poiCategory(tags: OsmTags): PoiCategory | null {
  const amenity = tags.amenity;
  if (amenity && AMENITY_CATEGORIES[amenity]) return AMENITY_CATEGORIES[amenity];
  if (tags.shop === "convenience") return "convenience";
  if (tags.tourism === "hotel") return "hotel";
  if (tags.highway === "bus_stop") return "bus_stop";
  if (tags.railway === "station" || tags.railway === "halt") {
    return isMetro(tags) ? "metro_station" : "railway_station";
  }
  return null;
}

function isMetro(tags: OsmTags): boolean {
  if (tags.station === "subway" || tags.station === "light_rail" || tags.station === "monorail") return true;
  if (tags.subway === "yes" || tags.light_rail === "yes") return true;
  const network = `${tags.network ?? ""} ${tags.operator ?? ""}`.toLowerCase();
  return network.includes("metro");
}

const HIGHWAY_MAP: Record<string, HighwayClass> = {
  motorway: "trunk",
  motorway_link: "trunk",
  trunk: "trunk",
  trunk_link: "trunk",
  primary: "primary",
  primary_link: "primary",
  secondary: "secondary",
  secondary_link: "secondary",
  tertiary: "tertiary",
  tertiary_link: "tertiary",
  residential: "residential",
  living_street: "residential",
  service: "service",
  unclassified: "unclassified",
  road: "unclassified",
  track: "track",
  path: "path",
  cycleway: "path",
  bridleway: "path",
  footway: "footway",
  pedestrian: "footway",
  steps: "footway",
};

/** OSM highway values requested from Overpass. */
export const OSM_HIGHWAY_VALUES = Object.keys(HIGHWAY_MAP);

export function highwayClass(highway: string | undefined): HighwayClass | null {
  return (highway && HIGHWAY_MAP[highway]) || null;
}

const LIT_YES = new Set(["yes", "24/7", "automatic", "sunset-sunrise", "limited", "interval"]);
const LIT_NO = new Set(["no", "disused"]);

/** Normalize the OSM lit tag to "yes" | "no" | null (unknown). */
export function normalizeLit(lit: string | undefined): "yes" | "no" | null {
  if (!lit) return null;
  const v = lit.trim().toLowerCase();
  if (LIT_YES.has(v)) return "yes";
  if (LIT_NO.has(v)) return "no";
  return null;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * True only when the opening_hours tag says the place is open all week round.
 * Missing or unparseable values return false (scoring applies category defaults later).
 */
export function isOpen24x7(openingHours: string | undefined | null): boolean {
  if (!openingHours) return false;
  const v = openingHours.trim();
  if (v === "24/7") return true;
  try {
    const oh = new OpeningHours(v, null, 0);
    if (!oh.isWeekStable()) return false;
    const from = new Date(2026, 0, 5); // a Monday
    const to = new Date(from.getTime() + WEEK_MS);
    const [openMs] = oh.getOpenDuration(from, to);
    return openMs >= WEEK_MS;
  } catch {
    return false;
  }
}
