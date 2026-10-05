"use client";

import { createPublicClient, erc20Abi, http, type Address, type Hex } from "viem";
import { curtainEventAbi } from "./abis";
import { monadTestnet, PUBLIC_RPC_URL, USDC } from "./chain";

// Browser reads use the public RPC, on demand only (no polling). No keys ever reach the browser.
export const browserClient = createPublicClient({ chain: monadTestnet, transport: http(PUBLIC_RPC_URL) });

export const EVENT_STATUS = ["Open", "Cancelled", "Held", "NotHeld"] as const;
export type EventStatus = (typeof EVENT_STATUS)[number];

export type EventInfo = {
  price: bigint;
  capacity: number;
  sold: number;
  salesEnd: number;
  doorsOpen: number;
  endTime: number;
  status: EventStatus;
  /** Unix seconds when this was read, so renders compare against a fixed time. */
  readAt: number;
};

export async function readEventInfo(event: Address): Promise<EventInfo> {
  const read = <T,>(functionName: string) =>
    browserClient.readContract({ address: event, abi: curtainEventAbi, functionName } as never) as Promise<T>;
  const [price, capacity, sold, salesEnd, doorsOpen, endTime, status] = await Promise.all([
    read<bigint>("price"),
    read<number>("capacity"),
    read<number>("sold"),
    read<bigint>("salesEnd"),
    read<bigint>("doorsOpen"),
    read<bigint>("endTime"),
    read<number>("status"),
  ]);
  return {
    price,
    capacity: Number(capacity),
    sold: Number(sold),
    salesEnd: Number(salesEnd),
    doorsOpen: Number(doorsOpen),
    endTime: Number(endTime),
    status: EVENT_STATUS[status] ?? "Open",
    readAt: Math.floor(Date.now() / 1000),
  };
}

export async function readBalance(owner: Address): Promise<bigint> {
  return browserClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

export const TICKET_STATE = ["None", "Active", "CheckedIn", "RefundOwed", "Refunded"] as const;
export type TicketState = (typeof TICKET_STATE)[number];

export type TicketInfo = {
  holder: Address;
  state: TicketState;
  resalePrice: bigint;
  qx: Hex;
  qy: Hex;
  claimKey: Address;
  claimNonce: bigint;
};

export async function readTicket(event: Address, ticketId: bigint): Promise<TicketInfo> {
  const t = await browserClient.readContract({
    address: event,
    abi: curtainEventAbi,
    functionName: "getTicket",
    args: [ticketId],
  });
  return {
    holder: t.holder,
    state: TICKET_STATE[t.state] ?? "None",
    resalePrice: t.resalePrice,
    qx: t.qx,
    qy: t.qy,
    claimKey: t.claimKey,
    claimNonce: BigInt(t.claimNonce),
  };
}

/**
 * Fallback when the indexer is down: the tickets an account holds in the given events, read straight from each
 * escrow. A few calls per event, unlike a log scan from the factory's deployment block.
 */
export async function ticketsHeldOnChain(holder: Address, events: readonly Address[]) {
  const found: { event: Address; ticketId: bigint; info: TicketInfo }[] = [];
  for (const event of events) {
    const sold = Number(await browserClient.readContract({ address: event, abi: curtainEventAbi, functionName: "sold" }));
    const ids = Array.from({ length: sold }, (_, i) => BigInt(i + 1));
    const infos = await Promise.all(ids.map((id) => readTicket(event, id)));
    infos.forEach((info, i) => {
      if (info.holder.toLowerCase() === holder.toLowerCase()) found.push({ event, ticketId: ids[i]!, info });
    });
  }
  return found;
}
