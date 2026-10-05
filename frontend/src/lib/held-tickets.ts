import { getAddress, type Address, type Hash } from "viem";
import { CATALOG_EVENTS } from "./events";
import { fetchTicketsOf } from "./indexer";
import { ticketsHeldOnChain } from "./reads";

export type HeldTicket = { event: Address; ticketId: bigint; boughtTx?: Hash; boughtAt?: number };

type Sources = {
  indexer: (holder: Address) => Promise<{ show_id: string; ticketId: string; boughtTx: string; boughtAt: string }[]>;
  chain: (holder: Address, events: readonly Address[]) => Promise<{ event: Address; ticketId: bigint }[]>;
};

const live: Sources = { indexer: fetchTicketsOf, chain: ticketsHeldOnChain };

/**
 * Tickets this account holds in the listed escrows. The indexer answers first; when it is down, or answers with
 * nothing for these escrows (still syncing, or following an older factory), each escrow is read directly.
 */
export async function heldTickets(
  holder: Address,
  events: readonly Address[] = CATALOG_EVENTS,
  sources: Sources = live,
): Promise<HeldTicket[]> {
  const listed = new Set(events.map((e) => e.toLowerCase()));
  try {
    const rows = (await sources.indexer(holder)).filter((r) => listed.has(r.show_id.toLowerCase()));
    if (rows.length > 0) {
      return rows.map((r) => ({
        event: getAddress(r.show_id),
        ticketId: BigInt(r.ticketId),
        boughtTx: r.boughtTx as Hash,
        boughtAt: Number(r.boughtAt) * 1000,
      }));
    }
  } catch {}
  return (await sources.chain(holder, events)).map((t) => ({ event: t.event, ticketId: t.ticketId }));
}
