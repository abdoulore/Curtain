"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createWalletClient,
  custom,
  getAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
  type TypedDataDefinition,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { curtainEventAbi } from "@/lib/abis";
import { unlock } from "@/lib/account";
import { describe, sortFeed, type FeedItem } from "@/lib/activity";
import { postJson } from "@/lib/api";
import { STATUS_TEXT } from "@/lib/board";
import { monadTestnet, PUBLIC_RPC_URL, RP_ID, txUrl } from "@/lib/chain";
import { PlainError, plainError } from "@/lib/errors";
import { eventPath, type EventMeta } from "@/lib/events";
import { gateCode, pairingUrl } from "@/lib/gate";
import { useAccount, useHydrated } from "@/lib/hooks";
import { fetchBoard, fetchGates } from "@/lib/indexer";
import { formatNaira, nairaToUsdcUnits } from "@/lib/money";
import { organizerTypedData, type OrganizerAction } from "@/lib/organizer";
import { createdShow, pairedGates, rememberPairedGate } from "@/lib/organizer-local";
import { browserClient, EVENT_STATUS } from "@/lib/reads";
import { DoorList } from "./DoorList";
import { SignInButton } from "./SignInButton";

type State = {
  organizer: Address;
  status: string;
  sold: number;
  checkedIn: number;
  escrowed: bigint;
  released: bigint;
  withdrawn: bigint;
  refunded: bigint;
  available: bigint;
};

async function readState(event: Address): Promise<State> {
  const read = <T,>(functionName: string) =>
    browserClient.readContract({ address: event, abi: curtainEventAbi, functionName } as never) as Promise<T>;
  const [organizer, status, sold, checkedIn, escrowed, released, withdrawn, refunded, available] = await Promise.all([
    read<Address>("organizer"),
    read<number>("status"),
    read<number>("sold"),
    read<number>("checkedIn"),
    read<bigint>("escrowed"),
    read<bigint>("released"),
    read<bigint>("withdrawn"),
    read<bigint>("refunded"),
    read<bigint>("availableToWithdraw"),
  ]);
  return {
    organizer,
    status: EVENT_STATUS[status] ?? "Open",
    sold: Number(sold),
    checkedIn: Number(checkedIn),
    escrowed,
    released,
    withdrawn,
    refunded,
    available,
  };
}

/** Gate devices allowed on the show: the indexer's list plus the ones paired from this device, checked onchain. */
async function readGates(event: Address): Promise<Address[]> {
  const candidates = new Set<string>([...(await fetchGates(event).catch(() => [])), ...pairedGates(event)].map((g) => getAddress(g)));
  const checks = await Promise.all(
    [...candidates].map(async (g) => {
      const ok = await browserClient
        .readContract({ address: event, abi: curtainEventAbi, functionName: "isGate", args: [g as Address] })
        .catch(() => false);
      return ok ? (g as Address) : null;
    }),
  );
  return checks.filter((g): g is Address => g !== null);
}

type Signer = { address: Address; sign: (td: TypedDataDefinition) => Promise<Hex> };

const deadlineFromNow = (seconds: number) => BigInt(Math.floor(Date.now() / 1000) + seconds);
const noSubscribe = () => () => {};

/** The show this device just created, for the first half hour, as JSON so the snapshot is stable. */
function recentCreatedSnapshot(event: Address): string {
  const c = createdShow(event);
  return c && Date.now() - c.at < 30 * 60 * 1000 ? JSON.stringify(c) : "null";
}

function injected(): EIP1193Provider | undefined {
  return (globalThis as { ethereum?: EIP1193Provider }).ethereum;
}

/** Hidden fallback: an organizer key held in a browser wallet. Puts the wallet on Monad testnet first. */
async function walletSigner(): Promise<Signer> {
  const provider = injected();
  if (!provider) throw new PlainError("No browser wallet found on this device.");
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  if (!account) throw new PlainError("The wallet didn't share an account.");
  const chainId = `0x${monadTestnet.id.toString(16)}` as const;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: monadTestnet.name,
          nativeCurrency: monadTestnet.nativeCurrency,
          rpcUrls: [PUBLIC_RPC_URL],
          blockExplorerUrls: [monadTestnet.blockExplorers.default.url],
        },
      ],
    });
  }
  const address = getAddress(account);
  const client = createWalletClient({ account: address, chain: monadTestnet, transport: custom(provider) });
  return { address, sign: (td) => client.signTypedData({ account: address, ...td } as never) };
}

