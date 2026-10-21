// Photon geocoding (photon.komoot.io), biased and limited to Pune. Server-side proxy so
// users' IPs aren't sent to Photon and we can cache and throttle.
import { PUNE_BBOX, PUNE_CENTER, USER_AGENT } from "@/lib/config";
import { createQueue, createTtlCache } from "@/lib/http/throttle";

const URL_BASE = process.env.PHOTON_URL ?? "https://photon.komoot.io/api/";
const enqueue = createQueue(250);
const cache = createTtlCache<Place[]>(24 * 60 * 60 * 1000, 2000);

export interface Place {
  label: string;
  /** Second line: area / city. */
  detail: string;
  lat: number;
  lon: number;
}

export class GeocodeBusyError extends Error {}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

export function placeFromPhoton(f: PhotonFeature): Place {
  const p = f.properties;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const label = p.name ?? (street || p.district || p.locality || p.city || "Unnamed place");
  const detail = [p.name ? street : null, p.district ?? p.locality, p.city ?? p.county]
    .filter((x, i, a) => x && x !== label && a.indexOf(x) === i)
    .join(", ");
  const [lon, lat] = f.geometry.coordinates;
  return { label, detail, lat, lon };
}

export async function geocode(query: string, limit = 5): Promise<Place[]> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 120);
  const key = `${q.toLowerCase()}|${limit}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    q,
    limit: String(limit),
    lang: "en",
    lat: String(PUNE_CENTER.lat),
    lon: String(PUNE_CENTER.lon),
    bbox: `${PUNE_BBOX.west},${PUNE_BBOX.south},${PUNE_BBOX.east},${PUNE_BBOX.north}`,
  });
  const res = await enqueue(() =>
    fetch(`${URL_BASE}?${params}`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) }),
  );
  if (res.status === 429) throw new GeocodeBusyError();
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  const places = (json.features ?? []).map(placeFromPhoton).filter((p) => {
    const k = `${p.label}|${p.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  cache.set(key, places);
  return places;
}
