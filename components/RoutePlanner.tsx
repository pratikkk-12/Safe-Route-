"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlanResponse, PlannedRoute } from "@/lib/routing/plan";
import type { TravelMode } from "@/lib/routing/types";
import { formatDistance, formatDuration } from "@/lib/routing/labels";
import { COMPONENT_LABELS, CONFIDENCE_TEXT } from "@/lib/score-display";
import { COMPONENT_KEYS } from "@/lib/scoring/config";
import PlaceInput, { type PlaceValue } from "./PlaceInput";
import { BAND_COLORS } from "./RouteLayer";

const MODES: { value: TravelMode; label: string }[] = [
  { value: "walk", label: "Walk" },
  { value: "two_wheeler", label: "Two-wheeler / Auto" },
  { value: "car", label: "Car" },
];

const LABEL_STYLE: Record<PlannedRoute["label"], string> = {
  Safest: "bg-emerald-100 text-emerald-900",
  "Safest and fastest": "bg-emerald-100 text-emerald-900",
  Fastest: "bg-sky-100 text-sky-900",
  Balanced: "bg-amber-100 text-amber-900",
  Alternative: "bg-zinc-100 text-zinc-800",
};

/** Today's date in Pune with HH:MM, as ISO with the IST offset (independent of device time zone). */
function istIso(hhmm: string): string {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return `${date}T${hhmm}:00+05:30`;
}

function nowIstHhmm(): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(
    new Date(),
  );
}

function Disclaimer() {
  return (
    <p className="text-xs text-zinc-600">
      Indicator only, not a guarantee of safety. In an emergency, call{" "}
      <a href="tel:112" className="font-semibold underline">
        112
      </a>
      .
    </p>
  );
}

