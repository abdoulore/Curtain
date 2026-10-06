"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { DOOR_STATUS, salesSeries, sortDoorList, type DoorRow, type SalesPoint } from "@/lib/door";
import { fetchDoor } from "@/lib/indexer";
import { browserClient, readTicket } from "@/lib/reads";
import { curtainEventAbi } from "@/lib/abis";

const POLL_MS = 8_000;
const time = new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit" });

/** Door list from the indexer; if it has nothing yet, ticket states read straight from the escrow (no times). */
async function loadDoor(event: Address): Promise<{ rows: DoorRow[]; activity: { kind: string; timestamp: number }[] }> {
  const door = await fetchDoor(event).catch(() => null);
  if (door && door.tickets.length > 0) return { rows: door.tickets, activity: door.activity };
  const sold = Number(await browserClient.readContract({ address: event, abi: curtainEventAbi, functionName: "sold" }));
  const ids = Array.from({ length: Math.min(sold, 60) }, (_, i) => sold - i);
  const infos = await Promise.all(ids.map((id) => readTicket(event, BigInt(id)).catch(() => null)));
  return {
    rows: infos.flatMap((t, i) => (t ? [{ ticketId: ids[i]!, state: t.state, boughtAt: null, checkedInAt: null }] : [])),
    activity: [],
  };
}

export function DoorList({ event }: { event: Address }) {
  const [rows, setRows] = useState<DoorRow[] | null>(null);
  const [activity, setActivity] = useState<{ kind: string; timestamp: number }[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      loadDoor(event)
        .then((d) => {
          if (!alive) return;
          setRows(sortDoorList(d.rows));
          setActivity(d.activity);
          setNow(Math.floor(Date.now() / 1000));
        })
        .catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [event]);

  const series = useMemo(() => salesSeries(activity, now), [activity, now]);

  return (
    <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr] lg:items-start">
      <div className="rounded-3xl border border-line bg-surface p-5">
        <p className="font-semibold">Sales and check-ins</p>
        {series.length > 1 ? (
          <SalesChart series={series} />
        ) : (
          <p className="mt-2 text-sm text-muted">The chart fills in with the first sale.</p>
        )}
      </div>

      <div className="rounded-3xl border border-line bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold">Door list</p>
          <p className="text-xs text-muted">Live</p>
        </div>
        {rows === null ? (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Tickets appear here as they sell.</p>
        ) : (
          <div className="mt-3 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="py-2 pr-2 font-medium">Ticket</th>
                  <th className="py-2 pr-2 font-medium">Status</th>
                  <th className="py-2 pr-2 font-medium">Bought</th>
                  <th className="py-2 font-medium">In at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const status = DOOR_STATUS[r.state] ?? { label: r.state, tone: "muted" as const };
                  return (
                    <tr key={r.ticketId}>
                      <td className="py-2 pr-2 font-mono font-semibold">#{r.ticketId}</td>
                      <td className={`py-2 pr-2 font-medium ${status.tone === "go" ? "text-go" : status.tone === "velvet" ? "text-velvet" : "text-muted"}`}>
                        {status.label}
                      </td>
                      <td className="py-2 pr-2 text-muted">{r.boughtAt ? time.format(new Date(r.boughtAt * 1000)) : ""}</td>
                      <td className="py-2 text-muted">{r.checkedInAt ? clock.format(new Date(r.checkedInAt * 1000)) : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const W = 560;
const H = 220;
const PAD = { top: 16, right: 64, bottom: 28, left: 32 };

/** Two step lines on one axis: tickets sold and checked in, with a crosshair readout. */
function SalesChart({ series }: { series: SalesPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const t0 = series[0]!.t;
  const t1 = series[series.length - 1]!.t;
  const max = Math.max(1, ...series.map((p) => p.sold));
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v / max) * (H - PAD.top - PAD.bottom);
  const step = (key: "sold" | "checkedIn") =>
    series.map((p, i) => (i === 0 ? `M${x(p.t)},${y(p[key])}` : `H${x(p.t)}V${y(p[key])}`)).join("");
  const last = series[series.length - 1]!;
  const ticks = Array.from(new Set([0, Math.round(max / 2), max]));
  const shown = hover === null ? null : series[hover]!;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 0; i < series.length; i++) if (x(series[i]!.t) <= px) best = i;
    setHover(best);
  }

  return (
    <div className="mt-3">
      <ul className="mb-2 flex gap-4 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-viz-held" aria-hidden /> Sold
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-viz-released" aria-hidden /> Checked in
        </li>
      </ul>
      <p className="h-5 text-xs text-muted" aria-live="polite">
        {shown ? `${time.format(new Date(shown.t * 1000))}: ${shown.sold} sold, ${shown.checkedIn} checked in` : ""}
      </p>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-none"
        role="img"
        aria-label={`Tickets sold and checked in over time: ${last.sold} sold, ${last.checkedIn} checked in`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {v}
            </text>
          </g>
        ))}
        <path d={step("sold")} fill="none" className="stroke-viz-held" strokeWidth={2} />
        <path d={step("checkedIn")} fill="none" className="stroke-viz-released" strokeWidth={2} />
        <text x={x(last.t) + 6} y={y(last.sold) + 4} className="fill-foreground text-[11px]">
          {last.sold} sold
        </text>
        <text x={x(last.t) + 6} y={y(last.checkedIn) + (last.checkedIn === last.sold ? 16 : 4)} className="fill-foreground text-[11px]">
          {last.checkedIn} in
        </text>
        <text x={PAD.left} y={H - 8} className="fill-muted text-[11px]">
          {time.format(new Date(t0 * 1000))}
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-muted text-[11px]">
          now
        </text>
        {shown && (
          <g>
            <line x1={x(shown.t)} x2={x(shown.t)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-muted" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(shown.t)} cy={y(shown.sold)} r={4} className="fill-viz-held stroke-surface" strokeWidth={2} />
            <circle cx={x(shown.t)} cy={y(shown.checkedIn)} r={4} className="fill-viz-released stroke-surface" strokeWidth={2} />
          </g>
        )}
      </svg>
    </div>
  );
}
