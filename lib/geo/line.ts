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

export interface LineSample {
  point: LonLat;
  /** Distance from the start of the line, in metres. */
  distM: number;
}

/**
 * Points every `stepM` metres along the line, always including the start and the end.
 * Used to look up the H3 cell (and hour) at each point of a route.
 */
export function sampleLine(coords: LonLat[], stepM = 25): LineSample[] {
  if (coords.length === 0) return [];
  const out: LineSample[] = [{ point: coords[0], distM: 0 }];
  let walked = 0;
  let next = stepM;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(coords[i - 1], coords[i]);
    while (seg > 0 && next <= walked + seg) {
      out.push({ point: lerp(coords[i - 1], coords[i], (next - walked) / seg), distM: next });
      next += stepM;
    }
    walked += seg;
  }
  if (walked > out[out.length - 1].distM + 1e-6) out.push({ point: coords[coords.length - 1], distM: walked });
  return out;
}

/** Distance in metres from point p to segment a-b (local equirectangular projection). */
export function pointSegmentDistanceM(p: LonLat, a: LonLat, b: LonLat): number {
  const k = Math.cos(toRad(p[1]));
  const ax = (a[0] - p[0]) * k;
  const ay = a[1] - p[1];
  const bx = (b[0] - p[0]) * k;
  const by = b[1] - p[1];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.sqrt(x * x + y * y) * (Math.PI / 180) * EARTH_RADIUS_M;
}

/**
 * Share (0..1) of line `a`'s length that runs within `toleranceM` of line `b`.
 * Used to drop route candidates that mostly duplicate another route.
 */
export function overlapShare(a: LonLat[], b: LonLat[], toleranceM = 20, stepM = 25): number {
  const samples = sampleLine(a, stepM);
  if (samples.length < 2 || b.length < 2) return 0;
  // Bounding box of b, padded, to skip far-away samples quickly.
  const pad = toleranceM / 111_000 / Math.cos(toRad(a[0][1]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of b) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  let near = 0;
  for (const { point } of samples) {
    if (point[0] < minX - pad || point[0] > maxX + pad || point[1] < minY - pad || point[1] > maxY + pad) continue;
    for (let i = 1; i < b.length; i++) {
      if (pointSegmentDistanceM(point, b[i - 1], b[i]) <= toleranceM) {
        near++;
        break;
      }
    }
  }
  return near / samples.length;
}
