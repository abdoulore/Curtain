import { describe, expect, it } from "vitest";
import type { MyShowRow } from "./indexer";
import { sortShowCards, toShowCard } from "./my-shows";

const row = (over: Partial<MyShowRow>): MyShowRow => ({
  id: "0x1",
  name: "Ember Comedy Night",
  venue: "The Ember Room, Yaba",
  status: "Open",
  sold: 7,
  checkedIn: 4,
  doorsOpen: "1000",
  endTime: "2000",
  released: "6000000",
  withdrawn: "1000000",
  ...over,
});

describe("toShowCard", () => {
  it("works out what is ready to withdraw", () => {
    const card = toShowCard(row({}), 1500);
    expect(card.ready).toBe(5_000_000n);
    expect(card.live).toBe(true);
  });

  it("treats an ended or cancelled show as finished", () => {
    expect(toShowCard(row({}), 2000).live).toBe(false);
    expect(toShowCard(row({ status: "Cancelled" }), 1500).live).toBe(false);
  });
});

describe("sortShowCards", () => {
  it("lists running shows soonest first, then finished ones newest first", () => {
    const cards = [
      toShowCard(row({ id: "a", doorsOpen: "1800", endTime: "9000" }), 1500),
      toShowCard(row({ id: "b", status: "Cancelled", doorsOpen: "100" }), 1500),
      toShowCard(row({ id: "c", doorsOpen: "1200", endTime: "9000" }), 1500),
      toShowCard(row({ id: "d", status: "Held", doorsOpen: "500" }), 1500),
    ];
    expect(sortShowCards(cards).map((c) => c.event)).toEqual(["c", "a", "d", "b"]);
  });
});
