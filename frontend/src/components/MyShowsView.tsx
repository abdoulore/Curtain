"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAddress } from "viem";
import { useAccount, useHydrated } from "@/lib/hooks";
import { fetchShowsOf } from "@/lib/indexer";
import { createdShows } from "@/lib/organizer-local";
import { SignInButton } from "./SignInButton";

type Row = { event: string; name: string; detail: string };

export function MyShowsView() {
  const hydrated = useHydrated();
  const account = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    const local: Row[] = createdShows(account.address).map((s) => ({ event: s.event, name: s.name, detail: "Created on this device" }));
    fetchShowsOf(account.address)
      .then((indexed) =>
        indexed.map((s) => ({
          event: getAddress(s.id),
          name: s.name || "Curtain show",
          detail: `${s.venue ? `${s.venue} · ` : ""}${s.sold} sold · ${s.status === "Open" ? "selling" : s.status}`,
        })),
      )
      .catch(() => [] as Row[])
      .then((indexed) => {
        if (!alive) return;
        const seen = new Set(indexed.map((r) => r.event.toLowerCase()));
        setRows([...indexed, ...local.filter((r) => !seen.has(r.event.toLowerCase()))]);
      });
    return () => {
      alive = false;
    };
  }, [account]);

  if (!hydrated) return null;

  return (
    <main className="mx-auto max-w-2xl pt-6 lg:pt-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Organizer</p>
          <h1 className="mt-1 text-2xl font-semibold lg:text-3xl">Your shows</h1>
        </div>
        <Link href="/organizer/new" className="rounded-2xl bg-velvet px-4 py-2.5 text-sm font-semibold text-velvet-ink">
          Create a show
        </Link>
      </div>

      {!account ? (
        <div className="mt-6 rounded-3xl border border-line bg-surface p-5">
          <p className="font-medium">Sign in with the passkey you organize with</p>
          <div className="mt-3">
            <SignInButton />
          </div>
        </div>
      ) : rows === null ? (
        <p className="mt-6 text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-line p-6 text-center">
          <p className="font-medium">No shows yet</p>
          <p className="mt-1 text-sm text-muted">Create one and you land on its dashboard, with links to its page and gate.</p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-3xl border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.event}>
              <Link href={`/organizer/${r.event}`} className="flex items-center justify-between gap-4 px-5 py-4">
                <span>
                  <span className="block font-semibold">{r.name}</span>
                  <span className="block text-sm text-muted">{r.detail}</span>
                </span>
                <span className="text-velvet">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
