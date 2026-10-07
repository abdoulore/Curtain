import type { FeedItem } from "./activity";
import { formatNaira } from "./money";

export type Totals = {
  status: string;
  price: bigint;
  capacity: number;
  sold: number;
  checkedIn: number;
  refundedCount: number | null;
  paidIn: bigint;
  escrowed: bigint;
  released: bigint;
  withdrawn: bigint;
  refunded: bigint;
  /** Where the numbers came from; "live" means moved locally from a chain event, ahead of the next read. */
  source: "Envio" | "chain" | "live";
};

export const STATUS_TEXT: Record<string, string> = {
  Open: "Selling tickets and checking guests in",
  Cancelled: "Cancelled: every ticket that wasn't checked in is refunded",
  Held: "Show confirmed: the rest was paid to the organizer",
  NotHeld: "Show not confirmed: tickets that weren't checked in are refunded",
};

/** "3 guests entered, ₦4,500 paid to the organizer" */
export function guestsLine(t: Pick<Totals, "checkedIn" | "released">): string {
  const guests = t.checkedIn === 1 ? "1 guest" : `${t.checkedIn} guests`;
  return `${guests} entered, ${formatNaira(t.released)} paid to the organizer`;
}

/**
 * Moves the totals for one event straight from the chain, so the board reacts the moment it lands. The next read
 * from the indexer or the contract replaces these numbers with the exact ones.
 */
export function applyLive(t: Totals, item: FeedItem): Totals {
  const amount = item.amount;
  switch (item.kind) {
    case "Purchased":
      return { ...t, sold: t.sold + 1, paidIn: t.paidIn + amount, escrowed: t.escrowed + amount, source: "live" };
    case "CheckedIn": {
      const moved = amount > t.escrowed ? t.escrowed : amount;
      return { ...t, checkedIn: t.checkedIn + 1, escrowed: t.escrowed - moved, released: t.released + moved, source: "live" };
    }
    case "Refunded": {
      const moved = amount > t.escrowed ? t.escrowed : amount;
      return {
        ...t,
        refundedCount: t.refundedCount === null ? null : t.refundedCount + 1,
        escrowed: t.escrowed - moved,
        refunded: t.refunded + moved,
        source: "live",
      };
    }
    default:
      return t;
  }
}

/**
 * Takes a fresh read unless it is behind what the board already showed live (an indexer a beat behind the chain),
 * so the numbers never jump backwards.
 */
export function mergeRead(current: Totals | null, next: Totals): Totals {
  if (current?.source !== "live") return next;
  const behind = next.checkedIn < current.checkedIn || next.sold < current.sold || next.refunded < current.refunded;
  return behind ? current : next;
}
