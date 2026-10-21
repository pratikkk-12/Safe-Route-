"use client";

import { useEffect, useState } from "react";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Popup } from "maplibre-gl";

const SOURCE = "debug-pois";
const LAYER = "debug-pois-circles";
const MIN_ZOOM = 13;

const GROUPS = [
  { label: "Police / hospital / fuel", color: "#2563eb", categories: ["police", "hospital", "fuel"] },
  { label: "Food", color: "#ea580c", categories: ["restaurant", "fast_food", "cafe"] },
  { label: "Shops / ATM / pharmacy", color: "#9333ea", categories: ["convenience", "atm", "pharmacy"] },
  { label: "Transit", color: "#16a34a", categories: ["bus_stop", "bus_station", "metro_station", "railway_station"] },
  { label: "Hotel", color: "#a16207", categories: ["hotel"] },
];

const colorExpression = [
  "match",
  ["get", "category"],
  ...GROUPS.flatMap((g) => [g.categories, g.color]),
  "#6b7280",
] as unknown as ExpressionSpecification;

type Status = { kind: "idle" } | { kind: "zoom" } | { kind: "loading" } | { kind: "ok"; count: number; truncated: boolean } | { kind: "error" };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export default function DebugPoiLayer({ map }: { map: MapLibreMap }) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let popup: Popup | null = null;

    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: LAYER,
      type: "circle",
      source: SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 3.5, 17, 7],
        "circle-color": colorExpression,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
      },
    });

    const load = () => {
      controller?.abort();
      if (map.getZoom() < MIN_ZOOM) {
        (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: [] });
        setStatus({ kind: "zoom" });
        return;
      }
      controller = new AbortController();
      const b = map.getBounds();
      setStatus({ kind: "loading" });
      fetch(`/api/debug/pois?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((fc) => {
          (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(fc);
          setStatus({ kind: "ok", count: fc.features.length, truncated: fc.truncated });
        })
        .catch((err) => {
          if (err.name !== "AbortError") setStatus({ kind: "error" });
        });
    };
    const onMove = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    };

    const onClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string | boolean | null>;
      const html = `<strong>${escapeHtml(String(p.name ?? "(no name)"))}</strong><br/>
        ${escapeHtml(String(p.category))}${p.is_24x7 ? " · 24x7" : ""}<br/>
        <small>${escapeHtml(String(p.opening_hours ?? "no opening_hours"))}</small><br/>
        <small>osm_id ${escapeHtml(String(p.osm_id))}</small>`;
      import("maplibre-gl").then((maplibregl) => {
        popup?.remove();
        popup = new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML(html).addTo(map);
      });
    };
    const setPointer = () => (map.getCanvas().style.cursor = "pointer");
    const clearPointer = () => (map.getCanvas().style.cursor = "");

    map.on("moveend", onMove);
    map.on("click", LAYER, onClick);
    map.on("mouseenter", LAYER, setPointer);
    map.on("mouseleave", LAYER, clearPointer);
    load();

    return () => {
      controller?.abort();
      clearTimeout(timer);
      popup?.remove();
      map.off("moveend", onMove);
      map.off("click", LAYER, onClick);
      map.off("mouseenter", LAYER, setPointer);
      map.off("mouseleave", LAYER, clearPointer);
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
      setStatus({ kind: "idle" });
    };
  }, [enabled, map]);

  return (
    <div className="absolute left-3 top-3 z-10 max-w-[calc(100%-5rem)] rounded-lg bg-white/95 p-2 text-sm text-zinc-900 shadow-md">
      <label className="flex cursor-pointer items-center gap-2 font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
        Debug: POIs
      </label>
      {enabled && (
        <div className="mt-1 space-y-1">
          <p className="text-xs text-zinc-600" aria-live="polite">
            {status.kind === "zoom" && `Zoom in to see POIs (level ${MIN_ZOOM}+)`}
            {status.kind === "loading" && "Loading…"}
            {status.kind === "ok" && `${status.count} POIs in view${status.truncated ? " (capped)" : ""}`}
            {status.kind === "error" && "Could not load POIs. Is the database set up?"}
          </p>
          <ul className="space-y-0.5 text-xs">
            {GROUPS.map((g) => (
              <li key={g.label} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                {g.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
