import "server-only";
import type { Address, Hash } from "viem";
import { curtainEventAbi } from "@/lib/abis";
import { publicClient, walletFor } from "./clients";
import { env } from "./env";
import { gasGuard } from "./gas-budget";
import { sendContract } from "./relay";

/** CurtainEvent.EventStatus, in order. */
const EVENT_STATUS = ["Open", "Cancelled", "Held", "NotHeld"] as const;

/** Tickets paid per pushRefunds call; the same batch the Chainlink keeper uses. */
export const REFUND_BATCH = 10n;

export type ShowState = {
  status: string;
  endTime: number;
  settleDelay: number;
  refundCursor: number;
  sold: number;
};

/**
 * What a show needs right now, by the same rule as CurtainKeeper.pending: an open show past its end plus the settle
 * delay needs settling; a cancelled or not-held show whose refund cursor hasn't reached the last ticket needs refunds.
 */
export function dutyFor(s: ShowState, now: number): "settle" | "refund" | null {
  if (s.status === "Open") return now >= s.endTime + s.settleDelay ? "settle" : null;
  if (s.status === "Cancelled" || s.status === "NotHeld") return s.refundCursor < s.sold ? "refund" : null;
  return null;
}

export const isRefundable = (status: string) => status === "Cancelled" || status === "NotHeld";

export async function readShowState(event: Address): Promise<ShowState> {
  const read = <T,>(functionName: string) =>
    publicClient.readContract({ address: event, abi: curtainEventAbi, functionName } as never) as Promise<T>;
  const [status, endTime, settleDelay, refundCursor, sold] = await Promise.all([
    read<number>("status"),
    read<bigint>("endTime"),
    read<bigint>("settleDelay"),
    read<number>("refundCursor"),
    read<number>("sold"),
  ]);
  return {
    status: EVENT_STATUS[status] ?? "Open",
    endTime: Number(endTime),
    settleDelay: Number(settleDelay),
    refundCursor: Number(refundCursor),
    sold: Number(sold),
  };
}

/**
 * Does whatever the show is due: settles it when its time has come and pushes refunds in batches, up to
 * `maxBatches`, so cancelled and not-held shows refund without anyone asking. Settle and pushRefunds are open to
 * anyone onchain and the money only ever goes to ticket holders or the organizer's fixed payout; the relayer just
 * pays the gas. Calls that would do nothing revert at simulation and cost nothing.
 */
export async function keepShow(event: Address, maxBatches = 5, now = Math.floor(Date.now() / 1000)): Promise<Hash[]> {
  const wallet = walletFor(env.relayerKey());
  const hashes: Hash[] = [];
  let state = await readShowState(event);
  if (dutyFor(state, now) === "settle") {
    const sent = await sendContract(wallet, { address: event, abi: curtainEventAbi, functionName: "settle", args: [] }, gasGuard("keeper"));
    hashes.push(sent.hash);
    state = await readShowState(event);
  }
  for (let i = 0; i < maxBatches && dutyFor(state, now) === "refund"; i++) {
    const sent = await sendContract(
      wallet,
      { address: event, abi: curtainEventAbi, functionName: "pushRefunds", args: [REFUND_BATCH] },
      gasGuard("keeper"),
    );
    hashes.push(sent.hash);
    state = await readShowState(event);
  }
  return hashes;
}
