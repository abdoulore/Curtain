"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventMeta } from "@/lib/events";
import { formatNaira } from "@/lib/money";
import { readEventInfo, type EventInfo } from "@/lib/reads";
import { BuyPanel } from "./BuyPanel";

const dateFmt = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short" });

function whenText(info: EventInfo): string {
  const until = dateFmt.format(new Date(info.endTime * 1000));
  if (info.readAt >= info.doorsOpen) return `Doors open now, until ${until}`;
  return `Doors open ${dateFmt.format(new Date(info.doorsOpen * 1000))}`;
}

export function EventView({ meta }: { meta: EventMeta }) {
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    readEventInfo(meta.address)
      .then((next) => alive && setInfo(next))
      .catch(() => alive && setLoadError("We couldn't load this show. Pull to refresh."));
    return () => {
      alive = false;
    };
  }, [meta.address, version]);

  const left = info ? info.capacity - info.sold : null;

  return (
    <main className="pt-6 lg:grid lg:grid-cols-[1.2fr_1fr] lg:items-start lg:gap-12 lg:pt-12">
      <section>
        {meta.isDemo && (
          <span className="inline-block rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted">
            Demo show, test money only
          </span>
        )}
        <h1 className="mt-3 text-3xl font-semibold tracking-tight lg:text-5xl">{meta.name}</h1>
        <p className="mt-3 text-muted lg:text-lg">{meta.tagline}</p>
        <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Where</dt>
            <dd className="mt-1 font-medium">
              {meta.venue}
              {meta.city && <span className="block text-muted">{meta.city}</span>}
            </dd>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">When</dt>
            <dd className="mt-1 font-medium">{info ? whenText(info) : "…"}</dd>
          </div>
        </dl>
        <div className="mt-6 hidden rounded-2xl border border-line p-5 text-sm lg:block">
          <p className="font-semibold">How pay-on-entry works</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted">
            <li>You pay, and the money waits in this show&apos;s safe. Nobody can take it out.</li>
            <li>At the door you scan the gate code and confirm with your fingerprint or Face ID.</li>
            <li>That moment, your ticket&apos;s money goes to the organizer. If the show doesn&apos;t happen, it comes back to you.</li>
          </ol>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-5 lg:sticky lg:top-6 lg:mt-0 lg:p-6">
        <div className="flex items-baseline justify-between">
          <p className="text-3xl font-semibold">{info ? formatNaira(info.price) : "…"}</p>
          {left !== null && (
            <p className="text-sm text-muted">{left > 0 ? `${left} of ${info!.capacity} left` : "Sold out"}</p>
          )}
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          <li>Your money waits safely until you walk in.</li>
          <li>The organizer is paid the moment your ticket is scanned.</li>
          <li>Show cancelled? Your money comes back automatically.</li>
        </ul>
        <Link
          href={`/board/${meta.slug}`}
          className="mt-3 inline-block text-sm font-medium text-velvet underline underline-offset-2"
        >
          See where the money is, live
        </Link>
        <div className="mt-5">
          {loadError && <p className="text-sm text-stop">{loadError}</p>}
          {info && <BuyPanel meta={meta} info={info} onBought={() => setVersion((v) => v + 1)} />}
        </div>
      </section>
    </main>
  );
}
