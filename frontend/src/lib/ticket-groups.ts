import type { CardStatus } from "./resale";

export type ShowTiming = { status: string; readAt: number; endTime: number; doorsOpen: number };

/**
 * Upcoming: a ticket still held for a show that is open and not over. Everything else (checked in, refunded, sold,
 * passed on, or a show that ended or was cancelled) is Past.
 */
export function ticketGroup(status: CardStatus, show: ShowTiming | null): "upcoming" | "past" {
  const live = show !== null && show.status === "Open" && show.readAt < show.endTime;
  return live && (status === "ready" || status === "listed" || status === "checking") ? "upcoming" : "past";
}

/** The one action a ticket card offers; it opens the ticket's details, where everything else lives. */
export function mainAction(status: CardStatus): string | null {
  switch (status) {
    case "ready":
    case "used":
      return "View ticket";
    case "listed":
      return "Manage listing";
    case "refunded":
      return "View refund";
    case "refundable":
      return "Get my refund";
    case "ended":
    case "missed":
      return "Details";
    case "sold":
      return "View sale";
    case "passedOn":
      return "Details";
    case "checking":
      return null;
  }
}

/** Upcoming tickets soonest first; past tickets most recent first. */
export function sortTickets<T extends { show: ShowTiming | null; boughtAt: number }>(tickets: T[], group: "upcoming" | "past"): T[] {
  return [...tickets].sort((a, b) => {
    const da = a.show?.doorsOpen ?? 0;
    const db = b.show?.doorsOpen ?? 0;
    return group === "upcoming" ? da - db || a.boughtAt - b.boughtAt : db - da || b.boughtAt - a.boughtAt;
  });
}
