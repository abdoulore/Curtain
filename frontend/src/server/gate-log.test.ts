import { describe, expect, it } from "vitest";
import { forGate, memoryGateLog } from "./gate-log";

describe("gate log", () => {
  it("keeps the newest results first, per event, capped at 20", async () => {
    const log = memoryGateLog();
    for (let i = 0; i < 25; i++) await log.push("0xAbc", { at: i, ok: i % 2 === 0, ticketId: String(i) });
    await log.push("0xother", { at: 1, ok: false, ticketId: "9", code: "TicketNotActive" });
    const recent = await log.recent("0xAbc");
    expect(recent).toHaveLength(20);
    expect(recent[0]!.ticketId).toBe("24");
    expect(await log.recent("0xother")).toEqual([{ at: 1, ok: false, ticketId: "9", code: "TicketNotActive" }]);
  });
});

describe("forGate", () => {
  it("gives each gate screen only the attempts made with its own codes", () => {
    const A = "0xAAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const results = [
      { at: 3, ok: true, ticketId: "3", gate: B },
      { at: 2, ok: false, ticketId: "2", gate: A.toLowerCase(), code: "TicketNotActive" },
      { at: 1, ok: false, ticketId: "1", code: "NotGate" },
    ];
    expect(forGate(results, A).map((r) => r.ticketId)).toEqual(["2"]);
    expect(forGate(results, B).map((r) => r.ticketId)).toEqual(["3"]);
  });
});
