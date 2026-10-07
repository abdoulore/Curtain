/** A row in the organizer's door list. Times are unix seconds. */
export type DoorRow = { ticketId: number; state: string; boughtAt: number | null; checkedInAt: number | null };

export const DOOR_STATUS: Record<string, { label: string; tone: "go" | "muted" | "velvet" }> = {
  Active: { label: "Not in yet", tone: "muted" },
  CheckedIn: { label: "Checked in", tone: "go" },
  Refunded: { label: "Refunded", tone: "muted" },
  RefundOwed: { label: "Refund owed", tone: "velvet" },
};

/** Newest ticket first. */
export const sortDoorList = (rows: readonly DoorRow[]): DoorRow[] => [...rows].sort((a, b) => b.ticketId - a.ticketId);

export type SalesPoint = { t: number; sold: number; checkedIn: number };

/**
 * Running totals of tickets sold and checked in, one point per change, from the indexer's Purchased and CheckedIn
 * activity. Ends at `now` so the lines reach the present.
 */
export function salesSeries(activity: readonly { kind: string; timestamp: number }[], now: number): SalesPoint[] {
  const events = activity
    .filter((a) => a.kind === "Purchased" || a.kind === "CheckedIn")
    .sort((a, b) => a.timestamp - b.timestamp);
  if (events.length === 0) return [];
  const points: SalesPoint[] = [{ t: events[0]!.timestamp, sold: 0, checkedIn: 0 }];
  let sold = 0;
  let checkedIn = 0;
  for (const e of events) {
    if (e.kind === "Purchased") sold++;
    else checkedIn++;
    const last = points[points.length - 1]!;
    if (last.t === e.timestamp) points[points.length - 1] = { t: e.timestamp, sold, checkedIn };
    else points.push({ t: e.timestamp, sold, checkedIn });
  }
  const last = points[points.length - 1]!;
  if (now > last.t) points.push({ t: now, sold, checkedIn });
  return points;
}
