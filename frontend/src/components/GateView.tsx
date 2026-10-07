"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "@/lib/abis";
import { friendlyMessage, postJson } from "@/lib/api";
import { monadTestnet } from "@/lib/chain";
import type { EventMeta } from "@/lib/events";
import { checkInUrl, gateCode, gateResultsMessage, issueGateToken, type GateToken } from "@/lib/gate";
import { useDeviceKey, writeDeviceKey } from "@/lib/gate-device";
import { useHydrated } from "@/lib/hooks";
import { formatNaira } from "@/lib/money";
import { browserClient } from "@/lib/reads";
import { VerdictIcon } from "./VerdictIcon";

const ROTATE_MS = 5_000;
const RESULTS_MS = 2_000;
const FLASH_MS = 2_800;
// Green arrives over the public RPC's WebSocket (one log subscription, no keys); red comes from the relay's log.
const PUBLIC_WSS_URL = "wss://testnet-rpc.monad.xyz";

type Entry = { key: string; ok: boolean; ticketId: string; at: number; amount?: bigint; reason?: string };
type ResultRow = { at: number; ok: boolean; ticketId: string; code?: string; hash?: string };

export function GateView({ meta }: { meta: EventMeta }) {
  const hydrated = useHydrated();
  const deviceKey = useDeviceKey(meta.address);
  const device = useMemo(() => (deviceKey ? privateKeyToAccount(deviceKey) : null), [deviceKey]);
  const [paired, setPaired] = useState<{ gate: string; ok: boolean } | null>(null);
  const [token, setToken] = useState<GateToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [flash, setFlash] = useState<Entry | null>(null);
  const [counts, setCounts] = useState<{ checkedIn: number; sold: number } | null>(null);
  const [live, setLive] = useState(false);
  const seen = useRef(new Set<string>());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isPaired = Boolean(device && paired?.gate === device.address && paired.ok);

  function show(entry: Entry) {
    if (seen.current.has(entry.key)) return;
    seen.current.add(entry.key);
    setRecent((r) => [entry, ...r].slice(0, 10));
    setFlash(entry);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }

  // Is this device still a gate for the show? The organizer can remove it from the dashboard.
  useEffect(() => {
    if (!device) return;
    let alive = true;
    const check = () =>
      browserClient
        .readContract({ address: meta.address, abi: curtainEventAbi, functionName: "isGate", args: [device.address] })
        .then((ok) => alive && setPaired({ gate: device.address, ok }))
        .catch(() => {});
    check();
    const id = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [device, meta.address]);

  // A fresh gate code every few seconds, signed here by this device's gate key.
  useEffect(() => {
    if (!device || !isPaired) return;
    let alive = true;
    const makeToken = () =>
      browserClient
        .getBlockNumber()
        .then((block) => issueGateToken(device, meta.address, block))
        .then((t) => {
          if (!alive) return;
          setToken(t);
          setError(null);
        })
        .catch(() => alive && setError("Can't reach Monad. Check this tablet's connection."));
    makeToken();
    const id = setInterval(makeToken, ROTATE_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [device, isPaired, meta.address]);

  // Counters, then live green check-ins straight from the chain.
  useEffect(() => {
    if (!isPaired) return;
    let alive = true;
    const refreshCounts = () =>
      Promise.all([
        browserClient.readContract({ address: meta.address, abi: curtainEventAbi, functionName: "checkedIn" }),
        browserClient.readContract({ address: meta.address, abi: curtainEventAbi, functionName: "sold" }),
      ])
        .then(([checkedIn, sold]) => alive && setCounts({ checkedIn: Number(checkedIn), sold: Number(sold) }))
        .catch(() => {});
    refreshCounts();

    const ws = createPublicClient({
      chain: monadTestnet,
      transport: webSocket(PUBLIC_WSS_URL, { keepAlive: true, reconnect: true }),
    });
    const unwatch = ws.watchContractEvent({
      address: meta.address,
      abi: curtainEventAbi,
      eventName: "CheckedIn",
      onLogs: (logs) => {
        if (!alive) return;
        setLive(true);
        for (const log of logs) {
          show({
            key: log.transactionHash ?? `${log.args.ticketId}`,
            ok: true,
            ticketId: String(log.args.ticketId),
            amount: log.args.amount ?? 0n,
            at: Date.now(),
          });
        }
        refreshCounts();
      },
      onError: () => alive && setLive(false),
    });
    ws.transport
      .getRpcClient()
      .then(() => alive && setLive(true))
      .catch(() => alive && setLive(false));

    return () => {
      alive = false;
      unwatch();
    };
  }, [isPaired, meta.address]);

  // Refused check-ins (and any green the socket missed) from the relay's log. The device signs each request.
  useEffect(() => {
    if (!device || !isPaired) return;
    let alive = true;
    const since = Date.now();
    const poll = async () => {
      const at = Math.floor(Date.now() / 1000);
      const sig = await device.signMessage({ message: gateResultsMessage(meta.address, at) });
      const { results } = await postJson<{ results: ResultRow[] }>("/api/gate/results", { event: meta.address, at, sig });
      if (!alive) return;
      for (const r of [...results].reverse()) {
        if (r.at < since) continue;
        show({
          key: r.hash ?? `${r.ticketId}-${r.at}`,
          ok: r.ok,
          ticketId: r.ticketId,
          at: r.at,
          reason: r.ok ? undefined : friendlyMessage(r.code),
        });
      }
    };
    const id = setInterval(() => poll().catch(() => {}), RESULTS_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [device, isPaired, meta.address]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  if (!hydrated) return null;

  if (!device || (paired?.gate === device.address && !paired.ok)) {
    return (
      <main className="mx-auto max-w-md pt-10 text-center lg:pt-20">
        <h1 className="text-2xl font-semibold">{device ? "This gate was removed" : "Pair this screen as a gate"}</h1>
        <p className="mt-3 text-muted">
          {device
            ? "The organizer removed this device from the show. Pair it again from the organizer dashboard."
            : `On the organizer dashboard for ${meta.name}, tap "Add a gate device" and scan the code with this tablet's camera.`}
        </p>
        <Link href={`/organizer/${meta.slug}`} className="mt-6 inline-block text-sm font-semibold text-velvet underline">
          Open the organizer dashboard
        </Link>
        {device && (
          <button
            onClick={() => writeDeviceKey(meta.address, null)}
            className="mt-4 block w-full text-xs text-muted underline"
          >
            Forget this gate key
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="relative pt-4 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-10 lg:pt-8">
      {flash && (
        <div
          className={`fixed inset-0 z-20 flex flex-col items-center justify-center px-6 text-center text-white ${flash.ok ? "bg-admit" : "bg-deny"}`}
          role="alert"
        >
          <VerdictIcon ok={flash.ok} />
          <p className="mt-6 text-7xl leading-none font-black tracking-tight sm:text-8xl lg:text-[11rem]">
            {flash.ok ? "ADMIT" : "DO NOT ADMIT"}
          </p>
          <p className="mt-8 font-mono text-4xl font-semibold lg:text-6xl">Ticket #{flash.ticketId}</p>
          <p className="mt-4 max-w-xl text-xl lg:text-3xl">
            {flash.ok ? `${formatNaira(flash.amount ?? 0n)} paid to the organizer` : flash.reason}
          </p>
        </div>
      )}

      <section>
        <div className="rounded-3xl border border-line bg-white p-5 lg:p-8">
          {token ? (
            <>
              <QRCodeSVG
                value={checkInUrl(window.location.origin, token)}
                level="L"
                marginSize={2}
                className="mx-auto h-auto w-full max-w-sm lg:max-w-[560px]"
              />
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-200">
                <div key={token.gateNonce} className="gate-drain h-full bg-velvet" />
              </div>
            </>
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-2xl bg-neutral-100" />
          )}
        </div>
        <p className="mt-4 text-center text-base text-muted lg:text-lg">
          Scan with your phone camera, then confirm with your fingerprint or Face ID.
        </p>
        {error && <p className="mt-2 text-center text-sm text-stop">{error}</p>}
      </section>

      <section className="mt-6 lg:mt-0">
        <div className="flex items-center justify-between text-sm">
          <p className="font-medium">Gate {gateCode(device.address)}</p>
          <p className={live ? "text-go" : "text-muted"}>{live ? "● Live" : "○ Connecting"}</p>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-4xl">{meta.name}</h1>

        <div className="mt-6 rounded-3xl border border-line bg-surface p-5 lg:p-6">
          <p className="text-sm text-muted">Checked in</p>
          <p className="mt-1 text-5xl font-semibold lg:text-7xl">
            {counts ? counts.checkedIn : "…"}
            <span className="text-2xl text-muted lg:text-3xl"> / {counts ? counts.sold : "…"}</span>
          </p>
        </div>

        <h2 className="mt-6 text-sm font-semibold">At this gate</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Scans appear here as they happen.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface text-sm lg:text-base">
            {recent.map((r) => (
              <li key={r.key} className="flex items-start justify-between gap-3 px-4 py-3">
                <span className={`font-medium ${r.ok ? "text-go" : "text-stop"}`}>
                  {r.ok ? "✓" : "✕"} Ticket #{r.ticketId}
                </span>
                <span className="text-right text-muted">
                  {r.ok ? formatNaira(r.amount ?? 0n) : r.reason}
                  <span className="block text-xs">
                    {new Date(r.at).toLocaleTimeString("en-NG", { timeStyle: "short" })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-xs text-muted">
          This screen signs each code with its own gate key. The organizer can remove it from the dashboard.
        </p>
      </section>
    </main>
  );
}
