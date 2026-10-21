"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup,
} from "maplibre-gl";
import type { CellDetail, CellScore } from "@/lib/scores";
import { COMPONENT_LABELS, CONFIDENCE_TEXT, HEAT_STOPS, formatHour } from "@/lib/score-display";
import { COMPONENT_KEYS } from "@/lib/scoring/config";

const SOURCE = "cell-scores";
const FILL = "cell-scores-fill";
const LINE = "cell-scores-line";
const POI_LAYER = "debug-pois-circles";

export type ScoreStatus = "loading" | "ok" | "empty" | "error";

const fillColor = [
  "interpolate",
  ["linear"],
  ["get", "score"],
  ...HEAT_STOPS.flat(),
] as unknown as ExpressionSpecification;

// Fainter = less data behind the score.
const fillOpacity = [
  "match",
  ["get", "confidence"],
  "high",
  0.6,
  "medium",
  0.48,
  0.34,
] as unknown as ExpressionSpecification;

type H3 = typeof import("h3-js");

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function detailHtml(d: CellDetail): string {
  const rows = COMPONENT_KEYS.map((k) => {
    const v = d.components[k];
    const { label, hint } = COMPONENT_LABELS[k];
    const value =
      v === null
        ? `<span class="text-zinc-500">no data</span>`
        : k === "reports" && v === 0.5
          ? `<span class="text-zinc-500">none yet</span>`
          : `<span class="inline-block h-1.5 w-16 rounded bg-zinc-200 align-middle"><span class="block h-1.5 rounded bg-zinc-700" style="width:${Math.round(v * 100)}%"></span></span>`;
    return `<li class="flex items-center justify-between gap-3" title="${escapeHtml(hint)}"><span>${label}</span>${value}</li>`;
  }).join("");
  return `<div class="text-sm text-zinc-900 min-w-52">
    <p class="font-semibold">Night activity ${d.score}/100 at ${formatHour(d.hour)}</p>
    <p class="text-xs text-zinc-600 mb-1.5">${CONFIDENCE_TEXT[d.confidence]}</p>
    <ul class="space-y-1 text-xs">${rows}</ul>
    <p class="mt-2 text-[11px] text-zinc-500">Indicator only, not a guarantee of safety.</p>
  </div>`;
}

export default function ScoreLayer({
  map,
  hour,
  onStatus,
}: {
  map: MapLibreMap;
  hour: number;
  onStatus: (s: ScoreStatus) => void;
}) {
  const [h3, setH3] = useState<H3 | null>(null);
  const hourRef = useRef(hour);
  const boundaries = useRef(new Map<string, number[][]>());
  const reloadRef = useRef<() => void>(() => {});
  const popupRef = useRef<Popup | null>(null);

  // h3-js is large; load it only in the browser, once.
  useEffect(() => {
    import("h3-js").then(setH3);
  }, []);

  // Add the source and layers once, wire map events.
  useEffect(() => {
    if (!h3) return;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Put hexagons under the first label layer so street names stay readable.
    const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    map.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: FILL, type: "fill", source: SOURCE, paint: { "fill-color": fillColor, "fill-opacity": fillOpacity } }, firstSymbol);
    map.addLayer(
      {
        id: LINE,
        type: "line",
        source: SOURCE,
        minzoom: 14,
        paint: { "line-color": "#ffffff", "line-opacity": 0.5, "line-width": 0.6 },
      },
      firstSymbol,
    );

    const ring = (id: string) => {
      let r = boundaries.current.get(id);
      if (!r) boundaries.current.set(id, (r = h3.cellToBoundary(id, true)));
      return r;
    };

    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const b = map.getBounds();
      onStatus("loading");
      fetch(`/api/cells?hour=${hourRef.current}&bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`, {
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((cells: CellScore[]) => {
          (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({
            type: "FeatureCollection",
            features: cells.map((c) => ({
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [ring(c.h3)] },
              properties: c,
            })),
          });
          onStatus(cells.length > 0 ? "ok" : "empty");
        })
        .catch((err) => {
          if (err.name !== "AbortError") onStatus("error");
        });
    };
    reloadRef.current = load;

    const onMove = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    };

    const onClick = (e: MapLayerMouseEvent) => {
      // Let the debug POI layer handle its own clicks.
      if (map.getLayer(POI_LAYER) && map.queryRenderedFeatures(e.point, { layers: [POI_LAYER] }).length) return;
      const id = e.features?.[0]?.properties?.h3 as string | undefined;
      if (!id) return;
      const at = e.lngLat;
      fetch(`/api/cells/${id}?hour=${hourRef.current}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: CellDetail) => import("maplibre-gl").then((m) => ({ d, m })))
        .then(({ d, m }) => {
          popupRef.current?.remove();
          popupRef.current = new m.Popup({ maxWidth: "280px" }).setLngLat(at).setHTML(detailHtml(d)).addTo(map);
        })
        .catch(() => {});
    };

    map.on("moveend", onMove);
    map.on("click", FILL, onClick);
    load();

    return () => {
      controller?.abort();
      clearTimeout(timer);
      popupRef.current?.remove();
      map.off("moveend", onMove);
      map.off("click", FILL, onClick);
      if (map.getLayer(LINE)) map.removeLayer(LINE);
      if (map.getLayer(FILL)) map.removeLayer(FILL);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [h3, map, onStatus]);

  // Reload when the hour changes.
  useEffect(() => {
    if (hourRef.current === hour) return;
    hourRef.current = hour;
    popupRef.current?.remove();
    reloadRef.current();
  }, [hour]);

  return null;
}
