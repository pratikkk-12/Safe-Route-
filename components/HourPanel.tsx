"use client";

import Link from "next/link";
import { HEAT_STOPS, NOT_ENOUGH_DATA, formatHour } from "@/lib/score-display";
import type { ScoreStatus } from "./ScoreLayer";

const gradient = `linear-gradient(to right, ${HEAT_STOPS.map(([s, c]) => `${c} ${s}%`).join(", ")})`;
// Matches the map's hatch pattern (see hatchImage in ScoreLayer).
const hatch =
  "repeating-linear-gradient(135deg, rgba(71,85,105,0.55) 0 1.5px, rgba(148,163,184,0.35) 1.5px 5px)";

export default function HourPanel({
  hour,
  onHour,
  status,
}: {
  hour: number;
  onHour: (h: number) => void;
  status: ScoreStatus;
}) {
  return (
    <section
      aria-label="Night activity by hour"
      className="absolute inset-x-3 z-10 mx-auto max-w-md rounded-xl bg-white/95 p-3 text-zinc-900 shadow-lg"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 2.25rem)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="hour" className="text-sm font-semibold">
          Night activity at <span className="tabular-nums">{formatHour(hour)}</span>
        </label>
        <span className="text-xs text-zinc-500" aria-live="polite">
          {status === "loading" && "Loading…"}
          {status === "error" && "Couldn't load scores. Check your connection."}
          {status === "empty" && "No scores here yet."}
        </span>
      </div>
      <input
        id="hour"
        type="range"
        min={0}
        max={23}
        step={1}
        value={hour}
        onChange={(e) => onHour(Number(e.target.value))}
        aria-valuetext={formatHour(hour)}
        className="mt-2 w-full accent-zinc-800"
      />
      <div className="flex justify-between text-[10px] tabular-nums text-zinc-500" aria-hidden>
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
      <div className="mt-2">
        <div className="h-2 rounded" style={{ background: gradient }} aria-hidden />
        <div className="mt-0.5 flex justify-between text-[11px] text-zinc-600">
          <span>Quieter</span>
          <span>Busier, better-lit</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-600">
          <span className="inline-block h-3 w-5 rounded-sm border border-zinc-300" style={{ background: hatch }} aria-hidden />
          {NOT_ENOUGH_DATA.label}
        </div>
        <p className="mt-0.5 text-[11px] text-zinc-500">Fainter hexagons have less map data. Tap one for details.</p>
      </div>
      <p className="mt-2 border-t border-zinc-200 pt-2 text-[11px] text-zinc-600">
        Indicator only, not a guarantee of safety. In an emergency, call <a href="tel:112" className="font-semibold underline">112</a>.{" "}
        <Link href="/about" className="underline">
          How this works
        </Link>
      </p>
    </section>
  );
}
