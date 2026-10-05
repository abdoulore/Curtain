import { describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { heldTickets } from "./held-tickets";

const HOLDER: Address = "0x1111111111111111111111111111111111111111";
const LIVE: Address = "0xd3F22B52F74D658318C29E0475E1833214eCA005";
const RETIRED = "0x8df8b6d5cef9fe34b1a6be4e130a589be4bb5cb7";

const row = (show_id: string, ticketId: string) => ({ show_id, ticketId, boughtTx: "0xab", boughtAt: "1700000000" });

describe("heldTickets", () => {
  it("uses the indexer when it knows the listed escrows", async () => {
    const chain = vi.fn();
    const got = await heldTickets(HOLDER, [LIVE], { indexer: async () => [row(LIVE.toLowerCase(), "4")], chain });
    expect(got).toEqual([{ event: LIVE, ticketId: 4n, boughtTx: "0xab", boughtAt: 1_700_000_000_000 }]);
    expect(chain).not.toHaveBeenCalled();
  });

  it("reads the chain when the indexer only knows a retired escrow", async () => {
    const chain = vi.fn(async () => [{ event: LIVE, ticketId: 2n }]);
    const got = await heldTickets(HOLDER, [LIVE], { indexer: async () => [row(RETIRED, "7")], chain });
    expect(got).toEqual([{ event: LIVE, ticketId: 2n }]);
    expect(chain).toHaveBeenCalledWith(HOLDER, [LIVE]);
  });

  it("reads the chain when the indexer has nothing", async () => {
    const chain = vi.fn(async () => []);
    expect(await heldTickets(HOLDER, [LIVE], { indexer: async () => [], chain })).toEqual([]);
    expect(chain).toHaveBeenCalledOnce();
  });

  it("reads the chain when the indexer is down", async () => {
    const chain = vi.fn(async () => [{ event: LIVE, ticketId: 1n }]);
    const indexer = async () => {
      throw new Error("502");
    };
    expect(await heldTickets(HOLDER, [LIVE], { indexer, chain })).toEqual([{ event: LIVE, ticketId: 1n }]);
  });
});
