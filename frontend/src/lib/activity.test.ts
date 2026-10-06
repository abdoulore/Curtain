import { describe as group, expect, it } from "vitest";
import { describe, sortFeed, type FeedItem } from "./activity";

const item = (kind: string, at: number, ticketId?: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  id: `${kind}-${at}-${ticketId}`,
  kind,
  ticketId,
  amount: 1_000_000n,
  at,
  txHash: "0x",
  ...extra,
});

group("sortFeed", () => {
  it("puts the newest first", () => {
    expect(sortFeed([item("Purchased", 1, "1"), item("CheckedIn", 3, "1")]).map((i) => i.kind)).toEqual(["CheckedIn", "Purchased"]);
  });

  it("orders a ticket's steps in the same second as they happened, newest first", () => {
    const same = [item("Listed", 5, "2"), item("Purchased", 5, "2"), item("Resold", 5, "2")];
    expect(sortFeed(same).map((i) => i.kind)).toEqual(["Resold", "Listed", "Purchased"]);
  });

  it("puts higher ticket numbers first among equal steps", () => {
    expect(sortFeed([item("Purchased", 5, "4"), item("Purchased", 5, "5")]).map((i) => i.ticketId)).toEqual(["5", "4"]);
  });
});

group("describe", () => {
  it("speaks in naira and says where money went", () => {
    expect(describe(item("Purchased", 0, "1"))).toBe("Ticket #1 sold, ₦1,500 held safely");
    expect(describe(item("CheckedIn", 0, "1"))).toBe("Ticket #1 checked in, ₦1,500 paid to the organizer");
    expect(describe(item("Withdrawn", 0))).toBe("Organizer withdrew ₦1,500");
    expect(describe(item("Resold", 0, "2"))).toBe("Ticket #2 resold, ₦1,500 paid to the seller; the ticket's money stays held");
  });

  it("tells a cancelled gift link from a new one", () => {
    expect(describe(item("ClaimSet", 0, "3", { account: "0x0000000000000000000000000000000000000000" }))).toBe(
      "Ticket #3 gift link cancelled",
    );
    expect(describe(item("ClaimSet", 0, "3", { account: "0xe1f2fa10e1f2fa10e1f2fa10e1f2fa10e1f2fa10" }))).toBe(
      "Ticket #3 gift link created",
    );
  });

  it("tells a delisting from a listing", () => {
    expect(describe(item("Listed", 0, "6", { amount: 0n }))).toBe("Ticket #6 taken off resale");
  });
});
