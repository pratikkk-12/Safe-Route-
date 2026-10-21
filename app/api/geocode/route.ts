// GET /api/geocode?q=FC%20Road -> [{ label, detail, lat, lon }] within Pune / PCMC.
import { GeocodeBusyError, geocode } from "@/lib/geocode";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return Response.json([]);
  try {
    const places = await geocode(q);
    return Response.json(places, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (err) {
    if (err instanceof GeocodeBusyError) {
      return Response.json({ error: "Place search is busy. Please try again in a moment." }, { status: 503 });
    }
    console.warn("GET /api/geocode failed:", (err as Error).message);
    return Response.json({ error: "Place search isn't available right now." }, { status: 502 });
  }
}
