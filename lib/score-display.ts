// Shared display helpers for scores (client and server safe).
import type { ComponentKey } from "@/lib/scoring/config";

export const COMPONENT_LABELS: Record<ComponentKey, { label: string; hint: string }> = {
  openPlaces: { label: "Open places", hint: "Shops, food, ATMs, hotels, fuel open at this hour" },
  lighting: { label: "Street lighting", hint: "Share of mapped roads tagged as lit" },
  roadType: { label: "Main roads", hint: "Share of busier main roads" },
  anchors: { label: "Help nearby", hint: "Police, hospital with emergency care, 24x7 fuel" },
  transit: { label: "Transit", hint: "Bus stops and stations in service" },
};

export const NOT_ENOUGH_DATA = {
  label: "Not enough data",
  popup: "Not enough mapped data here. This doesn't mean the area is unsafe.",
};

export const CONFIDENCE_TEXT = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence (limited map data)",
} as const;

export const formatHour = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Current hour in Pune (Asia/Kolkata), regardless of the device time zone. */
export function currentPuneHour(now = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(now);
  return Number(h) % 24;
}

/** Heat-layer colour stops (score -> colour): quieter slate to busier green. */
export const HEAT_STOPS: [number, string][] = [
  [0, "#64748b"],
  [20, "#6366f1"],
  [45, "#f59e0b"],
  [70, "#22c55e"],
  [100, "#15803d"],
];
