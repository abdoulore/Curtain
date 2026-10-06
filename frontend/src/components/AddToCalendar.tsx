"use client";

import type { Address } from "viem";
import { RP_ID } from "@/lib/chain";
import { buildIcs, icsFileName } from "@/lib/ics";

/** Downloads an .ics file for the show, with a link back to the ticket. */
export function AddToCalendar({
  event,
  ticketId,
  name,
  venue,
  doorsOpen,
  endTime,
  className,
}: {
  event: Address;
  ticketId: string;
  name: string;
  venue: string;
  doorsOpen: number;
  endTime: number;
  className?: string;
}) {
  function download() {
    const ics = buildIcs(
      {
        uid: `${event.toLowerCase()}-${ticketId}@${RP_ID}`,
        name,
        venue,
        start: doorsOpen,
        end: endTime,
        url: `https://${RP_ID}/tickets`,
        description: `Ticket #${ticketId}. At the door, scan the gate code with your camera and confirm with your fingerprint or Face ID.`,
      },
      Math.floor(Date.now() / 1000),
    );
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFileName(name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <button
      type="button"
      onClick={download}
      className={className ?? "w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold"}
    >
      Add to calendar
    </button>
  );
}
