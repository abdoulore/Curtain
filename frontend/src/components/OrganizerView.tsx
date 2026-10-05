"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, getAddress, isAddress, type Address, type EIP1193Provider } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { ApiError, postJson } from "@/lib/api";
import { monadTestnet, PUBLIC_RPC_URL, txUrl } from "@/lib/chain";
import type { EventMeta } from "@/lib/events";
import { formatNaira } from "@/lib/money";
import { organizerTypedData, type OrganizerAction } from "@/lib/organizer";
import { browserClient, EVENT_STATUS } from "@/lib/reads";

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

function injected(): EIP1193Provider | undefined {
  return (globalThis as { ethereum?: EIP1193Provider }).ethereum;
}

/** Puts the browser wallet on Monad testnet; EIP-712 signatures carry the chain id. */
async function switchToMonad(provider: EIP1193Provider) {
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
}

export function OrganizerView({ meta }: { meta: EventMeta }) {
  const [state, setState] = useState<State | null>(null);
  const [wallet, setWallet] = useState<Address | null>(null);
  const [amount, setAmount] = useState("");
  const [gate, setGate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);

  const refresh = useCallback(() => readState(meta.address).then(setState), [meta.address]);
  useEffect(() => {
    refresh().catch(() => setNotice({ ok: false, text: "Couldn't load this show." }));
  }, [refresh]);

  const isOrganizer = Boolean(wallet && state && getAddress(wallet) === getAddress(state.organizer));

  async function connect() {
    const provider = injected();
    if (!provider) {
      setNotice({ ok: false, text: "Open this page in a browser with a wallet (for example MetaMask) holding the organizer account." });
      return;
    }
    const [account] = await provider.request({ method: "eth_requestAccounts" });
    if (account) setWallet(getAddress(account));
  }

  async function run(label: string, action: OrganizerAction) {
    const provider = injected();
    if (!provider || !wallet) return;
    setBusy(label);
    setNotice(null);
    try {
      await switchToMonad(provider);
      const client = createWalletClient({ account: wallet, chain: monadTestnet, transport: custom(provider) });
      const nonce = await browserClient.readContract({
        address: meta.address,
        abi: curtainEventAbi,
        functionName: "nonces",
        args: [wallet],
      });
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
      const sig = await client.signTypedData({ account: wallet, ...organizerTypedData(meta.address, action, nonce, deadline) });
      const body = { ...action, event: meta.address, nonce, deadline, sig };
      const { hash } = await postJson<{ hash: string }>("/api/relay/organizer", body);
      setNotice({ ok: true, text: `${label} done.`, hash });
      await refresh();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(null);
    }
  }

  const naira = (v: bigint | undefined) => (v === undefined ? "…" : formatNaira(v));
  const usdcUnits = (s: string) => BigInt(Math.round(Number(s || "0") * 1e6));

  return (
    <main className="pt-6 lg:pt-10">
      <p className="text-sm text-muted">Organizer</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight lg:text-4xl">{meta.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {state ? (state.status === "Open" ? "Selling and admitting" : state.status) : "…"} ·{" "}
        <Link href={`/gate/${meta.slug}`} className="underline">
          Open the gate screen
        </Link>{" "}
        ·{" "}
        <Link href={`/board/${meta.slug}`} className="underline">
          Money board
        </Link>
      </p>

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
            <p className="mt-1 text-xl font-semibold">
              {state ? `${state.checkedIn} checked in of ${state.sold} sold` : "…"}
            </p>
          </div>
        </section>

        <section className="mt-6 space-y-4 lg:mt-0">
          <div className="rounded-3xl border border-line bg-surface p-5">
            <p className="font-semibold">Your wallet</p>
            {wallet ? (
              <p className={`mt-1 text-sm break-all ${isOrganizer ? "text-go" : "text-stop"}`}>
                {isOrganizer ? "Connected as the organizer" : "This wallet is not the organizer of this show"}
              </p>
            ) : (
              <button onClick={connect} className="mt-3 w-full rounded-2xl bg-velvet px-5 py-3 font-semibold text-velvet-ink">
                Connect the organizer wallet
              </button>
            )}
            <p className="mt-2 text-xs text-muted">
              You sign each action; Curtain&apos;s relayer pays the fee. Your key never leaves your wallet.
            </p>
          </div>

          <fieldset disabled={!isOrganizer || busy !== null} className="space-y-4 disabled:opacity-60">
            <div className="rounded-3xl border border-line bg-surface p-5">
              <p className="font-semibold">Withdraw</p>
              <div className="mt-3 flex gap-2">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  placeholder={state ? (Number(state.available) / 1e6).toString() : "USDC"}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2.5 outline-none focus:border-velvet"
                />
                <button
                  onClick={() => run("Withdrawal", { kind: "withdraw", amount: amount ? usdcUnits(amount) : (state?.available ?? 0n) })}
                  className="rounded-xl bg-velvet px-4 font-semibold text-velvet-ink"
                >
                  {busy === "Withdrawal" ? "Signing…" : "Withdraw"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">Paid to the payout address fixed when the show was created. Empty withdraws everything ready.</p>
            </div>

            <div className="rounded-3xl border border-line bg-surface p-5">
              <p className="font-semibold">Gates</p>
              <input
                value={gate}
                onChange={(e) => setGate(e.target.value.trim())}
                placeholder="Gate device address 0x…"
                className="mt-3 w-full rounded-xl border border-line bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-velvet"
              />
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => isAddress(gate) && run("Gate added", { kind: "setGate", gate: getAddress(gate), allowed: true })}
                  className="flex-1 rounded-xl border border-line px-3 py-2 text-sm font-semibold"
                >
                  Add gate
                </button>
                <button
                  onClick={() => isAddress(gate) && run("Gate removed", { kind: "setGate", gate: getAddress(gate), allowed: false })}
                  className="flex-1 rounded-xl border border-line px-3 py-2 text-sm font-semibold"
                >
                  Remove gate
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-stop/40 bg-surface p-5">
              <p className="font-semibold">Cancel the show</p>
              <p className="mt-1 text-sm text-muted">Every unscanned ticket becomes refundable. Scanned tickets stay paid.</p>
              <button
                onClick={() => confirm("Cancel the show? Unscanned tickets will be refunded.") && run("Cancellation", { kind: "cancel" })}
                className="mt-3 w-full rounded-xl border border-stop px-3 py-2.5 text-sm font-semibold text-stop"
              >
                {busy === "Cancellation" ? "Signing…" : "Cancel the show"}
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
        </section>
      </div>
    </main>
  );
}
