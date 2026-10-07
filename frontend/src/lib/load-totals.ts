"use client";

import type { Address } from "viem";
import { curtainEventAbi } from "./abis";
import type { Totals } from "./board";
import { ENVIO_URL, fetchBoard, type ShowRow } from "./indexer";
import { browserClient, EVENT_STATUS } from "./reads";

/** A show's money totals from the indexer's row. */
export function totalsFromRow(s: ShowRow): Totals {
  return {
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
  };
}

/** A show's money totals read straight from its escrow. */
export async function readTotalsFromChain(event: Address): Promise<Totals> {
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

/** Totals from the indexer, or from the escrow when the indexer is slow or has nothing. */
export async function loadTotals(event: Address): Promise<Totals> {
  if (ENVIO_URL) {
    const board = await fetchBoard(event).catch(() => null);
    if (board?.show) return totalsFromRow(board.show);
  }
  return readTotalsFromChain(event);
}
