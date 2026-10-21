// Pure transforms from Overpass elements to database rows (used by scripts/ingest-osm.ts).
import { latLngToCell } from "h3-js";
import { H3_RESOLUTION, PUNE_BBOX } from "@/lib/config";
import { splitLine, type LonLat } from "@/lib/geo/line";
import {
  encodeOsmId,
  highwayClass,
  isOpen24x7,
  normalizeLit,
  poiCategory,
  type HighwayClass,
  type PoiCategory,
} from "./classify";
import type { OverpassElement } from "./overpass";

export const SEGMENT_MAX_M = 100;

/** Elements keyed by encodeOsmId(type, id), so node 123 and way 123 never collide. */
export type ElementStore = Map<number, OverpassElement>;

export interface PoiRow {
  /** encodeOsmId(type, id): unique across nodes, ways and relations. */
  osmId: number;
  category: PoiCategory;
  name: string | null;
  openingHours: string | null;
  is24x7: boolean;
  lon: number;
  lat: number;
  h3: string;
}

export interface RoadRow {
  /** Raw OSM way id (roads are always ways). Shared by all segments of a way. */
  osmId: number;
  highwayClass: HighwayClass;
  lit: "yes" | "no" | null;
  lengthM: number;
  wkt: string;
  h3: string;
}

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;
const inArea = (lat: number, lon: number) =>
  lat >= PUNE_BBOX.south && lat <= PUNE_BBOX.north && lon >= PUNE_BBOX.west && lon <= PUNE_BBOX.east;

/**
 * Add elements from one tile to the store. De-dupes on OSM type + id: the same way
 * returned by two neighbouring tiles is kept once, but node 123 and way 123 both stay.
 */
export function mergeElements(store: ElementStore, elements: OverpassElement[]): void {
  for (const el of elements) store.set(encodeOsmId(el.type, el.id), el);
}

export function buildPoiRows(store: ElementStore): PoiRow[] {
  const rows: PoiRow[] = [];
  for (const [osmId, el] of store) {
    const tags = el.tags ?? {};
    const category = poiCategory(tags);
    // Nodes have lat/lon; ways and relations (e.g. hospital buildings) have a center.
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!category || lat === undefined || lon === undefined || !inArea(lat, lon)) continue;
    const openingHours = tags.opening_hours?.trim() || null;
    rows.push({
      osmId,
      category,
      name: tags.name ?? tags["name:en"] ?? null,
      openingHours,
      is24x7: isOpen24x7(openingHours),
      lon: round7(lon),
      lat: round7(lat),
      h3: latLngToCell(lat, lon, H3_RESOLUTION),
    });
  }
  return rows;
}

/**
 * Split each (already de-duped) way into <= SEGMENT_MAX_M pieces. Every piece is kept;
 * de-dupe must happen on the store before this, never on the resulting rows.
 */
export function buildRoadRows(store: ElementStore): RoadRow[] {
  const rows: RoadRow[] = [];
  for (const el of store.values()) {
    if (el.type !== "way") continue;
    const tags = el.tags ?? {};
    const cls = highwayClass(tags.highway);
    if (!cls || !el.geometry || tags.area === "yes") continue;
    const coords: LonLat[] = el.geometry.filter(Boolean).map((p) => [round7(p.lon), round7(p.lat)]);
    const lit = normalizeLit(tags.lit);
    for (const piece of splitLine(coords, SEGMENT_MAX_M)) {
      const [mLon, mLat] = piece.midpoint;
      if (!inArea(mLat, mLon)) continue;
      rows.push({
        osmId: el.id,
        highwayClass: cls,
        lit,
        lengthM: Math.round(piece.lengthM * 10) / 10,
        wkt: `LINESTRING(${piece.coords.map(([x, y]) => `${round7(x)} ${round7(y)}`).join(",")})`,
        h3: latLngToCell(mLat, mLon, H3_RESOLUTION),
      });
    }
  }
  return rows;
}
