"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { signOut, unlock, type StoredAccount } from "@/lib/account";
import { txUrl } from "@/lib/chain";
import { plainError } from "@/lib/errors";
import { findEvent } from "@/lib/events";
import { useAccount, useHydrated } from "@/lib/hooks";
import { formatNaira } from "@/lib/money";
import { browserClient, readBalance, readEventInfo, readTicket, type EventInfo, type TicketInfo } from "@/lib/reads";
import { cardStatus, listTicket, rememberListed, wasListedHere, type CardStatus } from "@/lib/resale";
import { readShowDetails, useShowMeta } from "@/lib/show-details";
import { ticketBadge, type BadgeIcon, type TicketBadge } from "@/lib/ticket-badge";
import { mainAction, sortTickets, ticketGroup } from "@/lib/ticket-groups";
import type { SavedTicket } from "@/lib/tickets";
import { useMyTickets } from "@/lib/use-my-tickets";
import { useShowMedia } from "@/lib/use-show-media";
import { whenText } from "@/lib/when";
import { AddToCalendar } from "./AddToCalendar";
import { Poster } from "./Poster";
import { SendToPhone } from "./SendToPhone";
import { SignInButton } from "./SignInButton";

/** Several tickets often share a show; read its details once per page load. */
const showInfo = new Map<string, Promise<EventInfo>>();
function readShowOnce(event: SavedTicket["event"]): Promise<EventInfo> {
  const key = event.toLowerCase();
  let hit = showInfo.get(key);
  if (!hit) {
    hit = readEventInfo(event).catch((e) => {
      showInfo.delete(key);
      throw e;
    });
    showInfo.set(key, hit);
  }
  return hit;
}

/** Whether a show has a real name and venue; tickets for unnamed shows stay off the list. */
async function isNamed(event: SavedTicket["event"]): Promise<boolean> {
  const known = findEvent(event);
  if (known && known.name !== "Curtain event") return true;
  const d = await readShowDetails(event);
  return Boolean(d?.name.trim() && d.venue.trim());
}

type Loaded = { info: TicketInfo | null; show: EventInfo | null; named: boolean };
const keyOf = (t: SavedTicket) => `${t.event.toLowerCase()}-${t.ticketId}`;

const ICON_PATHS: Record<BadgeIcon, ReactNode> = {
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  tag: (
    <>
      <path d="M3 10V4a1 1 0 0 1 1-1h6l7 7-7 7z" />
      <circle cx="7" cy="7" r="1.2" />
    </>
  ),
  door: (
    <>
      <path d="M5 17V3h10v14M3 17h14" />
      <path d="M12 10h.01" />
    </>
  ),
  return: <path d="M7 5L3 9l4 4M3 9h9a5 5 0 0 1 0 10h-2" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </>
  ),
  arrow: <path d="M4 10h12M11 5l5 5-5 5" />,
};

