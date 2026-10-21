import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About · SafeRoute Pune",
  description: "How the Night Activity Score works, its data sources and its limits.",
};

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-2">
      <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
      <div className="space-y-2 text-[15px] leading-relaxed text-zinc-700">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-white">
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <header className="space-y-3">
          <Link href="/" className="text-sm text-zinc-600 underline">
            ← Back to map
          </Link>
          <h1 className="text-2xl font-bold text-zinc-900">About SafeRoute Pune</h1>
          <p className="text-[15px] leading-relaxed text-zinc-700">
            SafeRoute Pune helps you compare routes at night by how busy and well-lit they are likely to be. It
            shows a <strong>Night Activity Score</strong> from 0 to 100 for every small area of Pune and PCMC, for
            each hour of the day.
          </p>
          <p className="rounded-lg bg-zinc-100 p-3 text-[15px] text-zinc-800">
            The score is an indicator only, not a guarantee of safety. In an emergency, call{" "}
            <a href="tel:112" className="font-semibold underline">
              112
            </a>
            .
          </p>
        </header>

        <Section title="How the score works">
          <p>The city is divided into hexagons of about 0.1 sq km. For each hexagon and hour we look at:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Open places</strong>: shops, food, ATMs, hotels and fuel stations open at that hour, nearby.
            </li>
            <li>
              <strong>Street lighting</strong>: where roads are tagged as lit on OpenStreetMap.
            </li>
            <li>
              <strong>Main roads</strong>: the share of busier main roads.
            </li>
            <li>
              <strong>Help nearby</strong>: distance to a police station, a hospital with emergency care, and a fuel
              station open 24 hours.
            </li>
            <li>
              <strong>Transit</strong>: bus stops and stations in service at that hour (a bonus, since bus stop data
              is incomplete).
            </li>
          </ul>
          <p>
            Approved <strong>community reports</strong> from at least two different people can then move the score
            up or down for that time of night.
          </p>
          <p>
            Each score has a <strong>confidence</strong> level (high, medium or low) based on how much mapped data
            sits behind it. Most of Pune is medium or low today.
          </p>
          <p>
            Where there is too little data to say anything, the map shows <strong>Not enough data</strong> (grey
            hatching). That doesn&apos;t mean the area is unsafe, only that it isn&apos;t well mapped yet.
          </p>
        </Section>

        <Section id="known-gaps" title="Known gaps">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>OpenStreetMap data in Pune is incomplete.</strong> Many shops, bus stops and street lights are
              not mapped, and opening hours are often missing. Where hours are missing we use typical hours for that
              kind of place.
            </li>
            <li>
              <strong>Office campuses and night shifts don&apos;t show up as activity.</strong> Areas like Hinjewadi,
              Kharadi and Magarpatta can be busy at night with shift workers and cabs, but offices are not counted
              as open places, so these areas may score lower than they feel.
            </li>
            <li>
              <strong>Community reports are what improve the score over time.</strong> Reporting a spot as well-lit,
              busy, poorly lit or deserted at a given hour fills in what the map can&apos;t see.
            </li>
            <li>
              Scores change slowly: they are recomputed once a night, not live. Events, festivals, power cuts and
              road works are not reflected.
            </li>
          </ul>
        </Section>

        <Section title="Privacy">
          <p>
            There are no accounts. We don&apos;t store your searches, start or destination, or your location.
            Reports are anonymous and stored only as the hexagon they fall in, never your exact position.
          </p>
        </Section>

        <Section title="Data sources">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Map data ©{" "}
              <a className="underline" href="https://www.openstreetmap.org/copyright">
                OpenStreetMap contributors
              </a>
              , available under the Open Database License (ODbL).
            </li>
            <li>
              Map tiles by{" "}
              <a className="underline" href="https://openfreemap.org">
                OpenFreeMap
              </a>{" "}
              / OpenMapTiles.
            </li>
            <li>Hexagon grid: H3 by Uber (resolution 9).</li>
            <li>
              Source code:{" "}
              <a className="underline" href="https://github.com/pratikkk-12/Safe-Route-">
                github.com/pratikkk-12/Safe-Route-
              </a>
            </li>
          </ul>
        </Section>

        <p className="border-t border-zinc-200 pt-4 text-sm text-zinc-600">
          In an emergency, call{" "}
          <a href="tel:112" className="font-semibold underline">
            112
          </a>
          .
        </p>
      </div>
    </main>
  );
}
