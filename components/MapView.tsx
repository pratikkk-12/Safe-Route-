"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { MAP_STYLE_URL, PUNE_BBOX, PUNE_CENTER } from "@/lib/config";

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    let cancelled = false;

    // MapLibre touches `window`, so load it only in the browser.
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;

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

      mapRef.current = map;
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" aria-label="Map of Pune" role="region" />;
}
