import { describe, expect, it } from "vitest";
import type { OverpassElement } from "./overpass";
import { buildPoiRows, buildRoadRows, mergeElements, type ElementStore } from "./rows";

// A straight north-south way in central Pune, `metres` long.
const wayGeometry = (metres: number) => [
  { lat: 18.52, lon: 73.85 },
  { lat: 18.52 + metres / 111_195, lon: 73.85 },
];

describe("de-dupe on OSM type + id", () => {
  const hospitalNode: OverpassElement = {
    type: "node",
    id: 123,
    lat: 18.52,
    lon: 73.85,
    tags: { amenity: "hospital", name: "Clinic (node)" },
  };
  // Hospitals are often mapped as building outlines (ways) with a center point.
  const hospitalWay: OverpassElement = {
    type: "way",
    id: 123,
    center: { lat: 18.53, lon: 73.86 },
    tags: { amenity: "hospital", name: "Hospital (building)" },
  };

  it("keeps node 123 and way 123 as two different POIs", () => {
    const store: ElementStore = new Map();
    mergeElements(store, [hospitalNode, hospitalWay]);
    expect(store.size).toBe(2);

    const rows = buildPoiRows(store);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["Clinic (node)", "Hospital (building)"]);
    // poi.osm_id is UNIQUE, so the stored ids must differ.
    expect(new Set(rows.map((r) => r.osmId)).size).toBe(2);
  });

  it("collapses the same element returned by two neighbouring tiles", () => {
    const store: ElementStore = new Map();
    mergeElements(store, [hospitalWay]); // tile A
    mergeElements(store, [hospitalWay, hospitalNode]); // tile B overlaps
    expect(buildPoiRows(store)).toHaveLength(2);
  });

  it("records emergency=yes", () => {
    const store: ElementStore = new Map();
    mergeElements(store, [{ ...hospitalWay, tags: { ...hospitalWay.tags, emergency: "yes" } }, hospitalNode]);
    const rows = buildPoiRows(store);
    expect(rows.find((r) => r.name === "Hospital (building)")?.emergency).toBe(true);
    expect(rows.find((r) => r.name === "Clinic (node)")?.emergency).toBe(false);
  });

  it("uses the center point for POIs mapped as ways", () => {
    const store: ElementStore = new Map();
    mergeElements(store, [hospitalWay]);
    const [row] = buildPoiRows(store);
    expect([row.lon, row.lat]).toEqual([73.86, 18.53]);
  });
});

describe("roads are de-duped by way id before splitting", () => {
  const longWay: OverpassElement = {
    type: "way",
    id: 555,
    geometry: wayGeometry(350), // splits into 4 segments of ~87.5 m
    tags: { highway: "primary", lit: "yes" },
  };

  it("keeps every 100 m segment of a way that two tiles both returned", () => {
    const store: ElementStore = new Map();
    mergeElements(store, [longWay]); // tile A
    mergeElements(store, [longWay]); // tile B returns the same full way
    const rows = buildRoadRows(store);

    // Not 1 (de-dupe after split) and not 8 (no de-dupe).
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.osmId === 555)).toBe(true);
    expect(rows.every((r) => r.lengthM <= 100)).toBe(true);
    const totalM = rows.reduce((s, r) => s + r.lengthM, 0);
    expect(totalM).toBeCloseTo(350, -1);
    // Distinct geometries: no segment was dropped or duplicated.
    expect(new Set(rows.map((r) => r.wkt)).size).toBe(4);
  });

  it("keeps segments from different ways that share the same raw id as a node", () => {
    const store: ElementStore = new Map();
    const nodeWithSameId: OverpassElement = { type: "node", id: 555, lat: 18.52, lon: 73.85, tags: {} };
    mergeElements(store, [longWay, nodeWithSameId]);
    expect(buildRoadRows(store)).toHaveLength(4);
  });
});
