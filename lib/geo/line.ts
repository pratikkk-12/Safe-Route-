// Pure geometry helpers. Coordinates are [lon, lat] (GeoJSON order).
export type LonLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function lineLengthM(coords: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1], coords[i]);
  return total;
}

/** Linear interpolation between two points (fine at the ~100 m scale used here). */
function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Point at `distM` metres along the line (clamped to the ends). */
export function pointAlong(coords: LonLat[], distM: number): LonLat {
  if (distM <= 0) return coords[0];
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(coords[i - 1], coords[i]);
    if (walked + seg >= distM) return seg === 0 ? coords[i] : lerp(coords[i - 1], coords[i], (distM - walked) / seg);
    walked += seg;
  }
  return coords[coords.length - 1];
}

export interface LinePiece {
  coords: LonLat[];
  lengthM: number;
  /** Point halfway along the piece (by length), used to assign its H3 cell. */
  midpoint: LonLat;
}

/**
 * Split a polyline into consecutive pieces of at most `maxM` metres.
 * Pieces are equal length (total / ceil(total / maxM)), so there are no tiny leftovers.
 * Zero-length lines and lines with fewer than 2 points return [].
 */
export function splitLine(coords: LonLat[], maxM = 100): LinePiece[] {
  if (coords.length < 2) return [];
  const total = lineLengthM(coords);
  if (total === 0) return [];

  const n = Math.max(1, Math.ceil(total / maxM - 1e-9));
  const step = total / n;
  const pieces: LinePiece[] = [];

  let i = 1; // index of the next vertex
  let walked = 0; // distance from start to coords[i - 1]
  let current: LonLat[] = [coords[0]];

  for (let k = 1; k <= n; k++) {
    const cut = k === n ? total : k * step;
    // Add whole vertices that lie before the cut.
    while (i < coords.length) {
      const seg = haversineM(coords[i - 1], coords[i]);
      if (walked + seg >= cut - 1e-6) break;
      walked += seg;
      current.push(coords[i]);
      i++;
    }
    let end: LonLat;
    if (k === n || i >= coords.length) {
      end = coords[coords.length - 1];
    } else {
      const seg = haversineM(coords[i - 1], coords[i]);
      end = seg === 0 ? coords[i] : lerp(coords[i - 1], coords[i], (cut - walked) / seg);
    }
    current.push(end);
    const lengthM = lineLengthM(current);
    pieces.push({ coords: current, lengthM, midpoint: pointAlong(current, lengthM / 2) });
    current = [end];
  }
  return pieces;
}
