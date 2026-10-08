import { describe, expect, it } from "vitest";
import type { CardStatus } from "./resale";
import { mainAction, sortTickets, ticketGroup } from "./ticket-groups";

const open = { status: "Open", readAt: 100, endTime: 200, doorsOpen: 150 };

describe("ticketGroup", () => {
  it("puts held tickets for an open show under Upcoming", () => {
    expect(ticketGroup("ready", open)).toBe("upcoming");
    expect(ticketGroup("listed", open)).toBe("upcoming");
  });

  it("puts used, refunded, sold and passed-on tickets under Past", () => {
    for (const s of ["used", "refunded", "refundable", "ended", "missed", "sold", "passedOn"] as CardStatus[]) {
      expect(ticketGroup(s, open)).toBe("past");
    }
  });

  it("moves a ticket to Past once its show ends or is cancelled", () => {
    expect(ticketGroup("ready", { ...open, readAt: 200 })).toBe("past");
    expect(ticketGroup("ready", { ...open, status: "Cancelled" })).toBe("past");
  });
});

describe("mainAction", () => {
  it("offers exactly one action per state", () => {
    expect(mainAction("ready")).toBe("View ticket");
    expect(mainAction("listed")).toBe("Manage listing");
    expect(mainAction("refunded")).toBe("View refund");
    expect(mainAction("refundable")).toBe("Get my refund");
    expect(mainAction("checking")).toBeNull();
  });
});

describe("sortTickets", () => {
  const t = (doorsOpen: number, boughtAt = 0) => ({ show: { ...open, doorsOpen }, boughtAt });

  it("shows the soonest upcoming show first and the latest past show first", () => {
    expect(sortTickets([t(300), t(100), t(200)], "upcoming").map((x) => x.show.doorsOpen)).toEqual([100, 200, 300]);
    expect(sortTickets([t(300), t(100), t(200)], "past").map((x) => x.show.doorsOpen)).toEqual([300, 200, 100]);
  });
});
