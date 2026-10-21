// GET /api/cells?hour=22&bbox=w,s,e,n -> [{ h3, score, confidence, insufficient }]
import { parseBbox } from "@/lib/http/bbox";
import { getCellScores, parseHour } from "@/lib/scores";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const hour = parseHour(params.get("hour"));
  const bbox = parseBbox(params.get("bbox"));
  if (hour === null) return Response.json({ error: "hour must be an integer 0-23" }, { status: 400 });
  if (!bbox) return Response.json({ error: "bbox=w,s,e,n is required" }, { status: 400 });

  try {
    const cells = await getCellScores(hour, bbox);
    return Response.json(cells, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" },
    });
  } catch (err) {
    console.error("GET /api/cells failed", err);
    return Response.json({ error: "Scores are unavailable right now." }, { status: 503 });
  }
}
