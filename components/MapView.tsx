"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { MAP_STYLE_URL, PUNE_BBOX, PUNE_CENTER } from "@/lib/config";
import { currentPuneHour } from "@/lib/score-display";
import DebugPoiLayer from "./DebugPoiLayer";
import HourPanel from "./HourPanel";
import ScoreLayer, { type ScoreStatus } from "./ScoreLayer";

// The debug toggle shows in development, or in any build with ?debug in the URL.
const showDebug = () =>
  process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("debug");

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [loadedMap, setLoadedMap] = useState<MapLibreMap | null>(null);
  const [debug, setDebug] = useState(false);
  const [hour, setHour] = useState<number | null>(null);
  const [status, setStatus] = useState<ScoreStatus>("loading");
  const onStatus = useCallback((s: ScoreStatus) => setStatus(s), []);

  useEffect(() => {
    let cancelled = false;

    // MapLibre touches `window`, so load it only in the browser.
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;

      // Served from public/ (see scripts/copy-maplibre-worker.mjs).
      maplibregl.setWorkerUrl(`/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`);

      const pad = 0.15;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: [PUNE_CENTER.lon, PUNE_CENTER.lat],
        zoom: 12,
        minZoom: 9,
        maxBounds: [
          [PUNE_BBOX.west - pad, PUNE_BBOX.south - pad],
          [PUNE_BBOX.east + pad, PUNE_BBOX.north + pad],
        ],
        // OSM attribution (ODbL) must stay visible.
        attributionControl: { compact: false },
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: false,
        }),
        "top-right",
      );

      map.on("load", () => {
        setLoadedMap(map);
        setDebug(showDebug());
        setHour(currentPuneHour());
      });
      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setLoadedMap(null);
    };
  }, []);

  // MapLibre's CSS forces `position: relative` on the map element (and unlayered
  // CSS beats Tailwind v4 utilities), so position a wrapper and fill it.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" aria-label="Map of Pune" role="region" />
      {loadedMap && hour !== null && (
        <>
          <ScoreLayer map={loadedMap} hour={hour} onStatus={onStatus} />
          <HourPanel hour={hour} onHour={setHour} status={status} />
        </>
      )}
      {loadedMap && debug && <DebugPoiLayer map={loadedMap} />}
    </div>
  );
}