function Icon({ name, className = "h-4 w-4" }: { name: BadgeIcon | "calendar" | "send"; className?: string }) {
  const path =
    name === "calendar" ? (
      <>
        <rect x="3" y="4" width="14" height="13" rx="2" />
        <path d="M3 8h14M7 2v4M13 2v4" />
      </>
    ) : name === "send" ? (
      <path d="M3 10l14-7-5 14-2.5-5.5z" />
    ) : (
      ICON_PATHS[name]
    );
  return (
    <svg viewBox="0 0 20 20" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}

const BADGE_TONE: Record<TicketBadge["tone"], string> = {
  go: "bg-go/12 text-go ring-go/30",
  velvet: "bg-velvet/10 text-velvet ring-velvet/30",
  neutral: "bg-foreground/8 text-foreground ring-foreground/20",
  muted: "bg-foreground/5 text-muted ring-line",
};

function Badge({ badge }: { badge: TicketBadge }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${BADGE_TONE[badge.tone]}`}>
      <Icon name={badge.icon} className="h-3.5 w-3.5" />
      {badge.label}
    </span>
  );
}

/** The dashed tear line, with a notch cut into each edge of the ticket. */
function Perforation() {
  return (
    <div className="relative mx-5 border-t-2 border-dashed border-line" aria-hidden>
      <span className="absolute -top-3 -left-8 h-6 w-6 rounded-full border border-line bg-background [clip-path:inset(0_0_0_50%)]" />
      <span className="absolute -top-3 -right-8 h-6 w-6 rounded-full border border-line bg-background [clip-path:inset(0_50%_0_0)]" />
    </div>
  );
}

const SECONDARY = "inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-sm font-semibold hover:bg-background disabled:opacity-50";

function TicketCard({
  ticket,
  account,
  info,
  show,
  status,
  past,
  onChanged,
}: {
  ticket: SavedTicket;
  account: StoredAccount;
  info: TicketInfo | null;
  show: EventInfo | null;
  status: CardStatus;
  past: boolean;
  onChanged: () => void;
}) {
  const meta = useShowMeta(ticket.event);
  const media = useShowMedia(ticket.event);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const price = show ? formatNaira(show.price) : "…";
  const badge = ticketBadge(status, status === "listed" && info ? formatNaira(info.resalePrice) : price);
  const action = mainAction(status);
  const name = meta?.name ?? "Curtain show";
  const panelId = `ticket-${keyOf(ticket)}`;
  const canSell = !past && (status === "ready" || status === "listed");

  async function setOnSale(onSale: boolean) {
    if (!show) return;
    if (onSale && !confirm(`Put ticket #${ticket.ticketId} on sale at face value, ${price}? The buyer pays you directly.`)) return;
    setBusy(true);
    setError(null);
    try {
      // The passkey prompt opens straight from the tap, before any network call.
      const { signer } = await unlock(account);
      await listTicket(browserClient, ticket.event, BigInt(ticket.ticketId), onSale ? show.price : 0n, signer);
      if (onSale) rememberListed(ticket.event, ticket.ticketId);
      onChanged();
    } catch (e) {
      setError(plainError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="overflow-hidden rounded-3xl bg-surface ring-1 ring-line" aria-label={`${name}, ticket ${ticket.ticketId}`}>
      <div className="flex gap-4 p-4">
        <div className={`relative h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-stage ${past ? "grayscale-[60%]" : ""}`}>
          <Poster src={media?.poster} name={name} sizes="112px" />
        </div>
        <div className="min-w-0 flex-1">
          <Badge badge={badge} />
          <p className="mt-2 truncate font-display text-xl leading-tight">{name}</p>
          <p className="mt-0.5 text-sm text-muted">
            {show ? whenText(show, true) : "…"}
            {meta?.venue ? <span className="block truncate">{meta.venue}</span> : null}
          </p>
        </div>
      </div>

      <Perforation />

      <div className="flex items-end justify-between gap-4 px-5 pt-4">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Ticket</p>
          <p className="font-mono text-4xl leading-none font-semibold text-velvet">#{ticket.ticketId}</p>
        </div>
        <p className="font-semibold tabular-nums">{price}</p>
      </div>

      <div className="px-5 pt-4 pb-5">
        {action && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-semibold ${
              status === "ready" && !past && !open ? "bg-velvet text-velvet-ink" : "ring-1 ring-line hover:bg-background"
            }`}
          >
            {open ? "Close" : action}
            <svg
              viewBox="0 0 20 20"
              className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
          </button>
        )}

        {open && (
          <div id={panelId} className="mt-4 space-y-4">
            {badge.detail && <p className="text-sm text-muted">{badge.detail}</p>}
            {canSell && (
              <div className="flex flex-wrap gap-2">
                {status === "ready" && show && (
                  <AddToCalendar
                    event={ticket.event}
                    ticketId={ticket.ticketId}
                    name={name}
                    venue={meta?.venue ?? ""}
                    doorsOpen={show.doorsOpen}
                    endTime={show.endTime}
                    className={SECONDARY}
                    icon={<Icon name="calendar" />}
                  />
                )}
                {status === "ready" && (
                  <SendToPhone
                    account={account}
                    event={ticket.event}
                    ticketId={ticket.ticketId}
                    className={SECONDARY}
                    icon={<Icon name="send" />}
                  />
                )}
                <button onClick={() => setOnSale(status === "ready")} disabled={busy} className={SECONDARY}>
                  <Icon name="tag" />
                  {busy ? "Confirm with your fingerprint" : status === "ready" ? "Sell at face value" : "Take off sale"}
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-stop">
                {error}
              </p>
            )}
            <p className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
              <span>
                {ticket.boughtAt > 0
                  ? `Bought ${new Date(ticket.boughtAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}`
                  : ""}
              </span>
              {ticket.hash.length === 66 && (
                <a href={txUrl(ticket.hash)} target="_blank" rel="noopener" className="underline underline-offset-2">
                  Proof of payment
                </a>
              )}
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

export function TicketsView() {
  const hydrated = useHydrated();
  const account = useAccount();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  // Tickets bought here plus the ones the indexer says this account holds, so they show on any device.
  const mine = useMyTickets(account);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    readBalance(account.address)
      .then((b) => alive && setBalance(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account, version]);

  useEffect(() => {
    let alive = true;
    Promise.all(
      mine.map(async (t) => {
        const [info, show, named] = await Promise.all([
          readTicket(t.event, BigInt(t.ticketId)).catch(() => null),
          readShowOnce(t.event).catch(() => null),
          isNamed(t.event).catch(() => true),
        ]);
        return [keyOf(t), { info, show, named }] as const;
      }),
    ).then((rows) => alive && setLoaded(Object.fromEntries(rows)));
    return () => {
      alive = false;
    };
  }, [mine, version]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);

  if (!hydrated) return null;

  if (!account) {
    return (
      <main className="mx-auto max-w-md pt-10 text-center lg:pt-20">
        <h1 className="font-display text-4xl">Your tickets</h1>
        <p className="mt-3 text-muted">
          Already bought on another device? Sign in with the same passkey and your tickets come with you.
        </p>
        <div className="mx-auto mt-6 max-w-sm">
          <SignInButton />
        </div>
        <Link href="/shows" className="mt-5 inline-block text-sm font-semibold text-velvet underline underline-offset-4">
          New here? Browse shows
        </Link>
      </main>
    );
  }

  const rows = mine
    .map((t) => {
      const l = loaded[keyOf(t)];
      const status = cardStatus(l?.info ?? null, account.address, wasListedHere(t.event, t.ticketId));
      return { ticket: t, info: l?.info ?? null, show: l?.show ?? null, named: l?.named, status, boughtAt: t.boughtAt };
    })
    .filter((r) => r.named !== false);
  const upcoming = sortTickets(
    rows.filter((r) => ticketGroup(r.status, r.show) === "upcoming"),
    "upcoming",
  );
  const past = sortTickets(
    rows.filter((r) => ticketGroup(r.status, r.show) === "past"),
    "past",
  );
  const loading = mine.length > 0 && Object.keys(loaded).length === 0;

  const list = (items: typeof rows, isPast: boolean) => (
    <ul className="mt-5 grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
      {items.map((r) => (
        <TicketCard
          key={keyOf(r.ticket)}
          ticket={r.ticket}
          account={account}
          info={r.info}
          show={r.show}
          status={r.status}
          past={isPast}
          onChanged={changed}
        />
      ))}
    </ul>
  );

  return (
    <main className="pt-6 lg:pt-10">
      <h1 className="font-display text-4xl leading-none sm:text-5xl">{account.name ? `${account.name}'s tickets` : "My tickets"}</h1>
      <p className="mt-3 text-sm text-muted">
        Demo balance <span className="font-semibold text-foreground tabular-nums">{balance === null ? "…" : formatNaira(balance)}</span>
        <span className="hidden sm:inline"> · refunds and resale money land here and pay for your next ticket</span>
      </p>

      {loading ? (
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-3xl bg-line/60" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-10 border-t border-line pt-8">
          <p className="font-display text-2xl">No tickets yet</p>
          <Link href="/shows" className="mt-3 inline-block text-sm font-semibold text-velvet underline underline-offset-4">
            Browse shows
          </Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="upcoming-heading" className="mt-10">
            <h2 id="upcoming-heading" className="text-sm font-semibold tracking-wide text-muted uppercase">
              Upcoming
            </h2>
            {upcoming.length > 0 ? (
              list(upcoming, false)
            ) : (
              <p className="mt-4 text-muted">
                Nothing coming up.{" "}
                <Link href="/shows" className="font-semibold text-velvet underline underline-offset-4">
                  Browse shows
                </Link>
              </p>
            )}
          </section>
          {past.length > 0 && (
            <section aria-labelledby="past-heading" className="mt-14">
              <h2 id="past-heading" className="text-sm font-semibold tracking-wide text-muted uppercase">
                Past
              </h2>
              {list(past, true)}
            </section>
          )}
        </>
      )}

      <button
        onClick={() => {
          if (confirm("Sign out of Curtain on this phone? Your tickets stay with your passkey.")) signOut();
        }}
        className="mt-14 block text-xs text-muted underline"
      >
        Sign out on this phone
      </button>
    </main>
  );
}
