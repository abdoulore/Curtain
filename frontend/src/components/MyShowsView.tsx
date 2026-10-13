"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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

type View = "open" | "closed";
const VIEWS: { id: View; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];

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
  const [view, setView] = useState<View>("open");
  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({ open: null, closed: null });
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

  // Shows just created count as open until the indexer has them.
  const open = (cards ?? []).filter((c) => c.live);
  const closed = (cards ?? []).filter((c) => !c.live);
  const counts: Record<View, number> = { open: open.length + pending.length, closed: closed.length };
  const shown = view === "open" ? open : closed;

  function onTabKey(e: React.KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next: View = e.key === "Home" ? "open" : e.key === "End" ? "closed" : view === "open" ? "closed" : "open";
    setView(next);
    tabRefs.current[next]?.focus();
  }

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
        <>
          <div role="tablist" aria-label="Your shows" className="mt-8 flex gap-1 border-b border-line">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                ref={(el) => {
                  tabRefs.current[v.id] = el;
                }}
                role="tab"
                id={`tab-${v.id}`}
                aria-selected={view === v.id}
                aria-controls="panel-shows"
                tabIndex={view === v.id ? 0 : -1}
                onClick={() => setView(v.id)}
                onKeyDown={onTabKey}
                className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold ${
                  view === v.id ? "border-velvet text-foreground" : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                {v.label}
                <span className="ml-1.5 text-muted tabular-nums">{counts[v.id]}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" id="panel-shows" aria-labelledby={`tab-${view}`}>
            {counts[view] === 0 ? (
              <p className="py-10 text-sm text-muted">
                {view === "open" ? "No shows on sale right now." : "Cancelled and finished shows land here."}
              </p>
            ) : (
              <ul className="divide-y divide-line border-b border-line">
                {view === "open" && pending.map((p) => (
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
                {shown.map((c) => (
                  <ShowRow key={c.event} card={c} poster={media[getAddress(c.event)]?.poster} now={now} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  );
}
