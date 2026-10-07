import { describe, expect, it } from "vitest";
import { saleState } from "./sale-state";

const base = { status: "Open" as const, readAt: 100, salesEnd: 200, endTime: 300, sold: 3, capacity: 10 };

describe("saleState", () => {
  it("is open with tickets left", () => {
    expect(saleState(base)).toEqual({ kind: "open", left: 7 });
  });

  it("says sold out at capacity", () => {
    expect(saleState({ ...base, sold: 10 })).toEqual({ kind: "soldOut", label: "Sold out" });
  });

  it("closes when sales end, the show ends or it is cancelled", () => {
    expect(saleState({ ...base, readAt: 200 }).kind).toBe("closed");
    expect(saleState({ ...base, readAt: 300 })).toEqual({ kind: "closed", label: "This show has ended." });
    expect(saleState({ ...base, status: "Cancelled" })).toMatchObject({ kind: "closed", label: expect.stringContaining("refunded") });
    expect(saleState({ ...base, status: "Held" }).kind).toBe("closed");
  });
});
