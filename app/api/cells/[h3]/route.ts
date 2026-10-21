// GET /api/cells/{h3}?hour=22 -> { h3, hour, score, confidence, components }
import { getCellDetail, parseHour } from "@/lib/scores";

export async function GET(request: Request, ctx: RouteContext<"/api/cells/[h3]">) {
  const { h3 } = await ctx.params;
  const hour = parseHour(new URL(request.url).searchParams.get("hour"));
  if (hour === null) return Response.json({ error: "hour must be an integer 0-23" }, { status: 400 });

  try {
    const detail = await getCellDetail(h3, hour);
    if (!detail) return Response.json({ error: "No score for this cell" }, { status: 404 });
    return Response.json(detail, { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } });
  } catch (err) {
    console.error("GET /api/cells/[h3] failed", err);
    return Response.json({ error: "Scores are unavailable right now." }, { status: 503 });
  }
}
