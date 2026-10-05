"use client";

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
    <main className="pt-6">
      {meta.isDemo && (
        <span className="inline-block rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted">
          Demo show, test money only
        </span>
      )}
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{meta.name}</h1>
      <p className="mt-2 text-muted">{meta.tagline}</p>
      <p className="mt-4 text-sm font-medium">
        {meta.venue}
        {meta.city && <span className="text-muted">, {meta.city}</span>}
      </p>
      {info && <p className="mt-1 text-sm text-muted">{whenText(info)}</p>}

      <section className="mt-6 rounded-3xl border border-line bg-surface p-5">
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
        <div className="mt-5">
          {loadError && <p className="text-sm text-stop">{loadError}</p>}
          {info && <BuyPanel meta={meta} info={info} onBought={() => setVersion((v) => v + 1)} />}
        </div>
      </section>
    </main>
  );
}
