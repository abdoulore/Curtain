"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { txUrl } from "@/lib/chain";
import { signOut } from "@/lib/account";
import { findEvent } from "@/lib/events";
import { useAccount, useHydrated, useSavedTickets } from "@/lib/hooks";
import { formatNaira } from "@/lib/money";
import { readBalance, readTicket, type TicketState } from "@/lib/reads";
import type { SavedTicket } from "@/lib/tickets";

const STATE_LABEL: Record<TicketState, { text: string; tone: string }> = {
  None: { text: "Not found", tone: "text-muted" },
  Active: { text: "Ready for the door", tone: "text-go" },
  CheckedIn: { text: "Checked in. Enjoy the show", tone: "text-foreground" },
  RefundOwed: { text: "Refund on its way", tone: "text-velvet" },
  Refunded: { text: "Refunded", tone: "text-muted" },
};

function TicketCard({ ticket, owner }: { ticket: SavedTicket; owner: string }) {
  const meta = findEvent(ticket.event);
  const [state, setState] = useState<TicketState | null>(null);
  const [moved, setMoved] = useState(false);

  useEffect(() => {
    let alive = true;
    readTicket(ticket.event, BigInt(ticket.ticketId))
      .then((t) => {
        if (!alive) return;
        setState(t.state);
        setMoved(t.holder.toLowerCase() !== owner.toLowerCase());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ticket.event, ticket.ticketId, owner]);

  const label = state ? STATE_LABEL[state] : null;
  return (
    <li className="overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">{meta?.venue}</p>
          <p className="mt-1 text-lg font-semibold">{meta?.name ?? "Curtain event"}</p>
          <p className={`mt-2 text-sm font-medium ${moved ? "text-muted" : (label?.tone ?? "text-muted")}`}>
            {moved ? "Passed on to someone else" : (label?.text ?? "Checking…")}
          </p>
        </div>
        <p className="font-mono text-3xl font-semibold text-velvet">#{ticket.ticketId}</p>
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-line px-5 py-3 text-xs text-muted">
        <span>Bought {new Date(ticket.boughtAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}</span>
        <a href={txUrl(ticket.hash)} target="_blank" rel="noopener" className="underline underline-offset-2">
          Proof of payment
        </a>
      </div>
    </li>
  );
}

export function TicketsView() {
  const hydrated = useHydrated();
  const account = useAccount();
  const saved = useSavedTickets();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    readBalance(account.address)
      .then((b) => alive && setBalance(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account]);

  if (!hydrated) return null;

  if (!account) {
    return (
      <main className="pt-10 text-center">
        <h1 className="text-2xl font-semibold">No tickets on this phone yet</h1>
        <p className="mt-2 text-muted">Get one with your fingerprint or Face ID. It takes under a minute.</p>
        <Link
          href="/e/demo"
          className="mt-6 inline-block rounded-2xl bg-velvet px-5 py-3 font-semibold text-velvet-ink"
        >
          See the demo show
        </Link>
      </main>
    );
  }

  const mine = saved.filter((t) => t.owner.toLowerCase() === account.address.toLowerCase());

  return (
    <main className="pt-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{account.name ? `${account.name}'s tickets` : "My tickets"}</h1>
          <p className="mt-1 text-sm text-muted">Balance {balance === null ? "…" : formatNaira(balance)}</p>
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
        <ul className="mt-6 space-y-4">
          {mine.map((t) => (
            <TicketCard key={`${t.event}-${t.ticketId}`} ticket={t} owner={account.address} />
          ))}
        </ul>
      )}

      <p className="mt-8 text-center text-xs text-muted">
        At the door, scan the gate code and confirm with your fingerprint or Face ID. If the show is cancelled, your
        money comes back on its own.
      </p>
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
