"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Totals } from "@/lib/board";
import { DEMO_EVENT } from "@/lib/chain";
import { loadTotals } from "@/lib/load-totals";
import { formatNaira } from "@/lib/money";

const SERIES = [
  { key: "released", label: "Paid to organizer", swatch: "bg-viz-released" },
  { key: "escrowed", label: "Protected", swatch: "bg-viz-held" },
  { key: "refunded", label: "Refunded", swatch: "bg-viz-refunded" },
] as const;

/** The demo show's real money, read from the indexer or its escrow. Nothing here is illustrative. */
export function LiveMoney() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadTotals(DEMO_EVENT)
      .then((t) => alive && setTotals(t))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const share = (v: bigint) => (totals && totals.paidIn > 0n ? Number((v * 10_000n) / totals.paidIn) / 100 : 0);
  const guests = totals ? (totals.checkedIn === 1 ? "1 guest entered" : `${totals.checkedIn} guests entered`) : null;

  return (
    <div className="lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
      <div>
        <h2 id="money-heading" className="font-display text-4xl leading-[1.05] text-stage-ink sm:text-5xl">
          The money, in the open.
        </h2>
        <p className="mt-4 max-w-md text-stage-muted">
          Ticket money stays protected while the show is pending. Check-ins release payments at the door.
        </p>
      </div>

      <div className="mt-10 lg:mt-0" aria-live="polite">
        {failed ? (
          <p className="text-stage-muted">The live numbers are slow to load. The money board has them.</p>
        ) : (
          <>
            <p className="text-6xl font-semibold tracking-tight text-stage-ink tabular-nums sm:text-7xl">
              {totals ? formatNaira(totals.escrowed) : <span className="text-stage-muted">₦…</span>}
            </p>
            <p className="mt-1 text-lg text-stage-muted">protected right now</p>

            <div className="mt-8 flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-stage-line" aria-hidden>
              {totals &&
                totals.paidIn > 0n &&
                SERIES.map((s) => (
                  <div
                    key={s.key}
                    className={`${s.swatch} h-full transition-[width] duration-700 ease-out motion-reduce:transition-none`}
                    style={{ width: `${share(totals[s.key])}%` }}
                  />
                ))}
            </div>
            <dl className="mt-5 grid grid-cols-3 gap-4 text-sm">
              {SERIES.map((s) => (
                <div key={s.key}>
                  <dt className="flex items-center gap-2 text-stage-muted">
                    <span className={`inline-block h-2 w-2 rounded-full ${s.swatch}`} aria-hidden />
                    {s.label}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-stage-ink tabular-nums">
                    {totals ? formatNaira(totals[s.key]) : "…"}
                  </dd>
                </div>
              ))}
            </dl>
            {guests && <p className="mt-5 text-sm text-stage-muted">{guests} so far.</p>}
          </>
        )}
        <Link
          href="/board/demo"
          className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-stage-ink px-5 py-3 font-semibold text-stage hover:bg-white"
        >
          Watch the money move live
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M4 10h12M11 5l5 5-5 5" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
