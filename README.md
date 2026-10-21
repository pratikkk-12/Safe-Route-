# SafeRoute Pune

Mobile-first web app that helps people pick busier, better-lit routes at night in Pune.
The Night Activity Score is an **indicator only, not a guarantee of safety. In an emergency, call 112.**

Stack: Next.js (App Router, TypeScript, Tailwind) · Neon Postgres + PostGIS · Drizzle ORM ·
MapLibre GL + OpenFreeMap · h3-js · OSRM (FOSSGIS) or OpenRouteService · Photon · Overpass · Vitest.

Full spec: [SAFEROUTE-BUILD-PROMPT.md](SAFEROUTE-BUILD-PROMPT.md).

## Setup (Windows PowerShell)

Requires Node.js 20+.

```powershell
npm install
Copy-Item .env.example .env.local
notepad .env.local    # set DATABASE_URL to your Neon connection string
                      # ROUTING_PROVIDER=osrm needs no key; ORS_API_KEY is optional
```

### Database

```powershell
npm run db:migrate    # enables PostGIS and creates tables
npm run db:check      # prints PostGIS version and confirms the 4 tables exist
```

After changing `lib/db/schema.ts`, run `npm run db:generate` and then `npm run db:migrate`.

### OSM data (Phase 2)

Pulls POIs and roads for Pune + PCMC from Overpass in 4 x 4 tiles, assigns H3 cells,
splits roads into segments of at most 100 m, and replaces the `poi` and `road_segment` tables.
Raw Overpass responses are cached in `data/overpass/`, so re-runs don't hit Overpass.

```powershell
npm run ingest-osm                   # first run downloads ~32 tiles (can take 15-40 min)
npm run ingest-osm -- --dry-run      # fetch and print counts only, DB untouched
npm run ingest-osm -- --refresh      # re-download every tile
npm run ingest-osm -- --tiles=6      # smaller tiles if Overpass times out
```

The script prints POI counts per category and road km per class. In `npm run dev` the map
shows a **Debug: POIs** toggle (top left); in a production build add `?debug` to the URL.

### Night Activity Scores (Phase 3)

Computes a 0-100 score for every H3 cell and hour from the OSM data, and writes `cell_score`
(~285k rows). Tunable weights, opening-hours defaults and thresholds are in
`config/score-weights.json`; the method is in `SAFEROUTE-BUILD-PROMPT.md` section 5.

```powershell
npm run compute-scores                # compute, print stats, write to the DB (~30 s)
npm run compute-scores -- --dry-run   # compute and print stats only
```

It prints the score distribution per hour, cells by confidence, anchor hospital counts, and
the top 10 / bottom 5 built-up cells at 21:00 and 23:00 with their components.
The API caches each hour's scores for up to an hour, so restart `npm run dev` after a
recompute to see the new scores straight away. The home map shows the heat layer with
an hour slider; tap a hexagon for its breakdown.

API: `GET /api/cells?hour=22&bbox=w,s,e,n` -> `[{ h3, score, confidence }]`,
`GET /api/cells/{h3}?hour=22` -> score, confidence and components.

### Run

```powershell
npm run dev           # http://localhost:3000
npm test              # unit tests (Vitest)
npm run lint
```

## Project layout

| Path | What |
| --- | --- |
| `app/` | Next.js routes |
| `components/MapView.tsx` | Full-screen MapLibre map |
| `components/DebugPoiLayer.tsx` | Debug toggle showing POIs from the database |
| `app/api/debug/pois` | `GET ?bbox=w,s,e,n` → POIs as GeoJSON |
| `lib/geo/` | Distance and line-splitting helpers |
| `lib/osm/` | Overpass client and OSM tag classification |
| `lib/config.ts` | Pune centre, bounding box, H3 resolution |
| `lib/db/schema.ts` | Drizzle schema (poi, road_segment, cell_score, report) |
| `lib/scoring/` | Pure scoring functions + tests |
| `lib/scores.ts` | Cached cell_score reads for the API |
| `components/ScoreLayer.tsx`, `HourPanel.tsx` | Heat layer and hour slider |
| `config/score-weights.json` | Score component weights |
| `drizzle/` | SQL migrations (`0000` enables PostGIS) |
| `scripts/` | migrate, db-check, ingest-osm, compute-scores |

## Data and attribution

Map data © OpenStreetMap contributors (ODbL). Tiles by OpenFreeMap / OpenMapTiles.