function RouteCard({ route, selected, onSelect }: { route: PlannedRoute; selected: boolean; onSelect: () => void }) {
  const w = route.weakestStretch;
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
        className={`w-full cursor-pointer rounded-xl border p-3 text-left transition ${
          selected ? "border-zinc-800 bg-white shadow-sm" : "border-zinc-200 bg-white/80 hover:border-zinc-400"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${LABEL_STYLE[route.label]}`}>
              {route.label}
            </span>
            <p className="mt-1 text-base font-semibold text-zinc-900">
              {formatDuration(route.duration_s)} <span className="font-normal text-zinc-500">· {formatDistance(route.distance_m)}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums text-zinc-900">
              {route.score}
              <span className="text-xs font-normal text-zinc-500">/100</span>
            </p>
            <p className="text-[11px] text-zinc-600">{CONFIDENCE_TEXT[route.confidence.level]}</p>
          </div>
        </div>

        <p className="mt-2 text-sm text-zinc-800">{route.tradeoff}</p>
        <p className="mt-1 text-xs text-zinc-600">
          {route.limitedDataPercent}% of this route passes through areas with limited data.
        </p>

        <p className="mt-2 text-xs text-zinc-700">
          <span className="font-medium">Weakest stretch:</span> {formatDistance(w.length_m)}
          {w.near ? ` near ${w.near}` : ""} (score {w.score})
          {w.reasons.length > 0 && <>: {w.reasons.map((r) => r.text).join("; ")}</>}
        </p>

        {selected && (
          <details className="mt-2 text-xs text-zinc-700" onClick={(e) => e.stopPropagation()}>
            <summary className="cursor-pointer font-medium text-zinc-800">Why this score</summary>
            <ul className="mt-1.5 space-y-1">
              {COMPONENT_KEYS.map((k) => {
                const v = route.breakdown[k];
                return (
                  <li key={k} className="flex items-center justify-between gap-3" title={COMPONENT_LABELS[k].hint}>
                    <span>{COMPONENT_LABELS[k].label}</span>
                    {v === null ? (
                      <span className="text-zinc-500">no data</span>
                    ) : (
                      <span className="inline-block h-1.5 w-20 rounded bg-zinc-200" aria-label={`${Math.round(v * 100)}%`}>
                        <span className="block h-1.5 rounded bg-zinc-700" style={{ width: `${Math.round(v * 100)}%` }} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-zinc-500">
              Route score = 70% the average along the route + 30% its weakest 200 m, at the hour you reach each part.
              Confidence along the route: {Math.round(route.confidence.shares.high * 100)}% high,{" "}
              {Math.round(route.confidence.shares.medium * 100)}% medium, {Math.round(route.confidence.shares.low * 100)}% low.
            </p>
          </details>
        )}
      </div>
    </li>
  );
}

function Legend() {
  const items: [keyof typeof BAND_COLORS, string][] = [
    ["green", "Busier (70+)"],
    ["amber", "Moderate (40-69)"],
    ["red", "Low activity (<40)"],
    ["limited", "Limited data"],
  ];
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600" aria-label="Route colours">
      {items.map(([band, text]) => (
        <li key={band} className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-4 rounded" style={{ background: BAND_COLORS[band] }} aria-hidden />
          {text}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-4 rounded bg-violet-600/35" aria-hidden />
        Weakest stretch
      </li>
    </ul>
  );
}

export default function RoutePlanner({
  onClose,
  onPlan,
  plan,
  selectedId,
  onSelect,
}: {
  onClose: () => void;
  onPlan: (p: PlanResponse | null) => void;
  plan: PlanResponse | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const [from, setFrom] = useState<PlaceValue | null>(null);
  const [to, setTo] = useState<PlaceValue | null>(null);
  const [mode, setMode] = useState<TravelMode>("walk");
  const [when, setWhen] = useState<"now" | "pick">("now");
  const [time, setTime] = useState(nowIstHhmm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!from || !to) {
      setError("Choose a start and a destination from the suggestions.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: { lat: from.lat, lon: from.lon },
          to: { lat: to.lat, lon: to.lon },
          mode,
          departAt: when === "now" ? "now" : istIso(time),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong. Please try again.");
      onPlan(body as PlanResponse);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "You seem to be offline. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const showResults = plan && !editing;

  return (
    <section
      aria-label="Plan a route"
      className={`absolute inset-x-0 bottom-0 z-20 mx-auto flex max-w-md flex-col rounded-t-2xl bg-white text-zinc-900 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] sm:bottom-9 sm:rounded-2xl ${
        plan && !editing ? "max-h-[50dvh]" : "max-h-[75dvh]"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
        <h2 className="text-base font-semibold">{showResults ? "Routes" : "Plan a route"}</h2>
        <div className="flex gap-2">
          {showResults && (
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg px-2 py-1 text-sm text-zinc-700 underline">
              Edit trip
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onPlan(null);
              onClose();
            }}
            className="rounded-lg px-2 py-1 text-sm text-zinc-700"
            aria-label="Close route planner"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="overflow-y-auto px-4 py-3">
        {!showResults ? (
          <form onSubmit={submit} className="space-y-3">
            <PlaceInput label="From" value={from} onChange={setFrom} allowMyLocation autoFocus />
            <PlaceInput label="To" value={to} onChange={setTo} />
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-zinc-600">Travel mode</legend>
              <div className="grid grid-cols-3 gap-1.5">
                {MODES.map((m) => (
                  <label
                    key={m.value}
                    className={`cursor-pointer rounded-lg border px-2 py-2 text-center text-sm ${
                      mode === m.value ? "border-zinc-800 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-800"
                    }`}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={m.value}
                      checked={mode === m.value}
                      onChange={() => setMode(m.value)}
                      className="sr-only"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-zinc-600">Departure</legend>
              <div className="flex items-center gap-2">
                {(["now", "pick"] as const).map((w) => (
                  <label
                    key={w}
                    className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
                      when === w ? "border-zinc-800 bg-zinc-900 text-white" : "border-zinc-300 text-zinc-800"
                    }`}
                  >
                    <input type="radio" name="when" checked={when === w} onChange={() => setWhen(w)} className="sr-only" />
                    {w === "now" ? "Now" : "Pick time"}
                  </label>
                ))}
                {when === "pick" && (
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    aria-label="Departure time (Pune time)"
                    className="rounded-lg border border-zinc-300 px-2 py-2 text-base"
                    required
                  />
                )}
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-zinc-900 py-3 text-base font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Finding routes…" : "Find routes"}
            </button>
            <Disclaimer />
          </form>
        ) : (
          <div className="space-y-3">
            <ol className="space-y-2">
              {plan.routes.map((r) => (
                <RouteCard key={r.id} route={r} selected={r.id === selectedId} onSelect={() => onSelect(r.id)} />
              ))}
            </ol>
            <Legend />
            <Disclaimer />
            <p className="text-[11px] text-zinc-500">
              {plan.attribution}.{" "}
              <Link href="/about#known-gaps" className="underline">
                Known gaps
              </Link>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
