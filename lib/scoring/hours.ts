// Which hours a POI is open, from its OSM opening_hours tag or a per-category default.
import OpeningHours from "opening_hours";
import type { PoiCategory } from "@/lib/osm/classify";

export type HourArray = number[]; // length 24, values 0..1

// A fixed reference week (Mon 5 Jan 2026). Dates are built and read in local time,
// so the result doesn't depend on the machine's time zone.
const REF_YEAR = 2026;
const REF_MONTH = 0;
const REF_MONDAY = 5;

const cache = new Map<string, HourArray | null>();

const QUARTERS = [0, 15, 30, 45];

/**
 * For each hour h, the fraction of time the schedule is open during that hour:
 * checked at h:00, h:15, h:30 and h:45 on each of the 7 weekdays (28 checks).
 * Returns null if the value can't be parsed.
 */
export function openFractionByHour(spec: string): HourArray | null {
  const key = spec.trim();
  if (cache.has(key)) return cache.get(key)!;
  let result: HourArray | null;
  if (key === "24/7") {
    result = Array(24).fill(1);
  } else {
    try {
      const oh = new OpeningHours(key, null, 0);
      result = Array.from({ length: 24 }, (_, h) => {
        let open = 0;
        for (let d = 0; d < 7; d++) {
          for (const m of QUARTERS) {
            if (oh.getState(new Date(REF_YEAR, REF_MONTH, REF_MONDAY + d, h, m))) open++;
          }
        }
        return open / (7 * QUARTERS.length);
      });
    } catch {
      result = null;
    }
  }
  cache.set(key, result);
  return result;
}

export interface PoiHoursInput {
  category: PoiCategory;
  openingHours: string | null;
  is24x7: boolean;
}

/**
 * Open fraction per hour. A real tag always wins; otherwise `fallbackSpec`
 * (the category default, see defaultHoursFor in compute.ts).
 */
export function poiOpenByHour(poi: PoiHoursInput, fallbackSpec: string | undefined): HourArray {
  if (poi.is24x7) return Array(24).fill(1);
  if (poi.openingHours) {
    const fromTag = openFractionByHour(poi.openingHours);
    if (fromTag) return fromTag;
  }
  return (fallbackSpec && openFractionByHour(fallbackSpec)) || Array(24).fill(0);
}
