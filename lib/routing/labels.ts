// Route labels and the plain-words tradeoff line shown on each card.

export interface LabelInput {
  durationS: number;
  score: number;
  /** Length of the weakest stretch when it is low-activity (score < 40), else 0. Metres. */
  lowRunM: number;
  /** A named place near the route's weakest stretch, if any. */
  weakestNear: string | null;
}

export type RouteLabel = "Safest" | "Fastest" | "Safest and fastest" | "Balanced" | "Alternative";

export function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 50) * 50} m`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Index of the fastest and the safest route (ties: safest prefers the faster one). */
export function pickFastestSafest(routes: LabelInput[]): { fastest: number; safest: number } {
  let fastest = 0;
  let safest = 0;
  routes.forEach((r, i) => {
    if (r.durationS < routes[fastest].durationS) fastest = i;
    const s = routes[safest];
    if (r.score > s.score || (r.score === s.score && r.durationS < s.durationS)) safest = i;
  });
  return { fastest, safest };
}

export function labelRoutes(routes: LabelInput[]): RouteLabel[] {
  if (routes.length === 0) return [];
  const { fastest, safest } = pickFastestSafest(routes);
  const labels: RouteLabel[] = routes.map(() => "Alternative");
  if (fastest === safest) labels[fastest] = "Safest and fastest";
  else {
    labels[fastest] = "Fastest";
    labels[safest] = "Safest";
  }
  // The best-scoring remaining route is "Balanced" when there are three.
  if (routes.length >= 3) {
    const rest = routes.map((r, i) => ({ r, i })).filter(({ i }) => labels[i] === "Alternative");
    rest.sort((a, b) => b.r.score - a.r.score);
    if (rest[0] && (fastest !== safest || routes.length >= 3)) labels[rest[0].i] = "Balanced";
  }
  return labels;
}

const LOW_RUN_MIN_M = 100;

/** "a" or "an" before a spoken number: an 800 m, an 11 km, an 18 km; a 1.2 km, a 950 m. */
export const article = (spoken: string) => (/^(8|1[18](\D|$))/.test(spoken) ? "an" : "a");
const nearText = (near: string | null) => (near ? ` near ${near}` : "");

/** The tradeoff in plain words, relative to the fastest route. Calm, never alarmist. */
export function tradeoffText(route: LabelInput, fastestRoute: LabelInput, label: RouteLabel): string {
  if (label === "Safest and fastest") return "The fastest route is also the busiest, best-lit option.";

  if (route === fastestRoute || label === "Fastest") {
    return route.lowRunM >= LOW_RUN_MIN_M
      ? `Quickest, but includes ${article(formatDistance(route.lowRunM))} ${formatDistance(route.lowRunM)} low-activity stretch${nearText(route.weakestNear)}.`
      : "Quickest option.";
  }

  const diffMin = Math.round((route.durationS - fastestRoute.durationS) / 60);
  const time = diffMin <= 0 ? "About the same time" : `${diffMin} min longer`;
  const avoided = fastestRoute.lowRunM - route.lowRunM;
  if (fastestRoute.lowRunM >= LOW_RUN_MIN_M && avoided >= LOW_RUN_MIN_M) {
    const d = formatDistance(fastestRoute.lowRunM);
    return `${time}, avoids ${article(d)} ${d} low-activity stretch${nearText(fastestRoute.weakestNear)}.`;
  }
  if (route.score > fastestRoute.score) {
    return `${time}, busier and better-lit overall (${route.score} vs ${fastestRoute.score}).`;
  }
  return `${time}, similar activity to the quickest route.`;
}
