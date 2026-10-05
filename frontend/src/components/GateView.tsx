"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPublicClient, webSocket } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { ApiError, postJson } from "@/lib/api";
import { monadTestnet } from "@/lib/chain";
import type { EventMeta } from "@/lib/events";
import { checkInUrl, type GateToken } from "@/lib/gate";
import { useHydrated } from "@/lib/hooks";
import { formatNaira } from "@/lib/money";
import { browserClient } from "@/lib/reads";

const ROTATE_MS = 5_000;
const FLASH_MS = 2_500;
// Check-ins arrive over the public RPC's WebSocket: one subscription to this event's logs, no polling, no keys.
const PUBLIC_WSS_URL = "wss://testnet-rpc.monad.xyz";
const CODE_KEY = "curtain.gateCode.v1";
const CODE_EVENT = "curtain:gatecode";

function readCode(): string | null {
  try {
    return localStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}
function writeCode(code: string | null) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {}
  window.dispatchEvent(new Event(CODE_EVENT));
}
function subscribeCode(onChange: () => void) {
  window.addEventListener(CODE_EVENT, onChange);
  return () => window.removeEventListener(CODE_EVENT, onChange);
}

type Entry = { ticketId: string; amount: bigint; at: number; hash: string };

export function GateView({ meta }: { meta: EventMeta }) {
  const hydrated = useHydrated();
  const code = useSyncExternalStore(subscribeCode, readCode, () => null);
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState<GateToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [flash, setFlash] = useState<Entry | null>(null);
  const [counts, setCounts] = useState<{ checkedIn: number; sold: number } | null>(null);
  const [live, setLive] = useState(false);

  // A fresh gate code every few seconds.
  useEffect(() => {
    if (!code) return;
    let alive = true;
    const fetchToken = () =>
      postJson<GateToken>("/api/gate/nonce", { event: meta.address, code })
        .then((t) => {
          if (!alive) return;
          setToken(t);
          setError(null);
        })
        .catch((e) => {
          if (!alive) return;
          if (e instanceof ApiError && e.code === "GateUnauthorized") writeCode(null);
          setError(e instanceof Error ? e.message : "Could not reach the server");
        });
    fetchToken();
    const id = setInterval(fetchToken, ROTATE_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code, meta.address]);

  // Counters, then live check-ins.
  useEffect(() => {
    if (!code) return;
    let alive = true;
    const refreshCounts = () =>
      Promise.all([
        browserClient.readContract({ address: meta.address, abi: curtainEventAbi, functionName: "checkedIn" }),
        browserClient.readContract({ address: meta.address, abi: curtainEventAbi, functionName: "sold" }),
      ])
        .then(([checkedIn, sold]) => alive && setCounts({ checkedIn: Number(checkedIn), sold: Number(sold) }))
        .catch(() => {});
    refreshCounts();

    const ws = createPublicClient({ chain: monadTestnet, transport: webSocket(PUBLIC_WSS_URL, { keepAlive: true, reconnect: true }) });
    let clearFlash: ReturnType<typeof setTimeout> | undefined;
    const unwatch = ws.watchContractEvent({
      address: meta.address,
      abi: curtainEventAbi,
      eventName: "CheckedIn",
      onLogs: (logs) => {
        if (!alive) return;
        setLive(true);
        for (const log of logs) {
          const entry: Entry = {
            ticketId: String(log.args.ticketId),
            amount: log.args.amount ?? 0n,
            at: Date.now(),
            hash: log.transactionHash ?? "",
          };
          setRecent((r) => [entry, ...r].slice(0, 8));
          setFlash(entry);
          clearTimeout(clearFlash);
          clearFlash = setTimeout(() => alive && setFlash(null), FLASH_MS);
        }
        refreshCounts();
      },
      onError: () => alive && setLive(false),
    });
    // The subscription opens asynchronously; mark the feed live once the socket is up.
    ws.transport
      .getRpcClient()
      .then(() => alive && setLive(true))
      .catch(() => alive && setLive(false));

    return () => {
      alive = false;
      clearTimeout(clearFlash);
      unwatch();
    };
  }, [code, meta.address]);

  if (!hydrated) return null;

  if (!code) {
    return (
      <main className="pt-10">
        <h1 className="text-2xl font-semibold">Open the gate for {meta.name}</h1>
        <p className="mt-2 text-muted">Enter the gate code the organizer gave you.</p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) writeCode(draft.trim());
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            className="flex-1 rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-velvet"
            placeholder="Gate code"
          />
          <button className="rounded-xl bg-velvet px-5 font-semibold text-velvet-ink">Open</button>
        </form>
        {error && <p className="mt-3 text-sm text-stop">{error}</p>}
      </main>
    );
  }

  return (
    <main className="relative pt-4">
      {flash && (
        <div className="fixed inset-0 z-10 flex flex-col items-center justify-center bg-go text-white">
          <p className="text-7xl">✓</p>
          <p className="mt-4 text-4xl font-semibold">Ticket #{flash.ticketId}</p>
          <p className="mt-2 text-lg">Welcome in. {formatNaira(flash.amount)} released.</p>
        </div>
      )}

      <div className="flex items-center justify-between text-sm">
        <p className="font-medium">{meta.name}</p>
        <p className={live ? "text-go" : "text-muted"}>{live ? "● Live" : "○ Connecting"}</p>
      </div>

      <div className="mt-4 rounded-3xl border border-line bg-white p-6">
        {token ? (
          <>
            <QRCodeSVG
              value={checkInUrl(window.location.origin, token)}
              level="M"
              marginSize={2}
              className="mx-auto h-auto w-full max-w-sm"
            />
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-neutral-200">
              <div key={token.gateNonce} className="gate-drain h-full bg-velvet" />
            </div>
          </>
        ) : (
          <div className="aspect-square w-full animate-pulse rounded-2xl bg-neutral-100" />
        )}
      </div>
      <p className="mt-3 text-center text-sm text-muted">
        Scan with your phone camera, then confirm with your fingerprint or Face ID.
      </p>
      {error && <p className="mt-2 text-center text-sm text-stop">{error}</p>}

      <div className="mt-6 flex items-baseline justify-between">
        <p className="text-sm text-muted">Checked in</p>
        <p className="text-2xl font-semibold">
          {counts ? counts.checkedIn : "…"}
          <span className="text-base text-muted"> / {counts ? counts.sold : "…"}</span>
        </p>
      </div>
      {recent.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
          {recent.map((r) => (
            <li key={`${r.ticketId}-${r.at}`} className="flex justify-between px-4 py-2.5">
              <span className="font-medium">Ticket #{r.ticketId}</span>
              <span className="text-muted">
                {formatNaira(r.amount)} · {new Date(r.at).toLocaleTimeString("en-NG", { timeStyle: "short" })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button onClick={() => writeCode(null)} className="mx-auto mt-6 block text-xs text-muted underline">
        Close this gate
      </button>
    </main>
  );
}
