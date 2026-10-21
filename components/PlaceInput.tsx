"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface PlaceValue {
  label: string;
  lat: number;
  lon: number;
}

interface Suggestion extends PlaceValue {
  detail: string;
}

const DEBOUNCE_MS = 300;

export default function PlaceInput({
  label,
  value,
  onChange,
  allowMyLocation = false,
  autoFocus = false,
}: {
  label: string;
  value: PlaceValue | null;
  onChange: (v: PlaceValue | null) => void;
  allowMyLocation?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [note, setNote] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const typed = useRef(false);

  // Debounced search (only after the user types, not when a value is picked).
  useEffect(() => {
    if (!typed.current) return;
    const q = text.trim();
    if (q.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.error ?? "Search failed");
          return body as Suggestion[];
        })
        .then((list) => {
          setItems(list);
          setActive(-1);
          setNote(list.length ? null : "No places found in Pune for that.");
        })
        .catch((err) => {
          if (err.name !== "AbortError") setNote(err.message);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  const pick = (p: PlaceValue) => {
    typed.current = false;
    setText(p.label);
    setOpen(false);
    setItems([]);
    setNote(null);
    onChange(p);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setNote("Location isn't available on this device.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick({ label: "My location", lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setNote("Couldn't get your location. Check location permission, or type a place.");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const listId = `${id}-list`;
  const showList = open && items.length > 0;

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-zinc-600">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          inputMode="search"
          autoComplete="off"
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Search a place in Pune"
          value={text}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            setOpen(true);
            if (e.target.value.trim().length < 3) {
              setItems([]);
              setNote(null);
            }
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!showList) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              pick(items[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-zinc-600 focus:ring-2 focus:ring-zinc-200"
        />
        {allowMyLocation && (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="shrink-0 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            aria-label="Use my location"
            title="Use my location"
          >
            {locating ? "…" : "📍"}
          </button>
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 z-30 mt-1 max-h-64 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {items.map((p, i) => (
            <li
              key={`${p.label}-${p.lat}-${p.lon}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
            >
              <div className="text-sm text-zinc-900">{p.label}</div>
              {p.detail && <div className="truncate text-xs text-zinc-500">{p.detail}</div>}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-1 text-xs text-zinc-600">{note}</p>}
    </div>
  );
}
