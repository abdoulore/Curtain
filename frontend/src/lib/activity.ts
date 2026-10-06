import { zeroAddress } from "viem";
import { formatNaira } from "./money";

/** One line on the money board: an indexed or live escrow event. */
export type FeedItem = {
  id: string;
  kind: string;
  ticketId?: string;
  amount: bigint;
  /** Who the event names: buyer, holder, organizer, claim key (zero when a gift link is cancelled). */
  account?: string;
  at: number;
  txHash: string;
};

/** The order things happen to a ticket, used to order events that land in the same second. */
const LIFECYCLE: Record<string, number> = {
  Created: 0,
  Purchased: 1,
  ClaimSet: 2,
  Claimed: 3,
  Listed: 4,
  Resold: 5,
  CheckedIn: 6,
  Withdrawn: 7,
  Cancelled: 8,
  Settled: 9,
  RefundOwed: 10,
  Refunded: 11,
};

/** Newest first; within one second, later steps of a ticket's life first, then higher ticket numbers. */
export function sortFeed(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort(
    (a, b) =>
      b.at - a.at ||
      (LIFECYCLE[b.kind] ?? 99) - (LIFECYCLE[a.kind] ?? 99) ||
      Number(b.ticketId ?? 0) - Number(a.ticketId ?? 0),
  );
}

/** Plain-language line for an event. */
export function describe(item: FeedItem): string {
  const n = item.ticketId ? `Ticket #${item.ticketId}` : "";
  const money = formatNaira(item.amount);
  switch (item.kind) {
    case "Created":
      return "Show created";
    case "Purchased":
      return `${n} sold, ${money} held safely`;
    case "CheckedIn":
      return `${n} checked in, ${money} paid to the organizer`;
    case "Withdrawn":
      return `Organizer withdrew ${money}`;
    case "Refunded":
      return `${n} refunded, ${money} back to the buyer`;
    case "RefundOwed":
      return `${n} refund owed, the buyer can claim it`;
    case "Cancelled":
      return "Show cancelled, unscanned tickets will be refunded";
    case "Settled":
      return item.amount > 0n ? `Show settled as held, ${money} released` : "Show not held, refunds open";
    case "Listed":
      return item.amount > 0n ? `${n} put up for resale at ${money}` : `${n} taken off resale`;
    case "Resold":
      return `${n} resold, ${money} paid to the seller; the ticket's money stays held`;
    case "ClaimSet":
      return item.account && item.account.toLowerCase() === zeroAddress ? `${n} gift link cancelled` : `${n} gift link created`;
    case "Claimed":
      return `${n} claimed from a gift link`;
    default:
      return item.kind;
  }
}
