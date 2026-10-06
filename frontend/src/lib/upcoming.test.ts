import { describe, expect, it } from "vitest";
import { getContractAddress } from "viem";
import { factoryShowAddresses, upcomingShows, type ShowSummary } from "./upcoming";

const NOW = 1_791_400_000;
const DEMO = "0x5562bF1ccBabcF2f060239f9D241Ba9661217135";
const show = (address: `0x${string}`, over: Partial<ShowSummary> = {}): ShowSummary => ({
  address,
  name: address.slice(0, 6),
  venue: "Venue",
  price: 1_000_000n,
  capacity: 100,
  sold: 10,
  doorsOpen: NOW + 3600,
  endTime: NOW + 7200,
  status: "Open",
  ...over,
});
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

describe("upcomingShows", () => {
  it("pins the demo show first, then the soonest", () => {
    const list = upcomingShows([show(B, { doorsOpen: NOW + 10 }), show(DEMO, { doorsOpen: NOW + 9999 }), show(A, { doorsOpen: NOW + 5 })], NOW, DEMO);
    expect(list.map((s) => s.address)).toEqual([DEMO, A, B]);
  });

  it("hides ended, cancelled and sold-out shows", () => {
    const list = upcomingShows(
      [
        show(A, { endTime: NOW - 1 }),
        show(B, { status: "Cancelled" }),
        show(DEMO, { sold: 100, capacity: 100 }),
        show("0x3333333333333333333333333333333333333333"),
      ],
      NOW,
      DEMO,
    );
    expect(list.map((s) => s.address)).toEqual(["0x3333333333333333333333333333333333333333"]);
  });
});

describe("hidden shows", () => {
  it("leaves out shows on the hidden list", () => {
    expect(upcomingShows([show(A), show(B)], NOW, DEMO, [B]).map((s) => s.address)).toEqual([A]);
  });
});

describe("factoryShowAddresses", () => {
  it("derives clone addresses from the factory nonce, newest first", () => {
    const factory = "0x5e2366072A6db0e0734bBb8976F86a7Eac6Fb3b6";
    const list = factoryShowAddresses(factory, 5, 10);
    expect(list).toEqual([4n, 3n, 2n].map((nonce) => getContractAddress({ from: factory, nonce })));
    expect(factoryShowAddresses(factory, 5, 2)).toHaveLength(2);
    expect(factoryShowAddresses(factory, 2, 10)).toEqual([]);
  });

  it("finds the live demo show at nonce 2", () => {
    expect(factoryShowAddresses("0x5e2366072A6db0e0734bBb8976F86a7Eac6Fb3b6", 3, 10)).toEqual([DEMO]);
  });
});
