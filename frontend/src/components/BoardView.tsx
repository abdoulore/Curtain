"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, webSocket } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { describe, sortFeed, type FeedItem } from "@/lib/activity";
import { applyLive, guestsLine, mergeRead, STATUS_TEXT, type Totals } from "@/lib/board";
import { monadTestnet, txUrl } from "@/lib/chain";
import type { EventMeta } from "@/lib/events";
import { ENVIO_URL, fetchBoard, type ActivityRow } from "@/lib/indexer";
import { readTotalsFromChain, totalsFromRow } from "@/lib/load-totals";
import { formatNaira } from "@/lib/money";
import { useShowMedia } from "@/lib/use-show-media";
import { Poster } from "./Poster";

const PUBLIC_WSS_URL = "wss://testnet-rpc.monad.xyz";
/** Latest events shown; the totals above always count everything. */
const FEED_SIZE = 50;

const fromRow = (r: ActivityRow): FeedItem => ({
  id: r.id,
  kind: r.kind,
  ticketId: r.ticketId ?? undefined,
  amount: BigInt(r.amount),
  account: r.account ?? undefined,
  at: Number(r.timestamp) * 1000,
  txHash: r.txHash,
});

const SERIES = [
  { key: "released", label: "Paid to organizer", swatch: "bg-viz-released" },
  { key: "escrowed", label: "Protected", swatch: "bg-viz-held" },
  { key: "refunded", label: "Refunded", swatch: "bg-viz-refunded" },
] as const;

/** Segment widths ease over 400ms, so a check-in visibly moves money from protected to paid. */
const MOVE = "transition-[width] duration-[400ms] ease-out motion-reduce:transition-none";

