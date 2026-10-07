"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { txUrl } from "@/lib/chain";
import { friendlyPasskeyError, signOut, unlock, type StoredAccount } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { useAccount, useHydrated } from "@/lib/hooks";
import { useMyTickets } from "@/lib/use-my-tickets";
import { formatNaira } from "@/lib/money";
import { browserClient, readBalance, readEventInfo, readTicket, type EventInfo, type TicketInfo } from "@/lib/reads";
import { cardStatus, listTicket, rememberListed, wasListedHere } from "@/lib/resale";
import { useShowMeta } from "@/lib/show-details";
import { ticketBadge, type BadgeIcon, type TicketBadge } from "@/lib/ticket-badge";
import type { SavedTicket } from "@/lib/tickets";
import { useShowMedia } from "@/lib/use-show-media";
import { AddToCalendar } from "./AddToCalendar";
import { Poster } from "./Poster";
import { SendToPhone } from "./SendToPhone";
import { SignInButton } from "./SignInButton";

const whenFmt = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const noSubscribe = () => () => {};

/** Several cards often share a show; read its details once per page load. */
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

const ACTION =
  "flex flex-1 basis-0 flex-col items-center justify-center gap-1 px-2 py-3 text-xs font-semibold hover:bg-background disabled:opacity-50";

function TicketCard({ ticket, account, onMoney }: { ticket: SavedTicket; account: StoredAccount; onMoney: () => void }) {
  const owner = account.address;
  const meta = useShowMeta(ticket.event);
  const media = useShowMedia(ticket.event);
  const [info, setInfo] = useState<TicketInfo | null>(null);
  const [show, setShow] = useState<EventInfo | null>(null);
  const [justListed, setJustListed] = useState(false);
  const listedBefore = useSyncExternalStore(
    noSubscribe,
    () => wasListedHere(ticket.event, ticket.ticketId),
    () => false,
  );
  const listedHere = listedBefore || justListed;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      readTicket(ticket.event, BigInt(ticket.ticketId))
        .then(setInfo)
        .catch(() => {}),
    [ticket.event, ticket.ticketId],
  );

  useEffect(() => {
    let alive = true;
    refresh();
    readShowOnce(ticket.event)
      .then((s) => alive && setShow(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [refresh, ticket.event]);

  const status = cardStatus(info, owner, listedHere);
  const price = show ? formatNaira(show.price) : "…";
  const badge = ticketBadge(status, status === "listed" && info ? formatNaira(info.resalePrice) : price);
  const open = show?.status === "Open" && show.readAt < show.endTime;
  const name = meta?.name ?? "Curtain show";

  async function setOnSale(onSale: boolean) {
    if (!show) return;
    if (onSale && !confirm(`Put ticket #${ticket.ticketId} on sale at face value, ${price}? The buyer pays you directly.`)) return;
    setBusy(true);
    setError(null);
    try {
      // The passkey prompt opens straight from the tap, before any network call.
      const { signer } = await unlock(account);
      await listTicket(browserClient, ticket.event, BigInt(ticket.ticketId), onSale ? show.price : 0n, signer);
      if (onSale) {
        rememberListed(ticket.event, ticket.ticketId);
        setJustListed(true);
      }
      await refresh();
      onMoney();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : friendlyPasskeyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="overflow-hidden rounded-3xl border border-line bg-surface" aria-label={`${name}, ticket ${ticket.ticketId}`}>
      <div className="flex gap-4 p-4">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-line">
          <Poster src={media?.poster} name={name} sizes="112px" />
        </div>
        <div className="min-w-0 flex-1">
          <Badge badge={badge} />
          <p className="mt-2 truncate text-base font-semibold">{name}</p>
          <p className="mt-0.5 text-sm text-muted">
            {show ? whenFmt.format(new Date(show.doorsOpen * 1000)) : "…"}
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
        <div className="text-right">
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Price</p>
          <p className="font-semibold">{price}</p>
        </div>
      </div>
      {badge.detail && <p className="px-5 pt-3 text-sm text-muted">{badge.detail}</p>}

      {open && (status === "ready" || status === "listed") ? (
        <div className="mt-4 flex flex-wrap divide-x divide-line border-t border-line">
          {status === "ready" && show && (
            <AddToCalendar
              event={ticket.event}
              ticketId={ticket.ticketId}
              name={name}
              venue={meta?.venue ?? ""}
              doorsOpen={show.doorsOpen}
              endTime={show.endTime}
              className={ACTION}
              icon={<Icon name="calendar" />}
            />
          )}
          {status === "ready" && (
            <SendToPhone
              account={account}
              event={ticket.event}
              ticketId={ticket.ticketId}
              className={ACTION}
              icon={<Icon name="send" />}
            />
          )}
          <button onClick={() => setOnSale(status === "ready")} disabled={busy} className={ACTION}>
            <Icon name="tag" />
            {busy ? "Confirm with your fingerprint" : status === "ready" ? "Sell at face value" : "Take off sale"}
          </button>
          {error && (
            <p role="alert" className="order-last basis-full border-t border-line px-5 py-3 text-sm text-stop">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="h-4" />
      )}

      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-muted">
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
      </div>
    </li>
  );
}

export function TicketsView() {
  const hydrated = useHydrated();
  const account = useAccount();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceVersion, setBalanceVersion] = useState(0);
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
  }, [account, balanceVersion]);

  if (!hydrated) return null;

  if (!account) {
    return (
      <main className="mx-auto max-w-md pt-10 text-center lg:pt-20">
        <h1 className="text-2xl font-semibold">Your tickets</h1>
        <p className="mt-2 text-muted">
          Already bought on another device? Sign in with the same passkey and your tickets come with you.
        </p>
        <div className="mx-auto mt-6 max-w-sm">
          <SignInButton />
        </div>
        <Link href="/e/demo" className="mt-5 inline-block text-sm font-semibold text-velvet underline">
          New here? See the demo show
        </Link>
      </main>
    );
  }

  return (
    <main className="pt-6 lg:pt-10">
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-8">
        <h1 className="text-2xl font-semibold">{account.name ? `${account.name}'s tickets` : "My tickets"}</h1>
        <div className="mt-3 rounded-2xl border border-line bg-surface p-4 lg:mt-0 lg:max-w-md">
          <p className="text-sm">
            Demo balance <span className="font-semibold">{balance === null ? "…" : formatNaira(balance)}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Refunds and resale money land here, and it pays for your next ticket.
          </p>
        </div>
      </div>

      {mine.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-line p-6 text-center">
          <p className="font-medium">No tickets yet</p>
          <Link href="/e/demo" className="mt-3 inline-block text-sm font-semibold text-velvet underline">
            Get one for the demo show
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {mine.map((t) => (
            <TicketCard
              key={`${t.event}-${t.ticketId}`}
              ticket={t}
              account={account}
              onMoney={() => setBalanceVersion((v) => v + 1)}
            />
          ))}
        </ul>
      )}

      <p className="mt-8 text-center text-xs text-muted">If a show is cancelled, your money comes back on its own.</p>
      <button
        onClick={() => {
          if (confirm("Sign out of Curtain on this phone? Your tickets stay with your passkey.")) signOut();
        }}
        className="mx-auto mt-6 block text-xs text-muted underline"
      >
        Sign out on this phone
      </button>
    </main>
  );
}
