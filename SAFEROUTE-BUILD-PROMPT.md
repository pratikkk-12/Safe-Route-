Working name: SafeRoute Pune (rename freely with find and replace).

Read this whole file before writing any code. Build in phases (section 9). Stop after each phase, tell me exactly how to test it locally, and wait for my OK before starting the next one.

## 1. What we are building

A mobile-first web app (PWA) that helps people, especially women, pick safer routes at night in Pune.

The city is divided into small hexagons (H3, resolution 9, about 0.1 sq km each).
Every hexagon gets a Night Activity Score (0 to 100) for each hour of the day (0 to 23).
The user enters a start, a destination, a travel mode and a departure time.
The app fetches 2 to 3 route options, scores each one for that hour, and shows the safest next to the fastest, with reasons and the weakest stretch highlighted.

The score is an indicator, not a guarantee. The UI must always say so.

## 2. Stack (do not change without asking me)

| Layer | Choice |
| --- | --- |
| Framework | Latest stable Next.js, App Router, TypeScript, Tailwind CSS |
| Database | Neon Postgres with the PostGIS extension enabled |
| ORM | Drizzle ORM with the Neon serverless driver |
| Map | MapLibre GL JS with OpenFreeMap tiles (https://tiles.openfreemap.org/styles/liberty), no API key |
| Hex grid | h3-js, resolution 9 |
| Routing | Provider interface in lib/routing/ (see section 6). Default: FOSSGIS public OSRM (no key). Optional: OpenRouteService Directions API v2 (free key) |
| Geocoding | Photon (https://photon.komoot.io/api/), biased to Pune (lat 18.52, lon 73.85) |
| OSM ingestion | Overpass API, run as one-time scripts, never per user request |
| Opening hours | opening_hours npm package to evaluate OSM opening_hours at a given hour |
| Tests | Vitest |
| Hosting | Vercel |
| Scheduled jobs | GitHub Actions (nightly score recompute) |

Dev machine: Windows, PowerShell in the VS Code terminal. Every command you give me must work in PowerShell. Use `$env:NAME="value"` for env vars, never export.

## 3. Area

Pune city plus PCMC. Bounding box (adjust if needed):

- South 18.40, North 18.72
- West 73.68, East 74.05

Fetch Overpass data in tiles (for example 4 x 4) to avoid timeouts, with a pause between requests.

## 4. Data model (PostGIS)

```
poi
  id serial pk
  osm_id bigint unique
  category text        -- fuel, pharmacy, hospital, police, restaurant, fast_food, cafe,
                       -- convenience, atm, hotel, bus_stop, bus_station, metro_station, railway_station
  name text null
  opening_hours text null
  is_24x7 boolean
  geom geometry(Point, 4326)
  h3_r9 text  (indexed)

road_segment
  id serial pk
  osm_id bigint
  highway_class text   -- trunk, primary, secondary, tertiary, residential, service, unclassified, track, path, footway
  lit text null        -- yes / no / null (unknown)
  length_m real
  geom geometry(LineString, 4326)
  h3_r9 text  (indexed, cell of segment midpoint; split long segments at 100 m)

cell_score
  h3_r9 text
  hour smallint        -- 0 to 23
  score smallint       -- 0 to 100
  confidence text      -- high / medium / low
  components jsonb     -- each component's normalized value, for "why this score"
  updated_at timestamptz
  primary key (h3_r9, hour)

report
  id serial pk
  h3_r9 text           -- location stored ONLY as the cell, never raw coordinates
  category text        -- poorly_lit, deserted, felt_unsafe, harassment, well_lit, busy_and_open, felt_safe
  sentiment smallint   -- -1 or +1, derived from category
  hour smallint
  ip_hash text         -- HMAC of IP with IP_HASH_SECRET, only for rate limiting
  status text          -- pending / approved / rejected
  created_at timestamptz
```

Rough size: about 12,000 cells x 24 hours, around 300k cell_score rows. Fine for Neon.

## 5. Night Activity Score

For each cell and each hour, compute the weighted components below, then apply community reports as a post-score adjustment. Weights and all tunable values live in config/score-weights.json so I can tune them without code changes.

Normalization:

- Count components (open places, transit): log(1 + count), clipped at city-wide p5 and p99 over all cell-hours (so night stays lower than day).
- Components already on a meaningful 0 to 1 scale (road type share, lighting share, anchor proximity) are used as-is, with no percentile stretch.

| Component | Weight | How |
| --- | --- | --- |
| Open places at that hour | 0.3333 | Non-transit POIs open at that hour in the cell plus ring-1 neighbours. "Open at hour h" = the fraction of 28 checks (h:00, h:15, h:30, h:45 on each of the 7 weekdays) at which it is open. Real opening_hours tags always win; if missing or unparseable, use the default (below) |
| Lighting | 0.2222 | Only cells with real lit data: at least 30% of the cell's road length has a lit tag (config: lighting.minTaggedShare). Value = share of the tagged length with lit=yes. Otherwise lighting is **missing**: it is NOT estimated from road class, and its weight is redistributed proportionally across the other components |
| Road type | 0.1667 | Length share of trunk/primary/secondary/tertiary vs residential/service/unclassified/track/path/footway |
| Safety anchors nearby | 0.1667 | Distance from the cell centre to the nearest police station, anchor hospital and 24x7 fuel station; each gives full credit within 300 m, zero beyond 1.5 km (linear between), averaged. A hospital is an anchor only if emergency=yes, OR its name contains "hospital" (case-insensitive) AND it is mapped as a way/relation. Name-only nodes are not anchors; non-anchor "hospitals" (mostly clinics) count only as open places. A fuel station is 24x7 if its tag says so or it has no tag |
| Transit presence | 0.1111 | Bus stops, bus stations, metro and railway stations in service at that hour (defaults below) in the cell plus ring-1. A **bonus**: see combining |

(The original weights 0.30 / 0.20 / 0.15 / 0.15 / 0.10 with reports' 0.10 redistributed proportionally.)

Opening-hours defaults (used only when opening_hours is missing or unparseable; real tags always override):

| Category | Default |
| --- | --- |
| restaurant, fast_food, cafe | 11:00-23:30 |
| convenience | 07:00-22:00 |
| pharmacy | 08:00-22:00 |
| atm, hotel, fuel, police, railway_station, anchor hospitals | 24x7 |
| non-anchor hospitals (mostly clinics) | 09:00-21:00 |
| metro_station | 06:00-22:00 |
| bus_station | 05:00-23:00 |
| bus_stop | 05:30-23:00 |

Community reports (post-score adjustment, not a weighted component):

- Only applies when approved reports from at least 2 distinct ip_hashes exist for that cell within plus or minus 2 hours of this hour (wrapping midnight) over the last 90 days. Evaluated per hour, not per cell.
- Time decay half-life 30 days. Adjustment = tanh(decayed sentiment sum / saturation), scaled to -20 points (negative) .. +10 points (positive).
- Qualifying reports raise the cell's confidence one level for that hour (low to medium, medium to high).

Combining:

- with = weighted mean of available components (missing lighting drops out; remaining weights scale up proportionally).
- without_transit = the same, with transit removed.
- median_h = median of `with` at that hour over cells with enough data.
- base = max(with, min(without_transit, median_h)): lacking transit can lower an above-median cell at most to the median, and never lowers a below-median cell.
- final = clamp(base x 100 + report adjustment, 0, 100), rounded.

Confidence (per cell and hour):

- high: real lit data present and 5+ POIs nearby (cell plus ring-1, any category)
- medium: one of those
- low: neither
- raised one level where reports qualify

Insufficient data (per cell and hour): fewer than 3 POIs in the cell plus ring-1, no real lighting data, and no qualifying reports.

- Stored in cell_score.insufficient_data; the stored score is road type only (used by routing).
- Heat map: grey hatch pattern, legend label "Not enough data", not a score colour.
- Popup: "Not enough mapped data here. This doesn't mean the area is unsafe."

Since real lit data is rare in Pune OSM, most cells will be medium or low confidence, and many are insufficient data. That is expected and must be shown, not hidden.

All scoring logic goes in lib/scoring/ as pure functions with Vitest unit tests. scripts/compute-scores.ts prints the score distribution per hour (p10, p50, p90), share of cells by confidence, insufficient-data counts, the number of hospitals that qualify as anchors, and the top cells with their components.

## 6. Route scoring

Geocode from and to with Photon (autocomplete, debounce 300 ms).

### Routing provider interface

Put routing behind a provider interface in lib/routing/:

```
getRoutes(from, to, mode) → [{ geometry (GeoJSON LineString), distance_m, duration_s }]
```

The provider is selected by env var `ROUTING_PROVIDER` (`osrm` | `ors`), default `osrm`. Scoring code depends only on this interface, never on a specific provider.

**1. osrm (default): FOSSGIS public OSRM, no API key**

- Car / Two-wheeler / Auto: `https://routing.openstreetmap.de/routed-car/route/v1/driving/{lon},{lat};{lon},{lat}`
- Walk: `https://routing.openstreetmap.de/routed-foot/route/v1/driving/{lon},{lat};{lon},{lat}`
- Params: `alternatives=3&overview=full&geometries=geojson`
- Verify the exact URL format with one test call before building on it.
  (Checked 2026-10-21: both endpoints return `code: "Ok"` with GeoJSON LineStrings. `alternatives=3` is a maximum, not a guarantee: FC Road to Hinjewadi returned 2 routes. Handle 1 to 3 routes.)
- Max 1 request per second (queue on the server), cache identical requests for 10 minutes, keep OSM attribution visible.
- User-Agent: `SafeRoute-Pune/0.1 (+https://github.com/pratikkk-12/Safe-Route-)`. Never put an email address in the User-Agent or any request.

**2. ors: OpenRouteService Directions v2, used only when ORS_API_KEY is set**

- profile: foot-walking (Walk), driving-car (Two-wheeler / Auto / Car)
- alternative_routes: { target_count: 3, weight_factor: 1.6, share_factor: 0.6 }
- If `ROUTING_PROVIDER=ors` but ORS_API_KEY is missing, fall back to osrm and log a warning once at startup (not on every request).

### Extra candidates via a via point (osrm)

OSRM alternatives are chosen for speed, not safety, so the safest real option may not be among the 1 to 3 routes returned. If fewer than 3 come back, generate up to 2 extra candidates using a via point:

- Pick the highest-scoring cells (at the departure hour) within 1 km of the straight-line midpoint, at least 300 m apart from each other.
- Request `from;via;to` in a single OSRM call with `alternatives=false`.
- Drop any candidate more than 50% longer than the fastest route.
- Dedupe candidates that share more than 80% of their length with another route.
- Score every candidate the same way as normal routes.

All calls, including via-point calls, go through the same 1 request/second queue.

### Scoring each route

For each route:

- Sample the geometry every 25 m and map each point to its H3 cell.
- Look up cell_score for the departure hour (use the hour each sample is reached, based on cumulative duration).
- Route score = 0.7 x length-weighted mean + 0.3 x the lowest 200 m rolling average. This penalizes a route with one very dark stretch.
- Return: distance, duration, score, confidence, label, weakest stretch (geometry + top 2 reasons from components), per-segment colours. Route confidence = the length-weighted mix of cell confidences along the route, shown on every route card.
- Cells marked insufficient data are scored on road type only. Each route card shows "X% of this route passes through areas with limited data" (share of route length in insufficient-data cells).

Labels: Safest, Fastest, Balanced (if a third route exists).

Segment colours: green 70+, amber 40 to 69, red below 40.

Always show the tradeoff in plain words, for example: "6 min longer, avoids a 900 m low-activity stretch near X."

## 7. Screens (mobile-first)

- **Home map:** hexagon heat layer of scores, hour slider (defaults to current hour), locate-me button. Client receives h3 ids + scores and draws polygons with cellToBoundary.
- **Plan route:** From, To (autocomplete, "use my location"), mode (Walk / Two-wheeler or Auto / Car), departure (Now / pick time).
- **Results:** 2 to 3 route cards + coloured routes on the map, "Why this score" breakdown, weakest stretch highlighted, disclaimer line. Every route card shows its confidence (high / medium / low), since most cells will be medium or low.
- **Report a spot:** tap the map or use current location, pick a category, pick the hour (defaults to now). Anonymous, no login, no free text.
- **About:** data sources, OSM attribution, how the score works, its limits, emergency number 112, and a "Known gaps" section: OSM data in Pune is incomplete; office campuses and night shifts (e.g. Hinjewadi, Kharadi, Magarpatta) don't appear as activity; community reports are what improve the score over time.

Tone: plain, calm, never alarmist. Never call an area or neighbourhood "unsafe". Use "low night activity" and "busier, better-lit route" language.

## 8. Privacy and safety rules (non-negotiable)

- No user accounts in the MVP. Do not store route searches, origins, destinations or live locations.
- Reports store only the H3 cell, never raw coordinates. IP is HMAC-hashed with IP_HASH_SECRET and used only for rate limiting (max 5 reports per IP per day).
- New reports are pending. Admin approves or rejects at /admin, protected by ADMIN_PASSWORD.
- Results screen always shows: "Indicator only, not a guarantee of safety. In an emergency, call 112."
- OSM attribution visible on the map (ODbL).
- Respect usage policies of Overpass, Photon, FOSSGIS OSRM and OpenRouteService: cache ingestion results, debounce geocoding, rate-limit routing calls, handle 429s gracefully with a friendly message.

## 9. Build phases

Stop after each phase, give me PowerShell steps to test locally, and wait for my OK.

**Phase 1: Scaffold + database.** Next.js app, Tailwind, Drizzle schema and migrations, PostGIS enabled on Neon, .env.example. Done when: npm run dev shows a full-screen MapLibre map centred on Pune.

**Phase 2: OSM ingestion.** scripts/ingest-osm.ts pulls POIs and roads for the bounding box via Overpass in tiles, stores them, assigns H3 cells, splits long road segments. Done when: the script prints counts per category, and a debug layer toggle shows POIs on the map.

**Phase 3: Scoring.** scripts/compute-scores.ts writes cell_score for all 24 hours. GET /api/cells?hour=22&bbox=w,s,e,n returns [{ h3, score, confidence }]. Done when: the heat layer renders and visibly changes as I move the hour slider. Unit tests for every scoring component pass.

**Phase 4: Routing.** Routing provider interface in lib/routing/ with osrm and ors providers, plus via-point extra candidates when fewer than 3 routes come back (section 6). POST /api/route with { from, to, mode, departAt } returns scored alternatives. Done when these return 2 to 3 scored routes with a weakest stretch:

- FC Road to Hinjewadi Phase 1, 23:00, Two-wheeler
- Pune Railway Station to Koregaon Park, 22:30, Walk

**Phase 5: Community reports + admin.** Report form, rate limiting, /admin moderation queue. A nightly GitHub Action runs npm run compute-scores so approved reports feed into scores. Done when: an approved test report changes that cell's score after a recompute.

**Phase 6: PWA polish.** Manifest, icons, offline app shell, install prompt, loading and error states, empty states. Done when: installable on Android Chrome and Lighthouse mobile scores 90+ for performance and accessibility.

**Later (do NOT build yet):** Share live trip link, arrival check-in timer that alerts contacts if missed, SOS via WhatsApp share link, Marathi and Hindi UI, VIIRS satellite night-lights layer, other cities.

## 10. Environment variables

```
DATABASE_URL=
ROUTING_PROVIDER=osrm        # osrm (default, no key) | ors
ORS_API_KEY=                 # optional; only needed when ROUTING_PROVIDER=ors
ADMIN_PASSWORD=
IP_HASH_SECRET=
CRON_SECRET=
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
```

## 11. Working rules

- Ask before changing the stack or adding a paid service.
- Keep API keys server-side only. Never expose ORS_API_KEY to the client.
- Commit after each phase with a clear message.
- Keep a short README.md updated with setup and run steps (PowerShell).
