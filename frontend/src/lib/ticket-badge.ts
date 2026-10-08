import type { CardStatus } from "./resale";

export type BadgeIcon = "check" | "tag" | "door" | "return" | "clock" | "arrow";

export type TicketBadge = {
  /** The badge text: every status has words and an icon, never colour alone. */
  label: string;
  icon: BadgeIcon;
  tone: "go" | "velvet" | "neutral" | "muted";
  /** A sentence under the ticket number, when the badge needs explaining. */
  detail: string | null;
};

const DOOR_HINT = "At the gate, scan the code with your camera and confirm with your fingerprint or Face ID.";

/** How a ticket card presents its state. `price` is the ticket's price, or its resale price when listed. */
export function ticketBadge(status: CardStatus, price: string): TicketBadge {
  switch (status) {
    case "checking":
      return { label: "Checking", icon: "clock", tone: "muted", detail: null };
    case "ready":
      return { label: "Ready for the gate", icon: "check", tone: "go", detail: DOOR_HINT };
    case "listed":
      return { label: "On sale", icon: "tag", tone: "velvet", detail: `On sale at ${price}. It's still yours until someone buys it.` };
    case "used":
      return { label: "Checked in", icon: "door", tone: "neutral", detail: "Enjoy the show." };
    case "refunded":
      return { label: "Refunded", icon: "return", tone: "go", detail: `${price} is back in your balance. It pays for your next ticket.` };
    case "refundable":
      return {
        label: "Refund ready",
        icon: "return",
        tone: "velvet",
        detail: `This show didn't go ahead, so the ${price} you paid comes back to you.`,
      };
    case "ended":
      return {
        label: "Show ended",
        icon: "clock",
        tone: "muted",
        detail: "Not checked in. If the show isn't confirmed, this ticket is refunded automatically.",
      };
    case "missed":
      return {
        label: "Not checked in",
        icon: "door",
        tone: "muted",
        detail: "The show went ahead, so this ticket's money was paid to the organizer.",
      };
    case "sold":
      return { label: "Sold", icon: "arrow", tone: "muted", detail: `The buyer's ${price} went to your balance.` };
    case "passedOn":
      return { label: "Passed on", icon: "arrow", tone: "muted", detail: "This ticket now belongs to someone else." };
  }
}
