"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { txUrl } from "@/lib/chain";
import { friendlyPasskeyError, signOut, unlock, type StoredAccount } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { useAccount, useHydrated } from "@/lib/hooks";
import { useMyTickets } from "@/lib/use-my-tickets";
import { formatNaira } from "@/lib/money";
import { browserClient, readBalance, readEventInfo, readTicket, type EventInfo, type TicketInfo } from "@/lib/reads";
import { cardStatus, listTicket, rememberListed, wasListedHere, type CardStatus } from "@/lib/resale";
import { useShowMeta } from "@/lib/show-details";
import type { SavedTicket } from "@/lib/tickets";
import { AddToCalendar } from "./AddToCalendar";
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

const DOOR_HINT = "At the door, scan the gate code with your camera and confirm with your fingerprint or Face ID.";

function statusLine(status: CardStatus, price: string): { text: string; tone: string } {
  switch (status) {
    case "checking":
      return { text: "Checking…", tone: "text-muted" };
    case "ready":
      return { text: "Ready for the door", tone: "text-go" };
    case "listed":
      return { text: `On sale at ${price}. It's still yours until someone buys it.`, tone: "text-velvet" };
    case "used":
      return { text: "Checked in. Enjoy the show", tone: "text-foreground" };
    case "refunded":
      return { text: `${price} is back in your balance`, tone: "text-go" };
    case "refundOwed":
      return { text: "Refund on its way", tone: "text-velvet" };
    case "sold":
      return { text: `Sold. The buyer's ${price} went to your balance.`, tone: "text-muted" };
    case "passedOn":
      return { text: "Passed on to someone else", tone: "text-muted" };
  }
}

function TicketCard({ ticket, account, onMoney }: { ticket: SavedTicket; account: StoredAccount; onMoney: () => void }) {
  const owner = account.address;
  const meta = useShowMeta(ticket.event);
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
  const line = statusLine(status, status === "listed" && info ? formatNaira(info.resalePrice) : price);
  const open = show?.status === "Open" && show.readAt < show.endTime;

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
    <li className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-lg font-semibold">{meta?.name ?? "Curtain show"}</p>
          <p className="mt-0.5 text-sm text-muted">
            {show ? whenFmt.format(new Date(show.doorsOpen * 1000)) : "…"}
            {meta?.venue ? ` · ${meta.venue}` : ""}
          </p>
          <p className={`mt-2 text-sm font-medium ${line.tone}`}>{line.text}</p>
        </div>
        <p className="font-mono text-3xl font-semibold text-velvet">#{ticket.ticketId}</p>
      </div>

      {status === "ready" && <p className="px-5 pb-3 text-sm text-muted">{DOOR_HINT}</p>}
      {(status === "refunded" || status === "sold") && (
        <p className="px-5 pb-3 text-sm text-muted">Your balance pays for your next ticket on Curtain.</p>
      )}

      {open && (status === "ready" || status === "listed") && (
        <div className="space-y-3 px-5 pb-4">
          {status === "ready" && show && (
            <AddToCalendar
              event={ticket.event}
              ticketId={ticket.ticketId}
              name={meta?.name ?? "Curtain show"}
              venue={meta?.venue ?? ""}
              doorsOpen={show.doorsOpen}
              endTime={show.endTime}
            />
          )}
          {status === "ready" && <SendToPhone account={account} event={ticket.event} ticketId={ticket.ticketId} />}
          <button
            onClick={() => setOnSale(status === "ready")}
            disabled={busy}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Confirm with your fingerprint or Face ID" : status === "ready" ? "Sell at face value" : "Take it off sale"}
          </button>
          {error && <p className="text-sm text-stop">{error}</p>}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-dashed border-line px-5 py-3 text-xs text-muted">
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
        <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
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
          if (confirm("Sign out of Curtain on this phone? Your tickets stay safe with your passkey.")) signOut();
        }}
        className="mx-auto mt-6 block text-xs text-muted underline"
      >
        Sign out on this phone
      </button>
    </main>
  );
}
