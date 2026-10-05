import type { TicketState } from "./reads";

export type TicketChoice = { ticketId: string; usable: boolean } | null;

/**
 * Which ticket the check-in button presents. A typed number wins; otherwise the first unused ticket. With every
 * ticket used, the newest is still presented, so the gate refuses it on screen (red) instead of the phone quietly
 * stopping.
 */
export function chooseTicket(
  mine: readonly { ticketId: string }[],
  states: Readonly<Record<string, TicketState>>,
  typed: string,
): TicketChoice {
  const id = typed.trim();
  if (id !== "") return { ticketId: id, usable: (states[id] ?? "Active") === "Active" };
  const ready = mine.find((t) => states[t.ticketId] === "Active");
  if (ready) return { ticketId: ready.ticketId, usable: true };
  const newest = mine[0];
  return newest ? { ticketId: newest.ticketId, usable: false } : null;
}
