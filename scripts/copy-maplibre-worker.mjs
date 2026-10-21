// MapLibre v6 loads its web worker from a file next to its own module, which
// breaks once Next.js bundles it. Copy the worker into public/ so it is served
// at /maplibre-gl-worker.mjs, and point MapLibre at it with setWorkerUrl().
// Runs automatically after `npm install` (postinstall).
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
console.log("Copied MapLibre worker to public/maplibre-gl-worker.mjs");
