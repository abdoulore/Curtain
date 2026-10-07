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
import { whenText } from "@/lib/when";
import { BuyPanel } from "./BuyPanel";
import { Poster } from "./Poster";

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

const PROTECTION = [
  "You pay, and the money is held for this show. Nobody can move it early, not even Curtain.",
  "At the gate you scan the code and confirm with your fingerprint or Face ID. That moment, your ticket's money is paid to the organizer.",
  "After the show, if at least half the tickets sold were checked in, the show counts as happened and the rest is paid to the organizer.",
  "If fewer than half were checked in, or the organizer cancels, every ticket that wasn't checked in is refunded automatically. Nobody has to approve it.",
  "Resale is capped at face value, and a resold ticket only opens the door for its new holder.",
];

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-go" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" aria-hidden>
      <path d="M10 2.5l6 2.5v4.5c0 3.6-2.6 6.2-6 7.5-3.4-1.3-6-3.9-6-7.5V5z" />
      <path d="M7.2 10l2 2 3.6-4" strokeLinecap="round" />
    </svg>
  );
}

/** Scrolls to the checkout and puts focus on its first field or button. */
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

  // The phone's buy bar steps aside while the checkout itself is on screen.
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
  const venue = meta.city ? `${meta.venue}, ${meta.city}` : meta.venue;

  return (
    <main className="flex flex-col pt-6 pb-24 lg:grid lg:grid-cols-[1.35fr_1fr] lg:items-start lg:gap-x-14 lg:pt-10 lg:pb-0">
      <section className="lg:col-start-1 lg:row-start-1">
        <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-stage">
          <Poster src={media?.poster} name={meta.name} sizes="(min-width: 1024px) 680px, 100vw" priority />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {meta.isDemo && (
            <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-semibold text-background">Demo</span>
          )}
          <span className="font-medium">{info ? whenText(info) : "…"}</span>
        </div>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] text-balance lg:text-6xl">{meta.name}</h1>
        <p className="mt-2 text-lg text-muted">{venue}</p>
        <p className="mt-6 max-w-[62ch] whitespace-pre-line">{media?.description || meta.tagline}</p>
      </section>

      <section
        id="checkout"
        ref={cardRef}
        aria-label="Get a ticket"
        className="mt-8 scroll-mt-6 rounded-2xl bg-surface p-5 ring-1 ring-line lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:p-7"
      >
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{info ? formatNaira(info.price) : "…"}</p>
          {info && sale && (
            <p className="text-right text-sm text-muted">
              {sale.kind === "open" ? (
                `${sale.left} left`
              ) : (
                <span className="font-semibold text-foreground">{sale.kind === "soldOut" ? "Sold out" : "Closed"}</span>
              )}
              {info.maxPerBuyer > 0 && <span className="block">Up to {info.maxPerBuyer} per person</span>}
            </p>
          )}
        </div>
        <div className="mt-6">
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
              note={
                <p className="mt-3 flex items-center justify-center gap-2 text-sm font-medium">
                  <ShieldIcon />
                  Protected if the show doesn&apos;t happen
                </p>
              }
            />
          )}
          {info && buyingResale && cheapest && (
            <>
              <p className="mb-3 text-sm text-muted">
                Ticket #{cheapest.ticketId.toString()} on resale. You pay the seller; the ticket and its refund move to you.
              </p>
              <BuyPanel
                meta={meta}
                info={info}
                listing={cheapest}
                onBought={() => setVersion((v) => v + 1)}
                onCheckoutChange={onCheckoutChange}
              />
              <button onClick={() => setBuyingResale(false)} className="mt-3 w-full text-sm text-muted underline">
                Back to new tickets
              </button>
            </>
          )}
        </div>
      </section>

      {info && cheapest && !buyingResale && (
        <p className="mt-3 text-center text-sm text-muted lg:col-start-2 lg:row-start-3">
          {listings.length === 1 ? "1 resale ticket" : `${listings.length} resale tickets`} at {formatNaira(cheapest.price)}.{" "}
          <button onClick={() => setBuyingResale(true)} className="font-medium text-foreground underline underline-offset-4">
            Buy resale
          </button>
        </p>
      )}

      <details id="protection" className="group mt-10 scroll-mt-6 border-t border-line pt-6 lg:col-start-1 lg:row-start-2 lg:mt-12">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
          How your payment is protected
          <svg
            viewBox="0 0 20 20"
            className="h-5 w-5 shrink-0 text-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M5 8l5 5 5-5" />
          </svg>
        </summary>
        <div className="mt-4 max-w-[62ch]">
          <p className="text-muted">{BUYER_PROMISE}</p>
          <ol className="mt-4 list-decimal space-y-2 pl-5">
            {PROTECTION.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <Link href={`/board/${meta.slug}`} className="mt-4 inline-block font-medium text-velvet underline underline-offset-4">
            See where this show&apos;s money is, live
          </Link>
        </div>
      </details>

      {showBar && info && sale && (
        <div
          role="region"
          aria-label="Ticket price"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-lg leading-tight font-semibold tabular-nums">{formatNaira(info.price)}</p>
              <p className="truncate text-xs text-muted">
                {sale.kind === "open" ? "Protected if the show doesn't happen" : sale.label}
              </p>
            </div>
            {sale.kind === "open" ? (
              <button onClick={goToCheckout} className="shrink-0 rounded-2xl bg-velvet px-6 py-3 text-base font-semibold text-velvet-ink">
                Get ticket
              </button>
            ) : sale.kind === "soldOut" && cheapest ? (
              <button
                onClick={() => {
                  setBuyingResale(true);
                  goToCheckout();
                }}
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
