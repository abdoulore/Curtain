import type { EventInfo } from "./reads";

export type SaleState =
  | { kind: "open"; left: number }
  | { kind: "soldOut"; label: string }
  | { kind: "closed"; label: string };

/** Whether new tickets can be bought right now, and what to say when they can't. */
export function saleState(info: Pick<EventInfo, "status" | "readAt" | "salesEnd" | "endTime" | "sold" | "capacity">): SaleState {
  if (info.status === "Cancelled") {
    return { kind: "closed", label: "This show was cancelled. Every ticket that wasn't checked in is refunded." };
  }
  if (info.status === "NotHeld") {
    return { kind: "closed", label: "This show wasn't confirmed. Every ticket that wasn't checked in is refunded." };
  }
  if (info.status !== "Open" || info.readAt >= info.endTime) return { kind: "closed", label: "This show has ended." };
  if (info.readAt >= info.salesEnd) return { kind: "closed", label: "Ticket sales have closed." };
  if (info.sold >= info.capacity) return { kind: "soldOut", label: "Sold out" };
  return { kind: "open", left: info.capacity - info.sold };
}
