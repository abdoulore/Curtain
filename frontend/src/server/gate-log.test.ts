import { describe, expect, it } from "vitest";
import { memoryGateLog } from "./gate-log";

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
