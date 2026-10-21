"use client";

import { useEffect } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent } from "maplibre-gl";
import type { PlannedRoute } from "@/lib/routing/plan";

const SRC_ALL = "routes-all";
const SRC_SEL = "route-selected";
const SRC_WEAK = "route-weakest";
const L_ALL_CASE = "routes-all-case";
const L_ALL = "routes-all-line";
const L_WEAK = "route-weakest-halo";
const L_SEL_CASE = "route-selected-case";
const L_SEL = "route-selected-line";
const L_SEL_LIMITED = "route-selected-limited";
const LAYERS = [L_SEL_LIMITED, L_SEL, L_SEL_CASE, L_WEAK, L_ALL, L_ALL_CASE];
const SOURCES = [SRC_WEAK, SRC_SEL, SRC_ALL];

export const BAND_COLORS = { green: "#16a34a", amber: "#f59e0b", red: "#dc2626", limited: "#94a3b8" } as const;

const bandColor = [
  "match",
  ["get", "band"],
  "green",
  BAND_COLORS.green,
  "amber",
  BAND_COLORS.amber,
  "red",
  BAND_COLORS.red,
  BAND_COLORS.limited,
] as unknown as ExpressionSpecification;

const empty = { type: "FeatureCollection" as const, features: [] };

export default function RouteLayer({
  map,
  routes,
  selectedId,
  onSelect,
  fitPadding,
}: {
  map: MapLibreMap;
  routes: PlannedRoute[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** Padding (px) so routes aren't hidden behind the bottom panel. */
  fitPadding: { top: number; bottom: number; left: number; right: number };
}) {
  // Sources and layers, added once.
  useEffect(() => {
    for (const id of SOURCES) map.addSource(id, { type: "geojson", data: empty });
    map.addLayer({
      id: L_ALL_CASE,
      type: "line",
      source: SRC_ALL,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 8 },
    });
    map.addLayer({
      id: L_ALL,
      type: "line",
      source: SRC_ALL,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#64748b", "line-width": 5, "line-opacity": 0.75 },
    });
    map.addLayer({
      id: L_WEAK,
      type: "line",
      source: SRC_WEAK,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#7c3aed", "line-width": 16, "line-opacity": 0.35 },
    });
    map.addLayer({
      id: L_SEL_CASE,
      type: "line",
      source: SRC_SEL,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 10 },
    });
    map.addLayer({
      id: L_SEL,
      type: "line",
      source: SRC_SEL,
      filter: ["!=", ["get", "band"], "limited"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": bandColor, "line-width": 6 },
    });
    map.addLayer({
      id: L_SEL_LIMITED,
      type: "line",
      source: SRC_SEL,
      filter: ["==", ["get", "band"], "limited"],
      layout: { "line-join": "round" },
      paint: { "line-color": BAND_COLORS.limited, "line-width": 6, "line-dasharray": [1.2, 1] },
    });

    const onClick = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "number") onSelect(id);
    };
    const pointer = () => (map.getCanvas().style.cursor = "pointer");
    const unpointer = () => (map.getCanvas().style.cursor = "");
    map.on("click", L_ALL, onClick);
    map.on("mouseenter", L_ALL, pointer);
    map.on("mouseleave", L_ALL, unpointer);

    return () => {
      map.off("click", L_ALL, onClick);
      map.off("mouseenter", L_ALL, pointer);
      map.off("mouseleave", L_ALL, unpointer);
      for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map, onSelect]);

  // Data for the current routes and selection.
  useEffect(() => {
    const src = (id: string) => map.getSource(id) as GeoJSONSource | undefined;
    const others = routes.filter((r) => r.id !== selectedId);
    src(SRC_ALL)?.setData({
      type: "FeatureCollection",
      features: others.map((r) => ({ type: "Feature", geometry: r.geometry, properties: { id: r.id } })),
    });
    const sel = routes.find((r) => r.id === selectedId);
    src(SRC_SEL)?.setData({
      type: "FeatureCollection",
      features: (sel?.segments ?? []).map((s) => ({ type: "Feature", geometry: s.geometry, properties: { band: s.band } })),
    });
    src(SRC_WEAK)?.setData(
      sel ? { type: "Feature", geometry: sel.weakestStretch.geometry, properties: {} } : empty,
    );
  }, [map, routes, selectedId]);

  // Fit the map to all routes when a new set arrives.
  useEffect(() => {
    if (!routes.length) return;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const r of routes) {
      for (const [x, y] of r.geometry.coordinates) {
        w = Math.min(w, x); e = Math.max(e, x);
        s = Math.min(s, y); n = Math.max(n, y);
      }
    }
    map.fitBounds([[w, s], [e, n]], { padding: fitPadding, maxZoom: 16, duration: 600 });
    // Only when the route set changes, not on every padding change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, routes]);

  return null;
}
