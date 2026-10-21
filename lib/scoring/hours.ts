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

/**
 * For each hour h, the fraction of the 7 weekdays the schedule is open at h:30.
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
          if (oh.getState(new Date(REF_YEAR, REF_MONTH, REF_MONDAY + d, h, 30))) open++;
        }
        return open / 7;
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

/** Open fraction per hour. A real tag always wins; otherwise the category default. */
export function poiOpenByHour(poi: PoiHoursInput, defaults: Record<PoiCategory, string>): HourArray {
  if (poi.is24x7) return Array(24).fill(1);
  if (poi.openingHours) {
    const fromTag = openFractionByHour(poi.openingHours);
    if (fromTag) return fromTag;
  }
  const fallback = defaults[poi.category];
  return (fallback && openFractionByHour(fallback)) || Array(24).fill(0);
}
