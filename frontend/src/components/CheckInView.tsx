"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getAddress } from "viem";
import { ApiError } from "@/lib/api";
import { checkIn, type CheckInResult } from "@/lib/checkin";
import { eventPath } from "@/lib/events";
import { useShowMeta } from "@/lib/show-details";
import { parseCheckInFragment } from "@/lib/gate";
import { useAccount, useHydrated } from "@/lib/hooks";
import { useMyTickets } from "@/lib/use-my-tickets";
import { formatNaira } from "@/lib/money";
import { readTicket, type TicketState } from "@/lib/reads";
import { chooseTicket } from "@/lib/ticket-choice";
import { SignInButton } from "./SignInButton";

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

type Outcome = { ok: true; result: CheckInResult } | { ok: false; message: string };

export function CheckInView() {
  const hydrated = useHydrated();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const token = useMemo(() => (hash ? parseCheckInFragment(hash) : null), [hash]);
  const account = useAccount();
  const held = useMyTickets(account);
  const meta = useShowMeta(token?.event);

  const mine = useMemo(
    () =>
      token ? held.filter((t) => getAddress(t.event) === getAddress(token.event)) : [],
    [held, token],
  );

  const [states, setStates] = useState<Record<string, TicketState>>({});
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!token || mine.length === 0) return;
    let alive = true;
    // A ticket this account sold or passed on reads as "None": still presented last, so the door shows red.
    Promise.all(
      mine.map((t) =>
        readTicket(token.event, BigInt(t.ticketId)).then((r) => {
          const held = account && r.holder.toLowerCase() === account.address.toLowerCase();
          return [t.ticketId, held ? r.state : ("None" as TicketState)] as const;
        }),
      ),
    )
      .then((pairs) => alive && setStates(Object.fromEntries(pairs)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, mine, account]);

  const choice = chooseTicket(mine, states, typed);
  const ticketId = choice?.ticketId;

  async function go() {
    if (!token || !account || !ticketId) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await checkIn(token, BigInt(ticketId), account);
      setOutcome({ ok: true, result });
      setStates((s) => ({ ...s, [ticketId]: "CheckedIn" }));
    } catch (e) {
      setOutcome({ ok: false, message: e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return null;

  if (!token) {
    return (
      <main className="mx-auto max-w-md pt-10 text-center lg:pt-20">
        <h1 className="text-2xl font-semibold">Scan the gate code</h1>
        <p className="mt-2 text-muted">Point your camera at the code on the gate screen to check in.</p>
      </main>
    );
  }

  if (outcome?.ok) {
    return (
      <main className="mx-auto mt-6 flex min-h-[70vh] max-w-md flex-col items-center justify-center rounded-3xl bg-go p-6 text-center text-white">
        <p className="text-5xl">✓</p>
        <h1 className="mt-4 text-3xl font-semibold">Welcome in</h1>
        <p className="mt-2 text-lg">Ticket #{outcome.result.ticketId}</p>
        <p className="mt-6 max-w-xs text-sm opacity-90">
          {formatNaira(BigInt(outcome.result.released))} just went to the organizer. Enjoy the show.
        </p>
      </main>
    );
  }

  if (outcome && !outcome.ok) {
    return (
      <main className="mx-auto mt-6 flex min-h-[70vh] max-w-md flex-col items-center justify-center rounded-3xl bg-stop p-6 text-center text-white">
        <p className="text-5xl">✕</p>
        <h1 className="mt-4 text-3xl font-semibold">Not let in</h1>
        <p className="mt-2 text-lg">{outcome.message}</p>
        <button onClick={() => setOutcome(null)} className="mt-8 rounded-2xl bg-white/15 px-5 py-3 font-semibold">
          Back
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md pt-6 lg:pt-12">
      <p className="text-sm text-muted">Checking in to</p>
      <h1 className="text-2xl font-semibold">{meta?.name ?? "Curtain event"}</h1>

      {!account ? (
        <div className="mt-6 rounded-3xl border border-line bg-surface p-5">
          <p className="font-medium">Sign in to check in</p>
          <p className="mt-1 text-sm text-muted">Use the passkey you bought your ticket with. Your tickets load right after.</p>
          <div className="mt-4">
            <SignInButton />
          </div>
          {meta && (
            <Link href={eventPath(meta)} className="mt-4 inline-block text-sm font-semibold text-velvet underline">
              No ticket yet? Get one
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-6 rounded-3xl border border-line bg-surface p-5">
          {choice ? (
            <>
              <p className="text-lg font-semibold">
                Ticket <span className="font-mono text-velvet">#{choice.ticketId}</span>
              </p>
              {!choice.usable && (
                <p className="mt-1 text-sm text-stop">
                  {states[choice.ticketId] === "None"
                    ? "You sold or passed on this ticket. It now opens the door only for its new holder."
                    : "This ticket has already been used."}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">No ticket for this show on this phone.</p>
          )}

          <button
            onClick={go}
            disabled={busy || !ticketId}
            className="mt-4 w-full rounded-2xl bg-velvet px-5 py-4 text-base font-semibold text-velvet-ink disabled:opacity-50"
          >
            {busy ? "Confirm with your fingerprint or Face ID" : "Check in"}
          </button>

          <details className="mt-4 text-sm text-muted">
            <summary className="cursor-pointer">Use a different ticket number</summary>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Ticket number"
              className="mt-2 w-full rounded-xl border border-line bg-background px-3 py-3 text-base text-foreground outline-none focus:border-velvet"
            />
          </details>
        </div>
      )}

    </main>
  );
}
