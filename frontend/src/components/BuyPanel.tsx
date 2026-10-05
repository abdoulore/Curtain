"use client";

import Link from "next/link";
import { useState } from "react";
import { friendlyPasskeyError, signUp, unlock } from "@/lib/account";
import { ApiError } from "@/lib/api";
import { buyTicket, hasBalanceFor, requestTopup, type BuyResult } from "@/lib/buy";
import type { EventMeta } from "@/lib/events";
import { useAccount, useHydrated, useIsDesktop } from "@/lib/hooks";
import { formatNaira } from "@/lib/money";
import type { EventInfo } from "@/lib/reads";
import { saveTicket } from "@/lib/tickets";
import { SignInButton } from "./SignInButton";

type Step = "idle" | "passkey" | "funding" | "paying" | "done";

const STEP_TEXT: Record<Step, string> = {
  idle: "",
  passkey: "Confirm with your fingerprint or Face ID",
  funding: "Adding test money to your balance",
  paying: "Paying into the show's safe",
  done: "",
};

export function BuyPanel({ meta, info, onBought }: { meta: EventMeta; info: EventInfo; onBought: () => void }) {
  const hydrated = useHydrated();
  const desktop = useIsDesktop();
  const account = useAccount();
  const [name, setName] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<BuyResult | null>(null);

  const busy = step !== "idle" && step !== "done";
  const closed =
    info.status !== "Open"
      ? "This show isn't selling tickets anymore."
      : info.readAt >= info.salesEnd
        ? "Ticket sales have closed."
        : info.sold >= info.capacity
          ? "Sold out. Every ticket has been taken."
          : null;

  async function purchase() {
    setError(null);
    try {
      // The passkey prompt must open straight from the tap, before any network call.
      setStep("passkey");
      const stored = account ?? (await signUp(name.trim()));
      const { signer, account: ready } = await unlock(stored);

      if (!(await hasBalanceFor(stored.address, info.price))) {
        if (!meta.isDemo) throw new Error("Your balance is too low for this ticket.");
        setStep("funding");
        await requestTopup(stored.address);
      }

      setStep("paying");
      const result = await buyTicket(meta.address, ready, signer, info.price);
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
      setError(e instanceof ApiError ? e.message : friendlyPasskeyError(e));
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
              On your phone, open curtaintickets.vercel.app and sign in with your passkey. If your passkey isn&apos;t on
              your phone, open My tickets here and choose Send to my phone.
            </p>
          </div>
        ) : (
          <p className="mt-1 text-sm">
            Ticket #{bought.ticketId} is on this phone. At the door, scan the gate code and confirm with your fingerprint
            or Face ID.
          </p>
        )}
        <div className="mt-4 flex gap-3">
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
        </label>
      )}
      <button
        onClick={purchase}
        disabled={busy || (!account && name.trim().length === 0)}
        className="w-full rounded-2xl bg-velvet px-5 py-4 text-base font-semibold text-velvet-ink disabled:opacity-50"
      >
        {busy ? STEP_TEXT[step] : account ? `Buy for ${formatNaira(info.price)}` : "Get my ticket"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        {account
          ? `Signed in as ${account.name || "you"}. One fingerprint or Face ID to pay.`
          : "No password, no app. Your fingerprint or Face ID is your ticket."}
      </p>
      {error && <p className="mt-3 text-sm text-stop">{error}</p>}
      {!account && (
        <div className="mt-4 text-center">
          <SignInButton variant="link" label="Already have a Curtain passkey? Sign in" />
        </div>
      )}
    </div>
  );
}
