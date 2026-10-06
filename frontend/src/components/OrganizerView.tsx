"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
import { friendlyPasskeyError, unlock } from "@/lib/account";
import { ApiError, postJson } from "@/lib/api";
import { monadTestnet, PUBLIC_RPC_URL, txUrl } from "@/lib/chain";
import { eventPath, type EventMeta } from "@/lib/events";
import { gateCode, pairingUrl } from "@/lib/gate";
import { useAccount, useHydrated } from "@/lib/hooks";
import { fetchGates } from "@/lib/indexer";
import { formatNaira, nairaToUsdcUnits } from "@/lib/money";
import { organizerTypedData, type OrganizerAction } from "@/lib/organizer";
import { createdShow, pairedGates, rememberPairedGate } from "@/lib/organizer-local";
import { browserClient, EVENT_STATUS } from "@/lib/reads";
import { ShareShow } from "./ShareShow";
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
  if (!provider) throw new Error("No browser wallet found on this device.");
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  if (!account) throw new Error("The wallet didn't share an account.");
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
  const recent = JSON.parse(
    useSyncExternalStore(noSubscribe, () => recentCreatedSnapshot(meta.address), () => "null"),
  ) as ReturnType<typeof createdShow> | null;

  const refresh = useCallback(() => readState(meta.address).then(setState), [meta.address]);
  const refreshGates = useCallback(() => readGates(meta.address).then(setGates), [meta.address]);
  useEffect(() => {
    refresh().catch(() => setNotice({ ok: false, text: "Couldn't load this show." }));
    refreshGates().catch(() => setGates([]));
  }, [refresh, refreshGates]);

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
      } else throw new Error("Sign in with the organizer's passkey first.");

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
      const text = e instanceof ApiError ? e.message : e instanceof Error ? friendlyPasskeyError(e) : "Something went wrong";
      setNotice({ ok: false, text });
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

  return (
    <main className="pt-6 lg:pt-10">
      <p className="text-sm text-muted">Organizer</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-4xl">{meta.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {state ? (state.status === "Open" ? "Selling and admitting" : state.status) : "…"} ·{" "}
        <Link href={eventPath(meta)} className="underline">
          Ticket page
        </Link>{" "}
        ·{" "}
        <Link href={`/board/${meta.slug}`} className="underline">
          Money board
        </Link>{" "}
        ·{" "}
        <Link href={`/gate/${meta.slug}`} className="underline">
          Gate screen
        </Link>
      </p>

      {recent && (
        <div className="mt-4 rounded-2xl border border-go/40 bg-surface p-4 text-sm">
          <p className="font-semibold text-go">Your show is live.</p>
          <p className="mt-1 text-muted">
            Share the ticket page below so people can buy, and pair a gate device before doors open.{" "}
            <a href={txUrl(recent.hash)} target="_blank" rel="noopener" className="underline">
              Proof it was created
            </a>
          </p>
        </div>
      )}

      <ShareShow meta={meta} />

      <div className="mt-6 lg:grid lg:grid-cols-[1.3fr_1fr] lg:items-start lg:gap-6">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-3xl border border-line bg-surface p-5 sm:col-span-2">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Ready to withdraw</p>
            <p className="mt-2 text-4xl font-semibold">{naira(state?.available)}</p>
            <p className="mt-1 text-sm text-muted">Released as people walked in, minus what you have withdrawn.</p>
          </div>
          {[
            ["Paid at the door", state?.released],
            ["Held for unscanned tickets", state?.escrowed],
            ["Withdrawn", state?.withdrawn],
            ["Refunded to buyers", state?.refunded],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted uppercase">{label as string}</p>
              <p className="mt-1 text-xl font-semibold">{naira(value as bigint | undefined)}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-line bg-surface p-4 sm:col-span-2">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Tickets</p>
            <p className="mt-1 text-xl font-semibold">{state ? `${state.checkedIn} checked in of ${state.sold} sold` : "…"}</p>
          </div>
        </section>

        <section className="mt-6 space-y-4 lg:mt-0">
          <div className="rounded-3xl border border-line bg-surface p-5">
            {!hydrated ? null : canAct ? (
              <p className="font-semibold text-go">
                {walletIsOrganizer && !passkeyIsOrganizer ? "Signed in with your wallet" : `Signed in as ${account?.name || "the organizer"}`}
              </p>
            ) : account ? (
              <>
                <p className="font-semibold">This passkey isn&apos;t the organizer of this show</p>
                <p className="mt-1 text-sm text-muted">Sign in with the passkey you created the show with.</p>
                <div className="mt-3">
                  <SignInButton variant="link" label="Sign in with another passkey" />
                </div>
              </>
            ) : (
              <>
                <p className="font-semibold">Sign in to manage this show</p>
                <p className="mt-1 mb-3 text-sm text-muted">Use the passkey you created the show with.</p>
                <SignInButton />
              </>
            )}
            <p className="mt-2 text-xs text-muted">
              You confirm each action with your fingerprint or Face ID; Curtain pays the network fee.
            </p>
          </div>

          <fieldset disabled={!canAct || busy !== null} className="min-w-0 space-y-4 disabled:opacity-60">
            <div className="rounded-3xl border border-line bg-surface p-5">
              <p className="font-semibold">Withdraw</p>
              <div className="mt-3 flex gap-2">
                <div className="flex min-w-0 flex-1 items-center rounded-xl border border-line bg-background px-3 focus-within:border-velvet">
                  <span className="text-muted">₦</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                    inputMode="decimal"
                    aria-label="Amount in naira"
                    placeholder={state ? formatNaira(state.available).replace("₦", "") : "0"}
                    className="min-w-0 flex-1 bg-transparent py-2.5 pl-1 outline-none"
                  />
                </div>
                <button onClick={withdraw} className="rounded-xl bg-velvet px-4 font-semibold text-velvet-ink">
                  {busy?.startsWith("Withdrew") ? "Confirm…" : "Withdraw"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                In naira at the display rate. Paid to the payout account fixed when the show was created. Leave it
                empty to withdraw everything ready.
              </p>
            </div>

            <div className="rounded-3xl border border-line bg-surface p-5">
              <p className="font-semibold">Gate devices</p>
              {gates === null ? (
                <p className="mt-2 text-sm text-muted">Checking…</p>
              ) : gates.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No gates yet. Add the tablet or phone that will stand at the door.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
                  {gates.map((g) => (
                    <li key={g} className="flex items-center justify-between px-4 py-2.5">
                      <span className="font-mono font-semibold tracking-wider">{gateCode(g)}</span>
                      <button onClick={() => removeGate(g)} className="text-sm text-stop underline">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={addGate} className="mt-3 w-full rounded-xl border border-line px-3 py-2.5 text-sm font-semibold">
                {busy?.startsWith("Gate") ? "Confirm…" : "Add a gate device"}
              </button>
            </div>

            <div className="rounded-3xl border border-stop/40 bg-surface p-5">
              <p className="font-semibold">Cancel the show</p>
              <p className="mt-1 text-sm text-muted">Every unscanned ticket is refunded automatically. Scanned tickets stay paid.</p>
              <button
                onClick={() => confirm("Cancel the show? Unscanned tickets will be refunded.") && run("Show cancelled", { kind: "cancel" })}
                className="mt-3 w-full rounded-xl border border-stop px-3 py-2.5 text-sm font-semibold text-stop"
              >
                {busy === "Show cancelled" ? "Confirm…" : "Cancel the show"}
              </button>
            </div>
          </fieldset>

          {notice && (
            <p className={`text-sm ${notice.ok ? "text-go" : "text-stop"}`}>
              {notice.text}{" "}
              {notice.hash && (
                <a href={txUrl(notice.hash)} target="_blank" rel="noopener" className="underline">
                  Proof
                </a>
              )}
            </p>
          )}

          <details className="text-xs text-muted">
            <summary className="cursor-pointer">Use a browser wallet instead</summary>
            <p className="mt-2">For an organizer account held in a wallet such as MetaMask.</p>
            <button
              onClick={() =>
                walletSigner()
                  .then(setWallet)
                  .catch((e) => setNotice({ ok: false, text: e instanceof Error ? e.message : "Wallet unavailable" }))
              }
              className="mt-2 underline"
            >
              {wallet ? `Connected ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : "Connect a wallet"}
            </button>
          </details>
        </section>
      </div>

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
              code, ready to scan tickets. Anyone who scans this can run the gate, so close it once the tablet shows the
              gate screen. You can remove a gate any time.
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
