"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isPrfUnavailable, signUp, unlock } from "@/lib/account";
import { detectPrfSupport, type PrfSupport } from "@/lib/capabilities";
import { buyTicket, hasBalanceFor, requestTopup, type BuyResult } from "@/lib/buy";
import { PASSKEY_PRIVACY } from "@/lib/copy";
import { plainError } from "@/lib/errors";
import type { EventMeta } from "@/lib/events";
import { useAccount, useHydrated, useIsDesktop } from "@/lib/hooks";
import { formatNaira } from "@/lib/money";
import type { EventInfo } from "@/lib/reads";
import type { Listing } from "@/lib/resale";
import { saleState } from "@/lib/sale-state";
import { saveTicket } from "@/lib/tickets";
import { AddToCalendar } from "./AddToCalendar";
import { ContinueOnPhone } from "./ContinueOnPhone";
import { SignInButton } from "./SignInButton";

type Step = "idle" | "passkey" | "funding" | "paying" | "done";

const STEP_TEXT: Record<Step, string> = {
  idle: "",
  passkey: "Confirm with your fingerprint or Face ID",
  funding: "Adding demo money",
  paying: "Paying, your money stays protected",
  done: "",
};

/** Buys a new ticket, or with `listing`, a resale ticket at the seller's price (paid straight to the seller). */
export function BuyPanel({
  meta,
  info,
  onBought,
  listing,
  onCheckoutChange,
}: {
  meta: EventMeta;
  info: EventInfo;
  onBought: () => void;
  listing?: Listing;
  /** Told when a purchase starts or finishes, so the page can hide its sticky buy bar. */
  onCheckoutChange?: (active: boolean) => void;
}) {
  const hydrated = useHydrated();
  const desktop = useIsDesktop();
  const account = useAccount();
  const [name, setName] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<BuyResult | null>(null);
  const [prf, setPrf] = useState<PrfSupport>("unknown");
  const [needsPhone, setNeedsPhone] = useState(false);

  useEffect(() => {
    let alive = true;
    detectPrfSupport().then((s) => alive && setPrf(s));
    return () => {
      alive = false;
    };
  }, []);

  const busy = step !== "idle" && step !== "done";
  const checkoutActive = busy || bought !== null;
  useEffect(() => {
    onCheckoutChange?.(checkoutActive);
  }, [checkoutActive, onCheckoutChange]);

  const price = listing ? listing.price : info.price;
  const sale = saleState(info);
  const closed = listing
    ? info.status !== "Open"
      ? "This show isn't selling tickets anymore."
      : info.readAt >= info.endTime
        ? "This show has ended."
        : null
    : sale.kind === "open"
      ? null
      : sale.kind === "soldOut"
        ? "Sold out. Every ticket has been taken."
        : sale.label;

  async function purchase() {
    setError(null);
    try {
      // The passkey prompt must open straight from the tap, before any network call.
      setStep("passkey");
      const stored = account ?? (await signUp(name.trim()));
      const { signer, account: ready } = await unlock(stored);

      // Testnet: a low balance gets free test money from the treasury, within its daily limits.
      if (!(await hasBalanceFor(stored.address, price))) {
        setStep("funding");
        await requestTopup(stored.address);
      }

      setStep("paying");
      const result = await buyTicket(meta.address, ready, signer, price, listing?.ticketId ?? 0n);
      saveTicket({
        event: meta.address,
        ticketId: result.ticketId,
        owner: stored.address,
        hash: result.hash,
        boughtAt: Date.now(),
      });
      setBought(result);
      setStep("done");
      onBought();
    } catch (e) {
      setStep("idle");
      if (isPrfUnavailable(e)) setNeedsPhone(true);
      else setError(plainError(e));
    }
  }

  if (!hydrated) return <div className="h-14" />;

  if (bought) {
    return (
      <div className="rounded-2xl bg-go/10 p-4">
        <p className="text-lg font-semibold text-go">You&apos;re in.</p>
        {desktop ? (
          <div className="mt-1 space-y-2 text-sm">
            <p className="font-medium">Ticket #{bought.ticketId} is ready for your phone.</p>
            <p>
              On your phone, open curtaintickets.vercel.app and sign in with your passkey, or open My tickets here and
              choose Send to my phone.
            </p>
          </div>
        ) : (
          <p className="mt-1 text-sm">
            Ticket #{bought.ticketId} is on this phone. At the door, scan the gate code and confirm with your fingerprint
            or Face ID.
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Demo money for this preview. In the live app you pay by card or bank transfer.
        </p>
        <div className="mt-3">
          <AddToCalendar
            event={meta.address}
            ticketId={bought.ticketId}
            name={meta.name}
            venue={meta.venue}
            doorsOpen={info.doorsOpen}
            endTime={info.endTime}
          />
        </div>
        <div className="mt-3 flex gap-3">
          <Link
            href="/tickets"
            className="flex-1 rounded-2xl bg-velvet px-4 py-3 text-center font-semibold text-velvet-ink"
          >
            See my ticket
          </Link>
          <button
            onClick={() => {
              setBought(null);
              setStep("idle");
            }}
            className="rounded-2xl border border-line px-4 py-3 font-medium"
          >
            Buy another
          </button>
        </div>
      </div>
    );
  }

  if (closed) return <p className="text-sm font-medium text-muted">{closed}</p>;

  // A browser without PRF can't hold a ticket; a returning account here already proved it can.
  if (needsPhone || (!account && prf === "no")) return <ContinueOnPhone />;

  return (
    <div>
      {!account && (
        <label className="mb-3 block text-sm">
          <span className="text-muted">Your first name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoComplete="given-name"
            placeholder="Ada"
            className="mt-1 w-full rounded-xl border border-line bg-background px-3 py-3 text-base outline-none focus:border-velvet"
          />
          <span className="mt-1.5 block text-xs text-muted">{PASSKEY_PRIVACY}</span>
        </label>
      )}
      <button
        onClick={purchase}
        disabled={busy || (!account && name.trim().length === 0)}
        className="w-full rounded-2xl bg-velvet px-5 py-4 text-base font-semibold text-velvet-ink disabled:opacity-50"
      >
        {busy
          ? listing && step === "paying"
            ? "Paying the seller"
            : STEP_TEXT[step]
          : listing
            ? `Buy resale ticket for ${formatNaira(price)}`
            : account
              ? `Buy for ${formatNaira(price)}`
              : "Get my ticket"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        {account
          ? `Signed in as ${account.name || "you"}. One fingerprint or Face ID to pay.`
          : "No password, no app. Your fingerprint or Face ID is your ticket."}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-stop">
          {error}
        </p>
      )}
      {!account && (
        <div className="mt-4 text-center">
          <SignInButton variant="link" label="Already have a Curtain passkey? Sign in" />
        </div>
      )}
    </div>
  );
}
