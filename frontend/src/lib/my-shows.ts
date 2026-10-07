import type { MyShowRow } from "./indexer";

export type ShowCard = {
  event: string;
  name: string;
  venue: string;
  doorsOpen: number;
  endTime: number;
  status: string;
  sold: number;
  checkedIn: number;
  /** Paid to the organizer so far and not yet withdrawn. */
  ready: bigint;
  live: boolean;
};

export function toShowCard(r: MyShowRow, now: number): ShowCard {
  const endTime = Number(r.endTime);
  return {
    event: r.id,
    name: r.name,
    venue: r.venue,
    doorsOpen: Number(r.doorsOpen),
    endTime,
    status: r.status,
    sold: r.sold,
    checkedIn: r.checkedIn,
    ready: BigInt(r.released) - BigInt(r.withdrawn),
    live: r.status === "Open" && endTime > now,
  };
}

/** Shows still running first, soonest first; then finished or cancelled shows, most recent first. */
export function sortShowCards(cards: ShowCard[]): ShowCard[] {
  return [...cards].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return a.live ? a.doorsOpen - b.doorsOpen : b.doorsOpen - a.doorsOpen;
  });
}
