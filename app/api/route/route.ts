// POST /api/route  { from: {lat, lon}, to: {lat, lon}, mode, departAt } -> scored routes.
// Privacy: requests are never stored or logged with their coordinates.
import { parseRouteRequest } from "@/lib/http/route-request";
import { planRoutes } from "@/lib/routing/plan";
import { RoutingError } from "@/lib/routing/types";

const MESSAGES: Record<RoutingError["code"], { status: number; error: string }> = {
  busy: { status: 503, error: "The routing service is busy right now. Please try again in a minute." },
  no_route: { status: 404, error: "We couldn't find a route between these places." },
  upstream: { status: 502, error: "The routing service isn't responding. Please try again shortly." },
  bad_request: { status: 400, error: "Something is wrong with this trip. Please check the places." },
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseRouteRequest(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const plan = await planRoutes(parsed);
    if (plan.routes.length === 0) return Response.json(MESSAGES.no_route, { status: 404 });
    return Response.json(plan, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof RoutingError) {
      console.warn(`POST /api/route: ${err.code} (${err.message})`);
      const m = MESSAGES[err.code];
      return Response.json({ error: m.error }, { status: m.status });
    }
    console.error("POST /api/route failed:", (err as Error).message);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
