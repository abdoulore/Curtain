"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEMO_EVENT } from "@/lib/chain";
import { loadUpcoming } from "@/lib/load-upcoming";
import { formatNaira } from "@/lib/money";
import type { ShowSummary } from "@/lib/upcoming";
import { useShowsMedia } from "@/lib/use-show-media";
import { Poster } from "./Poster";

const when = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Upcoming show cards. On the home page a short list with a link to /shows; on /shows, every show. */
export function UpcomingShows({ heading = true, limit }: { heading?: boolean; limit?: number }) {
  const [shows, setShows] = useState<ShowSummary[] | null>(null);
  const media = useShowsMedia(shows?.map((s) => s.address) ?? []);

  useEffect(() => {
    let alive = true;
    loadUpcoming(Math.floor(Date.now() / 1000))
      .then((s) => alive && setShows(s))
      .catch(() => alive && setShows([]));
    return () => {
      alive = false;
    };
  }, []);

  if (shows !== null && shows.length === 0) {
    return heading ? null : <p className="mt-6 text-muted">New shows appear here as organizers create them.</p>;
  }
  const shown = limit && shows ? shows.slice(0, limit) : shows;

  return (
    <section className={heading ? "mt-14 lg:mt-20" : "mt-6"} aria-label="Upcoming shows">
      {heading && (
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold lg:text-2xl">Upcoming shows</h2>
          <Link href="/shows" className="text-sm font-semibold text-velvet underline underline-offset-2">
            All shows
          </Link>
        </div>
      )}
      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(shown ?? [null, null, null]).map((s, i) =>
          s ? (
            <li key={s.address}>
              <Link
                href={s.address === DEMO_EVENT ? "/e/demo" : `/e/${s.address}`}
                className="group block overflow-hidden rounded-3xl border border-line bg-surface transition hover:border-velvet/50"
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  <Poster src={media[s.address]?.poster} name={s.name || "Curtain show"} sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" />
                </div>
                <div className="p-4">
                  <p className="text-lg font-semibold group-hover:text-velvet">{s.name || "Curtain show"}</p>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {when.format(new Date(s.doorsOpen * 1000))}
                    {s.venue ? ` · ${s.venue}` : ""}
                  </p>
                  <div className="mt-3 flex items-baseline justify-between">
                    <span className="font-semibold">{formatNaira(s.price)}</span>
                    <span className="text-sm text-muted">{s.capacity - s.sold} tickets left</span>
                  </div>
                </div>
              </Link>
            </li>
          ) : (
            <li key={i} className="h-72 animate-pulse rounded-3xl border border-line bg-surface" />
          ),
        )}
      </ul>
    </section>
  );
}
