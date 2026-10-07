"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAddress, type Address } from "viem";
import { STATUS_TEXT } from "@/lib/board";
import { useAccount, useHydrated } from "@/lib/hooks";
import { fetchShowsOf } from "@/lib/indexer";
import { formatNaira } from "@/lib/money";
import { sortShowCards, toShowCard, type ShowCard } from "@/lib/my-shows";
import { createdShows } from "@/lib/organizer-local";
import { useShowsMedia } from "@/lib/use-show-media";
import { whenText } from "@/lib/when";
import { Poster } from "./Poster";
import { SignInButton } from "./SignInButton";

/** A show this device created that the indexer hasn't picked up yet. */
type Pending = { event: string; name: string };

const nowSeconds = () => Math.floor(Date.now() / 1000);

function ShowRow({ card, poster, now }: { card: ShowCard; poster?: string | null; now: number }) {
  const name = card.name || "Untitled show";
  return (
    <li className="flex gap-4 py-6 sm:items-center sm:gap-5">
      <div className={`relative aspect-[16/10] w-24 shrink-0 self-start overflow-hidden rounded-xl bg-stage sm:w-40 sm:self-center ${card.live ? "" : "grayscale-[60%]"}`}>
        <Poster src={poster} name={name} sizes="(min-width: 640px) 160px, 96px" />
      </div>
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl leading-tight sm:text-2xl">{name}</p>
          <p className="mt-1 text-sm text-muted">
            {card.live ? whenText({ doorsOpen: card.doorsOpen, endTime: card.endTime, readAt: now }, true) : (STATUS_TEXT[card.status] ?? "Finished")}
            <span className="block truncate sm:inline">{card.venue ? <span className="hidden sm:inline"> · </span> : null}{card.venue}</span>
          </p>
          <p className="mt-2 text-sm">
            <span className="font-semibold tabular-nums">{card.sold}</span> sold ·{" "}
            <span className="font-semibold tabular-nums">{card.checkedIn}</span> checked in ·{" "}
            <span className="font-semibold tabular-nums">{formatNaira(card.ready)}</span> ready
          </p>
        </div>
        <div className="mt-4 flex shrink-0 items-center gap-4 sm:mt-0">
          <Link
            href={`/organizer/${card.event}`}
            className={`rounded-2xl px-5 py-3 text-sm font-semibold ${card.live ? "bg-velvet text-velvet-ink" : "ring-1 ring-line hover:bg-surface"}`}
          >
            Manage show
          </Link>
          <Link href={`/e/${card.event}`} className="text-sm font-medium text-muted underline underline-offset-4 hover:text-foreground">
            Ticket page
          </Link>
        </div>
      </div>
    </li>
  );
}

export function MyShowsView() {
  const hydrated = useHydrated();
  const account = useAccount();
  const [cards, setCards] = useState<ShowCard[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [now, setNow] = useState(0);
  const media = useShowsMedia((cards ?? []).map((c) => c.event as Address));

  useEffect(() => {
    if (!account) return;
    let alive = true;
    const local = createdShows(account.address).map((s) => ({ event: s.event, name: s.name }));
    fetchShowsOf(account.address)
      .catch(() => [])
      .then((rows) => {
        if (!alive) return;
        const t = nowSeconds();
        const indexed = sortShowCards(rows.map((r) => toShowCard(r, t)));
        const seen = new Set(indexed.map((c) => c.event.toLowerCase()));
        setNow(t);
        setCards(indexed);
        setPending(local.filter((p) => !seen.has(p.event.toLowerCase())));
      });
    return () => {
      alive = false;
    };
  }, [account]);

  if (!hydrated) return null;

  return (
    <main className="pt-6 lg:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl leading-none sm:text-5xl">Your shows</h1>
        <Link href="/organizer/new" className="rounded-2xl bg-velvet px-5 py-3 text-sm font-semibold text-velvet-ink">
          Create a show
        </Link>
      </div>

      {!account ? (
        <div className="mt-10 max-w-md border-t border-line pt-8">
          <p className="font-semibold">Sign in with the passkey you organize with</p>
          <p className="mt-1 text-sm text-muted">Your shows, money and gates are all here.</p>
          <div className="mt-4">
            <SignInButton />
          </div>
        </div>
      ) : cards === null ? (
        <div className="mt-8 space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-line/60" />
          ))}
        </div>
      ) : cards.length === 0 && pending.length === 0 ? (
        <div className="mt-10 max-w-md border-t border-line pt-8">
          <p className="font-display text-2xl">No shows yet</p>
          <p className="mt-2 text-sm text-muted">
            Create one and you land on its dashboard, with its ticket page, money and gates in one place.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {pending.map((p) => (
            <li key={p.event} className="flex flex-wrap items-center justify-between gap-4 py-6">
              <div>
                <p className="font-display text-2xl leading-tight">{p.name}</p>
                <p className="mt-1 text-sm text-muted">Just created. Totals appear in a moment.</p>
              </div>
              <Link href={`/organizer/${getAddress(p.event)}`} className="rounded-2xl bg-velvet px-5 py-3 text-sm font-semibold text-velvet-ink">
                Manage show
              </Link>
            </li>
          ))}
          {cards.map((c) => (
            <ShowRow key={c.event} card={c} poster={media[getAddress(c.event)]?.poster} now={now} />
          ))}
        </ul>
      )}
    </main>
  );
}
