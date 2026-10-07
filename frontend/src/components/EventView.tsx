"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { BUYER_PROMISE } from "@/lib/copy";
import type { EventMeta } from "@/lib/events";
import { useAccount } from "@/lib/hooks";
import { fetchListings } from "@/lib/indexer";
import { formatNaira } from "@/lib/money";
import { readEventInfo, readTicket, type EventInfo, type TicketState } from "@/lib/reads";
import { listingsFor, type Listing } from "@/lib/resale";
import { saleState } from "@/lib/sale-state";
import { useShowMedia } from "@/lib/use-show-media";
import { BuyPanel } from "./BuyPanel";
import { Poster } from "./Poster";

const dateFmt = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short" });

function whenText(info: EventInfo): string {
  const until = dateFmt.format(new Date(info.endTime * 1000));
  if (info.readAt >= info.doorsOpen) return `Doors open now, until ${until}`;
  return `Doors open ${dateFmt.format(new Date(info.doorsOpen * 1000))}`;
}

type RawListing = { ticketId: bigint; state: TicketState; resalePrice: bigint; holder: Address };

/** Tickets on resale: from the indexer, or read from the escrow when the indexer has nothing and the show is small. */
async function loadResale(event: Address, sold: number): Promise<RawListing[]> {
  const indexed = await fetchListings(event).catch(() => []);
  if (indexed.length > 0) {
    return indexed.map((t) => ({
      ticketId: BigInt(t.ticketId),
      state: t.state as TicketState,
      resalePrice: BigInt(t.resalePrice),
      holder: t.holder as Address,
    }));
  }
  if (sold === 0 || sold > 60) return [];
  const ids = Array.from({ length: sold }, (_, i) => BigInt(i + 1));
  const infos = await Promise.all(ids.map((id) => readTicket(event, id).catch(() => null)));
  return infos.flatMap((t, i) => (t ? [{ ticketId: ids[i]!, state: t.state, resalePrice: t.resalePrice, holder: t.holder }] : []));
}

const PROTECTION_STEPS = [
  "You pay, and the money is held for this show. Nobody can move it early, not even Curtain.",
  "At the gate you scan the code and confirm with your fingerprint or Face ID. That moment, your ticket's money is paid to the organizer.",
  "If the show is cancelled or doesn't happen, every ticket that wasn't checked in is refunded automatically. Nobody has to approve it.",
  "Resale is capped at face value, so a ticket never costs more than its price.",
];

function Tick() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="mt-0.5 h-4 w-4 shrink-0 text-go"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

/** Scrolls to the checkout card and puts focus on its first field or button. */
function goToCheckout() {
  const card = document.getElementById("checkout");
  if (!card) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  card.querySelector<HTMLElement>("input, button:not([disabled])")?.focus({ preventScroll: true });
}

