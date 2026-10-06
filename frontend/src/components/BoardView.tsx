"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, webSocket, type Address } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { monadTestnet, txUrl } from "@/lib/chain";
import type { EventMeta } from "@/lib/events";
import { describe, sortFeed, type FeedItem } from "@/lib/activity";
import { ENVIO_URL, fetchBoard, type ActivityRow } from "@/lib/indexer";
import { formatNaira } from "@/lib/money";
import { useShowMedia } from "@/lib/use-show-media";
import { Poster } from "./Poster";
import { browserClient, EVENT_STATUS } from "@/lib/reads";

const PUBLIC_WSS_URL = "wss://testnet-rpc.monad.xyz";
/** Latest events shown; the totals above always count everything. */
const FEED_SIZE = 50;

type Totals = {
  status: string;
  price: bigint;
  capacity: number;
  sold: number;
  checkedIn: number;
  refundedCount: number | null;
  paidIn: bigint;
  escrowed: bigint;
  released: bigint;
  withdrawn: bigint;
  refunded: bigint;
  source: "Envio" | "chain";
};

const STATUS_TEXT: Record<string, string> = {
  Open: "Selling and admitting",
  Cancelled: "Cancelled: unscanned tickets are refunded",
  Held: "Held: unscanned money released",
  NotHeld: "Not held: unscanned tickets are refunded",
};

const fromRow = (r: ActivityRow): FeedItem => ({
  id: r.id,
  kind: r.kind,
  ticketId: r.ticketId ?? undefined,
  amount: BigInt(r.amount),
  account: r.account ?? undefined,
  at: Number(r.timestamp) * 1000,
  txHash: r.txHash,
});

async function readTotalsFromChain(event: Address): Promise<Totals> {
  const read = <T,>(functionName: string) =>
    browserClient.readContract({ address: event, abi: curtainEventAbi, functionName } as never) as Promise<T>;
  const [status, price, capacity, sold, checkedIn, paidIn, escrowed, released, withdrawn, refunded] = await Promise.all([
    read<number>("status"),
    read<bigint>("price"),
    read<number>("capacity"),
    read<number>("sold"),
    read<number>("checkedIn"),
    read<bigint>("totalPaidIn"),
    read<bigint>("escrowed"),
    read<bigint>("released"),
    read<bigint>("withdrawn"),
    read<bigint>("refunded"),
  ]);
  return {
    status: EVENT_STATUS[status] ?? "Open",
    price,
    capacity: Number(capacity),
    sold: Number(sold),
    checkedIn: Number(checkedIn),
    refundedCount: null,
    paidIn,
    escrowed,
    released,
    withdrawn,
    refunded,
    source: "chain",
  };
}

const SERIES = [
  { key: "released", label: "Paid to organizer", swatch: "bg-viz-released" },
  { key: "escrowed", label: "Held safely", swatch: "bg-viz-held" },
  { key: "refunded", label: "Refunded to buyers", swatch: "bg-viz-refunded" },
] as const;

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
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded bg-line" role="img" aria-label="Ticket money split">
        {total === 0n ? (
          <div className="h-full w-full rounded bg-line" />
        ) : (
          SERIES.map((s) =>
            totals[s.key] > 0n ? (
              <div
                key={s.key}
                className={`${s.swatch} h-full cursor-default first:rounded-l last:rounded-r`}
                style={{ width: `${share(totals[s.key])}%` }}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setHover(s.key)}
              />
            ) : null,
          )
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
          const s = board.show;
          setTotals({
            status: s.status,
            price: BigInt(s.price),
            capacity: Number(s.capacity),
            sold: s.sold,
            checkedIn: s.checkedIn,
            refundedCount: s.refundedCount,
            paidIn: BigInt(s.paidIn),
            escrowed: BigInt(s.escrowed),
            released: BigInt(s.released),
            withdrawn: BigInt(s.withdrawn),
            refunded: BigInt(s.refunded),
            source: "Envio",
          });
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
        setNote("Indexer unavailable, showing totals read directly from the contract.");
      }
    }
    setTotals(await readTotalsFromChain(meta.address));
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
        setFeed((f) => sortFeed([...items, ...f.filter((x) => !items.some((i) => i.id === x.id))]).slice(0, FEED_SIZE));
        setPulse(items[0]!);
        timers.push(setTimeout(() => alive && setPulse(null), 2500));
        timers.push(setTimeout(run, 1500), setTimeout(run, 4000));
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

  return (
    <main className="pt-6 lg:pt-10">
      <div className="flex items-center justify-between text-sm">
        <p className="text-muted">Money board</p>
        <p className={live ? "text-go" : "text-muted"}>{live ? "● Live" : "○ Connecting"}</p>
      </div>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative aspect-[4/5] w-14 shrink-0 overflow-hidden rounded-xl border border-line lg:w-20">
          <Poster src={media?.poster} name={meta.name} sizes="80px" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight lg:text-4xl">{meta.name}</h1>
          {totals && <p className="mt-1 text-sm text-muted">{STATUS_TEXT[totals.status] ?? totals.status}</p>}
        </div>
      </div>

      {pulse && (
        <div className="mt-4 rounded-2xl bg-go/10 px-4 py-3 text-sm font-medium text-go">{describe(pulse)}</div>
      )}

      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SERIES.map((s) => (
          <div key={s.key} className="rounded-2xl border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted uppercase">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.swatch}`} aria-hidden />
              {s.label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{totals ? formatNaira(totals[s.key]) : "…"}</p>
          </div>
        ))}
      </section>

      <div className="lg:mt-6 lg:grid lg:grid-cols-[1.4fr_1fr] lg:items-start lg:gap-6">
      <section className="mt-4 rounded-3xl border border-line bg-surface p-5 lg:mt-0 lg:p-6">
        {totals ? <MoneyBar totals={totals} /> : <div className="h-24" />}
        {totals && (
          <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Tickets sold</dt>
              <dd className="font-medium tabular-nums">{totals.sold} / {totals.capacity}</dd>
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
