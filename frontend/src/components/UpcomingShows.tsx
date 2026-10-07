"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEMO_EVENT } from "@/lib/chain";
import { isDemoShow } from "@/lib/events";
import { loadUpcoming } from "@/lib/load-upcoming";
import { formatNaira } from "@/lib/money";
import type { ShowSummary } from "@/lib/upcoming";
import { useShowsMedia } from "@/lib/use-show-media";
import { whenText } from "@/lib/when";
import { Poster } from "./Poster";


function ShowCard({ show, poster, featured, now }: { show: ShowSummary; poster?: string | null; featured?: boolean; now: number }) {
  return (
    <Link
      href={show.address === DEMO_EVENT ? "/e/demo" : `/e/${show.address}`}
      className="group flex h-full flex-col"
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-stage">
        <div className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none">
          <Poster
            src={poster}
            name={show.name}
            sizes={featured ? "(min-width: 1024px) 720px, 100vw" : "(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"}
          />
        </div>
        {isDemoShow(show.address) && (
          <span className="absolute top-3 left-3 rounded-full bg-surface/90 px-2.5 py-1 text-xs font-semibold text-foreground">
            Demo
          </span>
        )}
      </div>
      <div className="flex items-start justify-between gap-4 pt-4">
        <div className="min-w-0">
          <p className={`font-display leading-tight group-hover:text-velvet ${featured ? "text-3xl lg:text-2xl" : "text-2xl"}`}>
            {show.name}
          </p>
          <p className="mt-1 text-sm text-muted">
            {whenText({ doorsOpen: show.doorsOpen, endTime: show.endTime, readAt: now }, true)}
            <span className="block truncate">{show.venue}</span>
          </p>
        </div>
        <p className="shrink-0 pt-1 font-semibold tabular-nums">{formatNaira(show.price)}</p>
      </div>
    </Link>
  );
}

/** Upcoming shows. On the home page, one featured show and two more with a link to /shows; on /shows, every show. */
export function UpcomingShows({ heading = true, limit }: { heading?: boolean; limit?: number }) {
  const [shows, setShows] = useState<ShowSummary[] | null>(null);
  const [now, setNow] = useState(0);
  const media = useShowsMedia(shows?.map((s) => s.address) ?? []);

  useEffect(() => {
    let alive = true;
    const t = Math.floor(Date.now() / 1000);
    loadUpcoming(t)
      .then((s) => {
        if (!alive) return;
        setNow(t);
        setShows(s);
      })
      .catch(() => alive && setShows([]));
    return () => {
      alive = false;
    };
  }, []);

  if (shows !== null && shows.length === 0) {
    return heading ? null : <p className="mt-6 text-muted">New shows appear here as organizers create them.</p>;
  }
  const shown = limit && shows ? shows.slice(0, limit) : shows;
  const featuredLayout = heading;

  return (
    <section aria-labelledby={heading ? "soon-heading" : undefined} aria-label={heading ? undefined : "Upcoming shows"}>
      {heading && (
        <div className="flex items-end justify-between gap-4">
          <h2 id="soon-heading" className="font-display text-4xl leading-none sm:text-5xl">
            Happening soon
          </h2>
          <Link href="/shows" className="shrink-0 text-sm font-semibold text-velvet underline underline-offset-4">
            All shows
          </Link>
        </div>
      )}
      <ul
        className={`grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 ${
          featuredLayout ? "mt-8" : "mt-6"
        }`}
      >
        {(shown ?? [null, null, null]).map((s, i) => {
          const featured = featuredLayout && i === 0;
          return (
            <li key={s?.address ?? i} className={featured ? "sm:col-span-2 lg:col-span-1" : undefined}>
              {s ? (
                <ShowCard show={s} poster={media[s.address]?.poster} featured={featured} now={now} />
              ) : (
                <div className="aspect-[16/10] animate-pulse rounded-2xl bg-line/60" />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
