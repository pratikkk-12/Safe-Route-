// Runs the Phase 4 acceptance trips against a running app (npm run dev).
//   npm run route-check
//   npm run route-check -- --base=http://localhost:3000
import type { PlanResponse } from "@/lib/routing/plan";
import type { TravelMode } from "@/lib/routing/types";
import { formatDistance, formatDuration } from "@/lib/routing/labels";

const BASE = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "http://localhost:3000";

const TRIPS: { from: string; to: string; time: string; mode: TravelMode }[] = [
  { from: "FC Road", to: "Hinjewadi Phase 1", time: "23:00", mode: "two_wheeler" },
  { from: "Pune Railway Station", to: "Koregaon Park", time: "22:30", mode: "walk" },
];

/** Today's date in Pune with the given HH:MM, as an ISO string with the IST offset. */
function istToday(hhmm: string): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return `${date}T${hhmm}:00+05:30`;
}

async function place(q: string) {
  const res = await fetch(`${BASE}/api/geocode?q=${encodeURIComponent(q)}`);
  const [first] = (await res.json()) as { label: string; detail: string; lat: number; lon: number }[];
  if (!first) throw new Error(`No geocoding result for "${q}"`);
  return first;
}

async function main() {
  let failures = 0;
  for (const t of TRIPS) {
    const [from, to] = [await place(t.from), await place(t.to)];
    console.log(`\n=== ${t.from} -> ${t.to}, ${t.time}, ${t.mode}`);
    console.log(`  from: ${from.label} (${from.detail}) ${from.lat.toFixed(5)},${from.lon.toFixed(5)}`);
    console.log(`  to:   ${to.label} (${to.detail}) ${to.lat.toFixed(5)},${to.lon.toFixed(5)}`);
    const started = Date.now();
    const res = await fetch(`${BASE}/api/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, mode: t.mode, departAt: istToday(t.time) }),
    });
    const body = (await res.json()) as PlanResponse & { error?: string };
    if (!res.ok) {
      console.log(`  FAILED: HTTP ${res.status} ${body.error}`);
      failures++;
      continue;
    }
    console.log(`  ${body.routes.length} routes via ${body.provider} in ${((Date.now() - started) / 1000).toFixed(1)} s (departure hour ${body.departHour})`);
    console.table(
      body.routes.map((r) => ({
        label: r.label,
        source: r.source,
        time: formatDuration(r.duration_s),
        distance: formatDistance(r.distance_m),
        score: r.score,
        confidence: r.confidence.level,
        "limited data": `${r.limitedDataPercent}%`,
        weakest: `${formatDistance(r.weakestStretch.length_m)} @ ${r.weakestStretch.score}${r.weakestStretch.near ? ` near ${r.weakestStretch.near}` : ""}`,
        reasons: r.weakestStretch.reasons.map((x) => x.text).join("; "),
      })),
    );
    for (const r of body.routes) console.log(`  ${r.label}: ${r.tradeoff}`);
    const ok = body.routes.length >= 2 && body.routes.every((r) => r.weakestStretch.geometry.coordinates.length >= 2);
    console.log(ok ? "  PASS: 2-3 scored routes, each with a weakest stretch" : "  FAIL: expected 2-3 routes with a weakest stretch");
    if (!ok) failures++;
  }
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
