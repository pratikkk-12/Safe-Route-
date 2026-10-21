# SafeRoute Pune

Mobile-first web app that helps people pick busier, better-lit routes at night in Pune.
The Night Activity Score is an **indicator only, not a guarantee of safety. In an emergency, call 112.**

Stack: Next.js (App Router, TypeScript, Tailwind) · Neon Postgres + PostGIS · Drizzle ORM ·
MapLibre GL + OpenFreeMap · h3-js · OpenRouteService · Photon · Overpass · Vitest.

## Setup (Windows PowerShell)

Requires Node.js 20+.

```powershell
npm install
Copy-Item .env.example .env.local
notepad .env.local    # set DATABASE_URL to your Neon connection string
```

### Database

```powershell
npm run db:migrate    # enables PostGIS and creates tables
npm run db:check      # prints PostGIS version and confirms the 4 tables exist
```

After changing `lib/db/schema.ts`, run `npm run db:generate` and then `npm run db:migrate`.

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
| `lib/config.ts` | Pune centre, bounding box, H3 resolution |
| `lib/db/schema.ts` | Drizzle schema (poi, road_segment, cell_score, report) |
| `lib/scoring/` | Pure scoring functions (Phase 3) |
| `config/score-weights.json` | Score component weights |
| `drizzle/` | SQL migrations (`0000` enables PostGIS) |
| `scripts/` | One-off scripts (migrate, db-check, later: ingestion, scoring) |

## Data and attribution

Map data © OpenStreetMap contributors (ODbL). Tiles by OpenFreeMap / OpenMapTiles.