type Tab = "overview" | "guests" | "gates";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "guests", label: "Guests" },
  { id: "gates", label: "Gates" },
];

function tabFromHash(): Tab {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return h === "guests" || h === "gates" ? h : "overview";
}

/** The last few things that happened at this show, newest first. */
function RecentActivity({ event }: { event: Address }) {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchBoard(event)
      .then((b) =>
        sortFeed(
          b.activity.map((r) => ({
            id: r.id,
            kind: r.kind,
            ticketId: r.ticketId ?? undefined,
            amount: BigInt(r.amount),
            account: r.account ?? undefined,
            at: Number(r.timestamp) * 1000,
            txHash: r.txHash,
          })),
        ).slice(0, 5),
      )
      .then((list) => alive && setItems(list))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [event]);

  if (items === null) return <div className="mt-4 h-24 animate-pulse rounded-2xl bg-line/60" />;
  if (items.length === 0) return <p className="mt-3 text-sm text-muted">Sales and check-ins appear here as they happen.</p>;
  return (
    <ul className="mt-3 divide-y divide-line">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-4 py-3 text-sm">
          <span>{describe(item)}</span>
          <a href={txUrl(item.txHash)} target="_blank" rel="noopener" className="shrink-0 text-xs text-muted underline underline-offset-2">
            {new Date(item.at).toLocaleTimeString("en-NG", { timeStyle: "short" })}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function OrganizerView({ meta }: { meta: EventMeta }) {
  const hydrated = useHydrated();
  const account = useAccount();
  const [state, setState] = useState<State | null>(null);
  const [gates, setGates] = useState<Address[] | null>(null);
  const [wallet, setWallet] = useState<Signer | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const [pairing, setPairing] = useState<{ gateKey: Hex; gate: Address } | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [copied, setCopied] = useState(false);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, guests: null, gates: null });
  const recent = JSON.parse(
    useSyncExternalStore(noSubscribe, () => recentCreatedSnapshot(meta.address), () => "null"),
  ) as ReturnType<typeof createdShow> | null;

  const refresh = useCallback(() => readState(meta.address).then(setState), [meta.address]);
  const refreshGates = useCallback(() => readGates(meta.address).then(setGates), [meta.address]);
  useEffect(() => {
    refresh().catch(() => setNotice({ ok: false, text: "Couldn't load this show." }));
    refreshGates().catch(() => setGates([]));
  }, [refresh, refreshGates]);

  // The open tab follows the address hash, so #gates or #guests can be shared and survives a reload.
  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function selectTab(next: Tab, focus = false) {
    setTab(next);
    history.replaceState(null, "", next === "overview" ? window.location.pathname : `#${next}`);
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabKey(e: React.KeyboardEvent, index: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (e.key === "Home") return selectTab(TABS[0]!.id, true);
    if (e.key === "End") return selectTab(TABS[TABS.length - 1]!.id, true);
    if (!step) return;
    e.preventDefault();
    selectTab(TABS[(index + step + TABS.length) % TABS.length]!.id, true);
  }

  const organizer = state ? getAddress(state.organizer) : null;
  const passkeyIsOrganizer = Boolean(account && organizer && getAddress(account.address) === organizer);
  const walletIsOrganizer = Boolean(wallet && organizer && wallet.address === organizer);
  const canAct = passkeyIsOrganizer || walletIsOrganizer;

  /** Signs with the organizer's passkey (one fingerprint or Face ID prompt) or the fallback wallet, then relays. */
  async function run(label: string, action: OrganizerAction): Promise<boolean> {
    setBusy(label);
    setNotice(null);
    try {
      let signer: Signer;
      if (walletIsOrganizer && wallet) signer = wallet;
      else if (account) {
        // The passkey prompt opens straight from the tap, before any network call.
        const { signer: local } = await unlock(account);
        signer = { address: local.address, sign: (td) => local.signTypedData(td as never) };
      } else throw new PlainError("Sign in with the organizer's passkey first.");

      const nonce = await browserClient.readContract({
        address: meta.address,
        abi: curtainEventAbi,
        functionName: "nonces",
        args: [signer.address],
      });
      const deadline = deadlineFromNow(15 * 60);
      const sig = await signer.sign(organizerTypedData(meta.address, action, nonce, deadline));
      const { hash } = await postJson<{ hash: string }>("/api/relay/organizer", {
        ...action,
        event: meta.address,
        nonce,
        deadline,
        sig,
      });
      setNotice({ ok: true, text: `${label}.`, hash });
      await refresh();
      return true;
    } catch (e) {
      setNotice({ ok: false, text: plainError(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function withdraw() {
    const units = amount.trim() ? nairaToUsdcUnits(amount) : (state?.available ?? 0n);
    if (units === null) return setNotice({ ok: false, text: "Type an amount in naira, or leave it empty to withdraw everything." });
    if (units === 0n) return setNotice({ ok: false, text: "Nothing is ready to withdraw yet." });
    if (state && units > state.available) return setNotice({ ok: false, text: `Only ${formatNaira(state.available)} is ready.` });
    if (await run(`Withdrew ${formatNaira(units)}`, { kind: "withdraw", amount: units })) setAmount("");
  }

  async function addGate() {
    const gateKey = generatePrivateKey();
    const gate = privateKeyToAccount(gateKey).address;
    if (await run(`Gate ${gateCode(gate)} added`, { kind: "setGate", gate, allowed: true })) {
      rememberPairedGate(meta.address, gate);
      setPairing({ gateKey, gate });
      refreshGates();
    }
  }

  async function removeGate(gate: Address) {
    if (!confirm(`Remove gate ${gateCode(gate)}? That screen stops admitting people right away.`)) return;
    if (await run(`Gate ${gateCode(gate)} removed`, { kind: "setGate", gate, allowed: false })) refreshGates();
  }

  const naira = (v: bigint | undefined) => (v === undefined ? "…" : formatNaira(v));
  const locked = !canAct || busy !== null;
  const ticketUrl = `https://${RP_ID}${eventPath(meta)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(ticketUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  const noticeLine = notice && (
    <p role={notice.ok ? "status" : "alert"} className={`mt-4 text-sm ${notice.ok ? "text-go" : "text-stop"}`}>
      {notice.ok ? "✓ " : ""}
      {notice.text}{" "}
      {notice.hash && (
        <a href={txUrl(notice.hash)} target="_blank" rel="noopener" className="underline">
          Proof
        </a>
      )}
    </p>
  );

  return (
    <main className="pt-6 lg:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <Link href="/organizer" className="text-sm text-muted hover:text-foreground">
            Your shows
          </Link>
          <h1 className="mt-1 font-display text-4xl leading-[1.05] text-balance lg:text-5xl">{meta.name}</h1>
          <p className="mt-2 text-sm text-muted">{state ? (STATUS_TEXT[state.status] ?? state.status) : "…"}</p>
        </div>
        <p className="text-sm text-muted">
          {!hydrated
            ? null
            : canAct
              ? walletIsOrganizer && !passkeyIsOrganizer
                ? "Signed in with your wallet"
                : `Signed in as ${account?.name || "the organizer"}`
              : null}
        </p>
      </div>

      {hydrated && !canAct && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
          <div>
            <p className="font-semibold">{account ? "Sign in as this show's organizer" : "Sign in to manage this show"}</p>
            <p className="text-sm text-muted">Use the passkey you created the show with.</p>
          </div>
          {account ? <SignInButton variant="link" label="Sign in with another passkey" /> : <SignInButton />}
        </div>
      )}

      {recent && (
        <p className="mt-6 rounded-2xl bg-go/10 px-4 py-3 text-sm">
          <span className="font-semibold text-go">Your show is live.</span> Share the ticket page and pair a gate before
          doors open.{" "}
          <a href={txUrl(recent.hash)} target="_blank" rel="noopener" className="underline">
            Proof it was created
          </a>
        </p>
      )}

      <div role="tablist" aria-label="Show sections" className="mt-8 flex gap-1 border-b border-line">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => selectTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold ${
              tab === t.id ? "border-velvet text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
            {t.id === "gates" && gates !== null && <span className="ml-1.5 text-muted tabular-nums">{gates.length}</span>}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <section role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" className="pt-8">
          <div className="lg:grid lg:grid-cols-[1.2fr_1fr] lg:gap-14">
            <div>
              <p className="text-6xl font-semibold tracking-tight tabular-nums lg:text-7xl">{naira(state?.available)}</p>
              <p className="mt-1 text-lg text-muted">ready to withdraw</p>
              <p className="mt-4 text-base font-medium">{state ? `${state.checkedIn} checked in · ${state.sold} sold` : "…"}</p>

              <fieldset disabled={locked} className="mt-8 max-w-md min-w-0 disabled:opacity-60">
                <legend className="sr-only">Withdraw</legend>
                <div className="flex gap-2">
                  <div className="flex min-w-0 flex-1 items-center rounded-2xl bg-surface px-4 ring-1 ring-line focus-within:ring-velvet">
                    <span className="text-muted">₦</span>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                      inputMode="decimal"
                      aria-label="Amount in naira"
                      placeholder={state ? formatNaira(state.available).replace("₦", "") : "0"}
                      className="min-w-0 flex-1 bg-transparent py-3.5 pl-1 text-base outline-none"
                    />
                  </div>
                  <button onClick={withdraw} className="rounded-2xl bg-velvet px-6 font-semibold text-velvet-ink">
                    {busy?.startsWith("Withdrew") ? "Confirm…" : "Withdraw"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Leave it empty to withdraw everything ready. Paid to the payout account fixed when the show was created.
                  {state && state.withdrawn > 0n ? ` You've withdrawn ${formatNaira(state.withdrawn)} so far.` : ""}
                </p>
              </fieldset>
              {noticeLine}
            </div>

            <dl className="mt-10 divide-y divide-line border-y border-line lg:mt-2">
              {(
                [
                  ["Protected", state?.escrowed, "bg-viz-held"],
                  ["Paid to organizer", state?.released, "bg-viz-released"],
                  ["Refunded", state?.refunded, "bg-viz-refunded"],
                ] as const
              ).map(([label, value, swatch]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-4">
                  <dt className="flex items-center gap-2.5 text-muted">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${swatch}`} aria-hidden />
                    {label}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">{naira(value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="mt-14 grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
            <div>
              <h2 className="text-lg font-semibold">Ticket page</h2>
              <p className="mt-1 truncate font-mono text-sm text-muted">{ticketUrl.replace("https://", "")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={copyLink} className="rounded-2xl bg-foreground px-5 py-3 text-sm font-semibold text-background">
                  {copied ? "Link copied" : "Copy link"}
                </button>
                <Link href={eventPath(meta)} className="rounded-2xl px-5 py-3 text-sm font-semibold ring-1 ring-line hover:bg-surface">
                  Open ticket page
                </Link>
                <Link href={`/board/${meta.slug}`} className="rounded-2xl px-5 py-3 text-sm font-semibold ring-1 ring-line hover:bg-surface">
                  Money board
                </Link>
              </div>
            </div>
            <div>
              <h2 className="text-lg font-semibold">Recent activity</h2>
              <RecentActivity event={meta.address} />
            </div>
          </div>

          <section aria-labelledby="cancel-heading" className="mt-16 border-t border-line pt-8">
            <h2 id="cancel-heading" className="font-semibold text-stop">
              Cancel the show
            </h2>
            <fieldset disabled={locked} className="mt-2 max-w-xl min-w-0 disabled:opacity-60">
              <legend className="sr-only">Cancel the show</legend>
              <p className="text-sm text-muted">
                Every ticket that wasn&apos;t checked in is refunded automatically. Money for checked-in tickets stays paid to
                you. This can&apos;t be undone.
              </p>
              <button
                onClick={() =>
                  confirm("Cancel the show? Every ticket that wasn't checked in will be refunded.") &&
                  run("Show cancelled", { kind: "cancel" })
                }
                className="mt-4 rounded-2xl px-5 py-3 text-sm font-semibold text-stop ring-1 ring-stop"
              >
                {busy === "Show cancelled" ? "Confirm with your fingerprint" : "Cancel the show"}
              </button>
            </fieldset>

            <details className="mt-8 text-xs text-muted">
              <summary className="cursor-pointer">Use a browser wallet instead</summary>
              <p className="mt-2">For an organizer account held in a wallet such as MetaMask.</p>
              <button
                onClick={() =>
                  walletSigner()
                    .then(setWallet)
                    .catch((e) => setNotice({ ok: false, text: plainError(e) }))
                }
                className="mt-2 underline"
              >
                {wallet ? `Connected ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect a wallet"}
              </button>
            </details>
          </section>
        </section>
      )}

      {tab === "guests" && (
        <section role="tabpanel" id="panel-guests" aria-labelledby="tab-guests" className="pt-2">
          <DoorList event={meta.address} />
        </section>
      )}

      {tab === "gates" && (
        <section role="tabpanel" id="panel-gates" aria-labelledby="tab-gates" className="pt-8">
          <div className="lg:grid lg:grid-cols-[1.2fr_1fr] lg:gap-14">
            <div>
              {gates === null ? (
                <div className="h-24 animate-pulse rounded-2xl bg-line/60" />
              ) : gates.length === 0 ? (
                <p className="text-muted">No gates yet. Add the tablet or phone that will stand at the door.</p>
              ) : (
                <ul className="divide-y divide-line rounded-2xl bg-surface ring-1 ring-line">
                  {gates.map((g) => (
                    <li key={g} className="flex items-center justify-between gap-4 px-5 py-4">
                      <span>
                        <span className="block text-xs text-muted">Gate</span>
                        <span className="font-mono text-lg font-semibold tracking-wider">{gateCode(g)}</span>
                      </span>
                      <button
                        onClick={() => removeGate(g)}
                        disabled={locked}
                        className="rounded-xl px-3 py-2 text-sm font-semibold text-stop hover:bg-background disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={addGate}
                  disabled={locked}
                  className="rounded-2xl bg-velvet px-5 py-3 text-sm font-semibold text-velvet-ink disabled:opacity-50"
                >
                  {busy?.startsWith("Gate") ? "Confirm with your fingerprint" : "Add a gate device"}
                </button>
                <Link href={`/gate/${meta.slug}`} className="rounded-2xl px-5 py-3 text-sm font-semibold ring-1 ring-line hover:bg-surface">
                  Open the gate screen
                </Link>
              </div>
              {noticeLine}
            </div>
            <div className="mt-10 lg:mt-0">
              <h2 className="text-lg font-semibold">Pairing a gate</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-muted">
                <li>Tap Add a gate device and confirm with your fingerprint.</li>
                <li>Scan the code that appears with the tablet or phone that will stand at the door.</li>
                <li>Its gate screen opens with the same gate code. Guests scan it to check in.</li>
                <li>Remove a gate any time; it stops admitting people straight away.</li>
              </ol>
            </div>
          </div>
        </section>
      )}

      {pairing && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-background p-6 text-center">
            <p className="text-sm text-muted">Pair a gate for {meta.name}</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-wider">{gateCode(pairing.gate)}</p>
            <div className="mx-auto mt-4 max-w-xs rounded-2xl bg-white p-3">
              <QRCodeSVG value={pairingUrl(window.location.origin, meta.address, pairing.gateKey)} level="M" marginSize={1} className="h-auto w-full" />
            </div>
            <p className="mt-4 text-sm text-muted">
              Scan this with the camera of the tablet or phone at the door. It opens the gate screen, showing the same
              code, ready to scan tickets. Close this once the tablet shows the gate screen. You can remove a gate any
              time.
            </p>
            <button
              onClick={() => setPairing(null)}
              className="mt-5 w-full rounded-2xl bg-velvet px-5 py-3 font-semibold text-velvet-ink"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
