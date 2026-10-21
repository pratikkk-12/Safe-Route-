// Area covered by the app: Pune city + PCMC.
export const PUNE_CENTER = { lat: 18.52, lon: 73.85 } as const;

export const PUNE_BBOX = {
  south: 18.4,
  north: 18.72,
  west: 73.68,
  east: 74.05,
} as const;

export const H3_RESOLUTION = 9;

export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

export const REPO_URL = "https://github.com/pratikkk-12/Safe-Route-";

/** Sent to Overpass, OSRM, Photon etc. Never include an email address. */
export const USER_AGENT = `SafeRoute-Pune/0.1 (+${REPO_URL})`;
