import { describe, expect, it } from "vitest";
import type { FeedItem } from "./activity";
import { applyLive, guestsLine, mergeRead, STATUS_TEXT, type Totals } from "./board";

const T = 1_000_000n; // one ₦1,500 ticket

const base: Totals = {
  status: "Open",
  price: T,
  capacity: 10,
  sold: 3,
  checkedIn: 1,
  refundedCount: 0,
  paidIn: 3n * T,
  escrowed: 2n * T,
  released: T,
  withdrawn: 0n,
  refunded: 0n,
  source: "Envio",
};

const event = (kind: string, amount = T): FeedItem => ({ id: kind, kind, amount, at: 0, txHash: "0x", ticketId: "4" });

describe("applyLive", () => {
  it("moves a checked-in ticket's money from protected to paid", () => {
    const next = applyLive(base, event("CheckedIn"));
    expect(next).toMatchObject({ checkedIn: 2, escrowed: T, released: 2n * T, source: "live" });
    expect(next.escrowed + next.released + next.refunded).toBe(base.paidIn);
  });

  it("adds a purchase to the protected money", () => {
    expect(applyLive(base, event("Purchased"))).toMatchObject({ sold: 4, paidIn: 4n * T, escrowed: 3n * T });
  });

  it("moves a refund out of the protected money", () => {
    expect(applyLive(base, event("Refunded"))).toMatchObject({ escrowed: T, refunded: T, refundedCount: 1 });
  });

  it("never takes more than is protected", () => {
    const next = applyLive({ ...base, escrowed: 0n }, event("CheckedIn"));
    expect(next.escrowed).toBe(0n);
    expect(next.released).toBe(T);
  });

  it("leaves the totals alone for other events", () => {
    expect(applyLive(base, event("Listed"))).toBe(base);
  });
});

describe("mergeRead", () => {
  it("takes a fresh read over an earlier read", () => {
    const next = { ...base, sold: 2 };
    expect(mergeRead(base, next)).toBe(next);
  });

  it("keeps the live numbers while the indexer is behind them", () => {
    const live = applyLive(base, event("CheckedIn"));
    expect(mergeRead(live, base)).toBe(live);
  });

  it("takes the read once it has caught up", () => {
    const live = applyLive(base, event("CheckedIn"));
    const caughtUp = { ...base, checkedIn: 2, escrowed: T, released: 2n * T };
    expect(mergeRead(live, caughtUp)).toBe(caughtUp);
  });
});

describe("board copy", () => {
  it("says how many guests entered and what the organizer was paid", () => {
    expect(guestsLine({ checkedIn: 3, released: 3n * T })).toBe("3 guests entered, ₦4,500 paid to the organizer");
    expect(guestsLine({ checkedIn: 1, released: T })).toBe("1 guest entered, ₦1,500 paid to the organizer");
  });

  it("describes every show status without the old words", () => {
    for (const text of Object.values(STATUS_TEXT)) expect(text).not.toMatch(/released|held safely/i);
  });
});