export function EventView({ meta }: { meta: EventMeta }) {
  const account = useAccount();
  const media = useShowMedia(meta.address);
  const [raw, setRaw] = useState<RawListing[]>([]);
  const [buyingResale, setBuyingResale] = useState(false);
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const onCheckoutChange = useCallback((active: boolean) => setCheckingOut(active), []);

  useEffect(() => {
    let alive = true;
    readEventInfo(meta.address)
      .then((next) => alive && setInfo(next))
      .catch(() => alive && setLoadError("We couldn't load this show. The network may be slow; refresh the page to try again."));
    return () => {
      alive = false;
    };
  }, [meta.address, version]);

  useEffect(() => {
    if (!info || info.status !== "Open") return;
    let alive = true;
    loadResale(meta.address, info.sold).then((r) => alive && setRaw(r));
    return () => {
      alive = false;
    };
  }, [meta.address, info]);

  // The sticky bar steps aside while the checkout card itself is on screen.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCardVisible(entry!.isIntersecting), { threshold: 0.25 });
    io.observe(card);
    return () => io.disconnect();
  }, []);

  const sale = info ? saleState(info) : null;
  const listings: Listing[] = listingsFor(raw, account?.address);
  const cheapest = listings[0];
  const showBar = sale !== null && !checkingOut && !cardVisible;

  return (
    <main className="pt-6 pb-24 lg:grid lg:grid-cols-[1.2fr_1fr] lg:items-start lg:gap-x-12 lg:pt-12 lg:pb-0">
      <section className="lg:col-start-1 lg:row-start-1">
        <div className="relative mb-5 aspect-[16/10] overflow-hidden rounded-3xl border border-line">
          <Poster src={media?.poster} name={meta.name} sizes="(min-width: 1024px) 600px, 100vw" priority />
        </div>
        {meta.isDemo && (
          <span className="inline-block rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted">
            Demo show
          </span>
        )}
        <h1 className="mt-3 text-3xl font-semibold tracking-tight lg:text-5xl">{meta.name}</h1>
        <p className="mt-3 whitespace-pre-line text-muted lg:text-lg">{media?.description || meta.tagline}</p>
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
      </section>

      <section
        id="checkout"
        ref={cardRef}
        aria-label="Get a ticket"
        className="mt-6 scroll-mt-6 rounded-3xl border border-line bg-surface p-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:p-6"
      >
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-3xl font-semibold">{info ? formatNaira(info.price) : "…"}</p>
          {info && sale && (
            <p className="text-right text-sm text-muted">
              {sale.kind === "open" ? (
                `${sale.left} of ${info.capacity} left`
              ) : (
                <span className="font-semibold text-foreground">{sale.kind === "soldOut" ? "Sold out" : "Closed"}</span>
              )}
              {info.maxPerBuyer > 0 && <span className="block">Up to {info.maxPerBuyer} per person</span>}
            </p>
          )}
        </div>
        <p className="mt-4 rounded-xl bg-background px-3 py-2 text-sm font-medium">Held until the show happens</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li className="flex gap-2">
            <Tick />
            Ticket secured by your fingerprint or Face ID
          </li>
          <li className="flex gap-2">
            <Tick />
            Automatic refund if the show doesn&apos;t happen
          </li>
        </ul>
        <div className="mt-5">
          {loadError && (
            <p role="alert" className="text-sm text-stop">
              {loadError}
            </p>
          )}
          {info && !buyingResale && (
            <BuyPanel
              meta={meta}
              info={info}
              onBought={() => setVersion((v) => v + 1)}
              onCheckoutChange={onCheckoutChange}
            />
          )}
        </div>
        <a href="#protection" className="mt-4 inline-block text-sm font-medium text-velvet underline underline-offset-2">
          How your payment is protected
        </a>
        {info && cheapest && (
          <div className="mt-5 rounded-2xl border border-line p-4">
            <p className="font-medium">
              {listings.length} resale ticket{listings.length === 1 ? "" : "s"} at {formatNaira(cheapest.price)}
            </p>
            <p className="mt-1 text-sm text-muted">
              Resold at face value or less. You pay the seller; the ticket and its refund move to you, and only your
              fingerprint or Face ID opens the door with it.
            </p>
            {buyingResale ? (
              <div className="mt-4">
                <BuyPanel
                  meta={meta}
                  info={info}
                  listing={cheapest}
                  onBought={() => setVersion((v) => v + 1)}
                  onCheckoutChange={onCheckoutChange}
                />
                <button onClick={() => setBuyingResale(false)} className="mt-3 text-sm text-muted underline">
                  Back to new tickets
                </button>
              </div>
            ) : (
              <button
                onClick={() => setBuyingResale(true)}
                className="mt-3 w-full rounded-xl border border-velvet px-4 py-2.5 text-sm font-semibold text-velvet"
              >
                Buy a resale ticket
              </button>
            )}
          </div>
        )}
      </section>

      <section
        id="protection"
        aria-labelledby="protection-heading"
        className="mt-8 scroll-mt-6 rounded-3xl border border-line p-5 lg:col-start-1 lg:row-start-2 lg:p-6"
      >
        <h2 id="protection-heading" className="text-lg font-semibold">
          How your payment is protected
        </h2>
        <p className="mt-2 text-sm text-muted">{BUYER_PROMISE}</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
          {PROTECTION_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <Link
          href={`/board/${meta.slug}`}
          className="mt-4 inline-block text-sm font-medium text-velvet underline underline-offset-2"
        >
          See where this show&apos;s money is, live
        </Link>
      </section>

      {showBar && info && sale && (
        <div
          role="region"
          aria-label="Ticket price"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-lg leading-tight font-semibold">{formatNaira(info.price)}</p>
              <p className="truncate text-xs text-muted">
                {sale.kind === "open" ? `${sale.left} tickets left` : sale.label}
              </p>
            </div>
            {sale.kind === "open" ? (
              <button
                onClick={goToCheckout}
                className="shrink-0 rounded-2xl bg-velvet px-6 py-3 text-base font-semibold text-velvet-ink"
              >
                Get ticket
              </button>
            ) : sale.kind === "soldOut" && cheapest ? (
              <button
                onClick={goToCheckout}
                className="shrink-0 rounded-2xl border border-velvet px-4 py-3 text-sm font-semibold text-velvet"
              >
                Resale from {formatNaira(cheapest.price)}
              </button>
            ) : (
              <span className="shrink-0 rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-muted">
                {sale.kind === "soldOut" ? "Sold out" : "Closed"}
              </span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
