"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isPrfUnavailable, signUp, unlock } from "@/lib/account";
import { claimWithLink } from "@/lib/claim";
import { parseClaimFragment } from "@/lib/claim-key";
import { PASSKEY_PRIVACY } from "@/lib/copy";
import { plainError } from "@/lib/errors";
import { useShowMeta } from "@/lib/show-details";
import { useAccount, useHydrated } from "@/lib/hooks";
import { readTicket, type TicketInfo } from "@/lib/reads";
import { saveTicket } from "@/lib/tickets";
import { ContinueOnPhone } from "./ContinueOnPhone";
import { SignInButton } from "./SignInButton";
import { VerdictIcon } from "./VerdictIcon";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** The phone end of "Send to my phone" and gift links. */
export function ClaimView() {
  const hydrated = useHydrated();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const link = useMemo(() => (hash ? parseClaimFragment(hash) : null), [hash]);
  const account = useAccount();
  const meta = useShowMeta(link?.event);

  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [needsPhone, setNeedsPhone] = useState(false);

  useEffect(() => {
    if (!link) return;
    let alive = true;
    readTicket(link.event, link.ticketId)
      .then((t) => alive && setTicket(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [link]);

  async function take() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      // A new phone makes its passkey here (one prompt); an existing account confirms its door key if needed.
      const stored = account ?? (await signUp(name.trim()));
      const { account: ready } = await unlock(stored);
      const result = await claimWithLink(link, ready);
      saveTicket({
        event: link.event,
        ticketId: link.ticketId.toString(),
        owner: ready.address,
        hash: result.hash,
        boughtAt: Date.now(),
      });
      setDone(true);
    } catch (e) {
      if (isPrfUnavailable(e)) setNeedsPhone(true);
      else setError(plainError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return null;

  if (!link) {
    return (
      <main className="mx-auto max-w-md pt-10 text-center lg:pt-20">
        <h1 className="text-2xl font-semibold">This link is incomplete</h1>
        <p className="mt-2 text-muted">Ask for the ticket link again, or scan the code once more.</p>
      </main>
    );
  }

  if (done) {
    return (
      <main className="mx-auto mt-6 flex min-h-[60vh] max-w-md flex-col items-center justify-center rounded-3xl bg-admit p-6 text-center text-white">
        <VerdictIcon ok className="h-20 w-20" />
        <h1 className="mt-4 text-3xl font-semibold">Ticket #{link.ticketId.toString()} is on this phone</h1>
        <p className="mt-3 max-w-xs opacity-90">At the door, scan the gate code and confirm with your fingerprint or Face ID.</p>
        <Link href="/tickets" className="mt-6 rounded-2xl bg-white px-5 py-3 font-semibold text-admit">
          See my ticket
        </Link>
      </main>
    );
  }

  const dead = ticket && (ticket.state !== "Active" || /^0x0{40}$/.test(ticket.claimKey));

  return (
    <main className="mx-auto max-w-md pt-6 lg:pt-12">
      <p className="text-sm text-muted">A ticket for you</p>
      <h1 className="text-2xl font-semibold">{meta?.name ?? "Curtain event"}</h1>
      <p className="mt-1 text-muted">
        Ticket <span className="font-mono font-semibold text-velvet">#{link.ticketId.toString()}</span>
      </p>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-5">
        {needsPhone ? (
          <ContinueOnPhone reason="Claim this ticket on your phone." />
        ) : dead ? (
          <p className="font-medium">This link no longer works. Ask the ticket&apos;s owner for a new one.</p>
        ) : (
          <>
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
              onClick={take}
              disabled={busy || (!account && name.trim().length === 0)}
              className="w-full rounded-2xl bg-velvet px-5 py-4 text-base font-semibold text-velvet-ink disabled:opacity-50"
            >
              {busy ? "Confirm with your fingerprint or Face ID" : "Put this ticket on my phone"}
            </button>
            <p className="mt-3 text-center text-xs text-muted">
              {account
                ? "It moves to the passkey on this phone. Its money is held until the show happens."
                : `This phone gets its own passkey. ${PASSKEY_PRIVACY}`}
            </p>
            {!account && (
              <div className="mt-4 text-center">
                <SignInButton variant="link" label="Already have a Curtain passkey? Sign in first" />
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-stop">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