function MoneyBar({ totals }: { totals: Totals }) {
  const [hover, setHover] = useState<(typeof SERIES)[number]["key"] | null>(null);
  const total = totals.paidIn;
  const share = (v: bigint) => (total === 0n ? 0 : Number((v * 10_000n) / total) / 100);
  const hovered = SERIES.find((s) => s.key === hover);

  return (
    <div>
      <div className="mb-2 h-5 text-sm text-muted" aria-live="polite">
        {hovered ? `${hovered.label}: ${formatNaira(totals[hovered.key])} (${share(totals[hovered.key])}%)` : "Where the ticket money is"}
      </div>
      <div
        className="flex h-6 w-full gap-[2px] overflow-hidden rounded bg-line"
        role="img"
        aria-label={SERIES.map((s) => `${s.label} ${formatNaira(totals[s.key])}`).join(", ")}
      >
        {total === 0n ? (
          <div className="h-full w-full rounded bg-line" />
        ) : (
          SERIES.map((s) => (
            <div
              key={s.key}
              className={`${s.swatch} ${MOVE} h-full cursor-default first:rounded-l last:rounded-r`}
              style={{ width: `${share(totals[s.key])}%` }}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(s.key)}
            />
          ))
        )}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className={`inline-block h-3 w-3 shrink-0 rounded-sm ${s.swatch}`} aria-hidden />
            <span className="text-muted">{s.label}</span>
            <span className="ml-auto font-medium tabular-nums">{formatNaira(totals[s.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ label, value, swatch, flash }: { label: string; value: string; swatch?: string; flash?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-2xl border bg-surface px-4 py-3 transition-colors duration-[400ms] motion-reduce:transition-none sm:block sm:p-4 ${flash ? "border-viz-released" : "border-line"}`}
    >
      <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted uppercase">
        {swatch && <span className={`inline-block h-2.5 w-2.5 rounded-sm ${swatch}`} aria-hidden />}
        {label}
      </p>
      <p className="text-xl font-semibold tabular-nums sm:mt-2 sm:text-2xl">{value}</p>
    </div>
  );
}

export function BoardView({ meta }: { meta: EventMeta }) {
  const media = useShowMedia(meta.address);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [live, setLive] = useState(false);
  const [pulse, setPulse] = useState<FeedItem | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (ENVIO_URL) {
      try {
        const board = await fetchBoard(meta.address);
        if (board.show) {
          const next = totalsFromRow(board.show);
          setTotals((current) => mergeRead(current, next));
          setFeed((current) => {
            const indexed = board.activity.map(fromRow);
            const ids = new Set(indexed.map((i) => i.id));
            // Keep live items the indexer has not caught up with yet.
            return sortFeed([...current.filter((c) => !ids.has(c.id)), ...indexed]).slice(0, FEED_SIZE);
          });
          setNote(null);
          return;
        }
      } catch {
        setNote("The indexer is slow right now, so these totals come straight from the contract.");
      }
    }
    const next = await readTotalsFromChain(meta.address);
    setTotals((current) => mergeRead(current, next));
  }, [meta.address]);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) refresh().catch(() => {});
    };
    run();

    // The instant moment comes from the chain itself; the indexer catches up a beat later.
    const ws = createPublicClient({
      chain: monadTestnet,
      transport: webSocket(PUBLIC_WSS_URL, { keepAlive: true, reconnect: true }),
    });
    const timers: ReturnType<typeof setTimeout>[] = [];
    const seen = new Set<string>();
    const unwatch = ws.watchContractEvent({
      address: meta.address,
      abi: curtainEventAbi,
      onLogs: (logs) => {
        if (!alive) return;
        setLive(true);
        const items: FeedItem[] = logs
          .filter((l) => l.eventName !== "GateSet" && l.eventName !== "Initialized" && l.eventName !== "EIP712DomainChanged")
          .map((l) => {
            const args = (l.args ?? {}) as Record<string, unknown>;
            const amount = (args.amount ?? args.price ?? args.releasedAmount ?? 0n) as bigint;
            return {
              id: `${l.transactionHash}-${l.logIndex}`,
              kind: l.eventName,
              ticketId: args.ticketId !== undefined ? String(args.ticketId) : undefined,
              amount,
              account: (args.claimKey ?? args.buyer ?? args.holder ?? args.to) as string | undefined,
              at: Date.now(),
              txHash: l.transactionHash ?? "",
            };
          });
        if (items.length === 0) return;
        // Move the money now, once per event, so the bar animates as the check-in lands.
        const fresh = items.filter((i) => !seen.has(i.id));
        fresh.forEach((i) => seen.add(i.id));
        if (fresh.length > 0) setTotals((t) => (t ? fresh.reduce(applyLive, t) : t));
        setFeed((f) => sortFeed([...items, ...f.filter((x) => !items.some((i) => i.id === x.id))]).slice(0, FEED_SIZE));
        setPulse(items[0]!);
        timers.push(setTimeout(() => alive && setPulse(null), 2500));
        timers.push(setTimeout(run, 1500), setTimeout(run, 4000), setTimeout(run, 9000));
      },
      onError: () => alive && setLive(false),
    });
    ws.transport
      .getRpcClient()
      .then(() => alive && setLive(true))
      .catch(() => alive && setLive(false));

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      unwatch();
    };
  }, [meta.address, refresh]);

  const paidFlash = pulse?.kind === "CheckedIn";

  return (
    <main className="pt-6 lg:pt-10">
      <div className="flex items-center justify-between text-sm">
        <p className="text-muted">Money board</p>
        <p className={live ? "text-go" : "text-muted"}>{live ? "● Live" : "○ Connecting"}</p>
      </div>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative aspect-[16/10] w-20 shrink-0 overflow-hidden rounded-xl border border-line lg:w-28">
          <Poster src={media?.poster} name={meta.name} sizes="112px" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-4xl">{meta.name}</h1>
          {totals && <p className="mt-1 text-sm text-muted">{STATUS_TEXT[totals.status] ?? totals.status}</p>}
        </div>
      </div>

      <section className="mt-6 rounded-3xl border border-line bg-surface p-5 lg:p-8" aria-labelledby="protected-now">
        <p id="protected-now" className="text-5xl font-semibold tracking-tight tabular-nums lg:text-7xl">
          {totals ? formatNaira(totals.escrowed) : "…"}
        </p>
        <p className="mt-1 text-lg text-muted lg:text-xl">protected right now</p>
        {totals && <p className="mt-4 text-base font-medium lg:text-lg">{guestsLine(totals)}</p>}
      </section>

      <div role="status" aria-live="polite" className="min-h-0">
        {pulse && <p className="mt-4 rounded-2xl bg-go/10 px-4 py-3 text-sm font-medium text-go">{describe(pulse)}</p>}
      </div>

      <section className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3" aria-label="Totals">
        <Tile label="Paid to organizer" value={totals ? formatNaira(totals.released) : "…"} swatch="bg-viz-released" flash={paidFlash} />
        <Tile label="Refunded" value={totals ? formatNaira(totals.refunded) : "…"} swatch="bg-viz-refunded" />
        <Tile label="Guests checked in" value={totals ? `${totals.checkedIn} of ${totals.sold}` : "…"} />
      </section>

      <div className="lg:mt-6 lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-start lg:gap-6">
        <section className="mt-4 rounded-3xl border border-line bg-surface p-5 lg:mt-0 lg:p-6">
          {totals ? <MoneyBar totals={totals} /> : <div className="h-24" />}
          {totals && (
            <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Tickets sold</dt>
                <dd className="font-medium tabular-nums">
                  {totals.sold} / {totals.capacity}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Checked in</dt>
                <dd className="font-medium tabular-nums">{totals.checkedIn}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Withdrawn by organizer</dt>
                <dd className="font-medium tabular-nums">{formatNaira(totals.withdrawn)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Total paid in</dt>
                <dd className="font-medium tabular-nums">{formatNaira(totals.paidIn)}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="mt-6 lg:mt-0">
          <h2 className="text-sm font-semibold">Activity</h2>
          {feed.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              {ENVIO_URL ? "No activity yet." : "Live activity appears here as it happens."}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
              {feed.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <span>{describe(item)}</span>
                  <a
                    href={txUrl(item.txHash)}
                    target="_blank"
                    rel="noopener"
                    className="shrink-0 text-xs text-muted underline underline-offset-2"
                  >
                    {new Date(item.at).toLocaleTimeString("en-NG", { timeStyle: "short" })}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        {totals?.source === "Envio" ? "Totals indexed by Envio HyperIndex; live moments straight from the chain." : null}
        {note ? ` ${note}` : null}
      </p>
    </main>
  );
}
