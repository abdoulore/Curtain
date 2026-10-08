"use client";

import type { Address, Hash } from "viem";
import { postJson } from "./api";

/**
 * Asks the relayer to pay this ticket's refund, settling the show first if its time has come. No signature is
 * needed: the contract only ever pays a ticket's holder.
 */
export function requestRefund(event: Address, ticketId: string) {
  return postJson<{ hashes: Hash[]; status: string }>("/api/relay/refund", { event, ticketId });
}
