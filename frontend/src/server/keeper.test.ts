import { describe, expect, it } from "vitest";
import { dutyFor, isRefundable } from "./keeper";

const show = { status: "Open", endTime: 1000, settleDelay: 3600, refundCursor: 0, sold: 5 };

describe("dutyFor", () => {
  it("settles an open show only once its end plus the settle delay has passed", () => {
    expect(dutyFor(show, 1000 + 3599)).toBeNull();
    expect(dutyFor(show, 1000 + 3600)).toBe("settle");
  });

  it("pushes refunds for a cancelled or not-held show until the cursor reaches the last ticket", () => {
    expect(dutyFor({ ...show, status: "Cancelled" }, 0)).toBe("refund");
    expect(dutyFor({ ...show, status: "NotHeld", refundCursor: 4 }, 0)).toBe("refund");
    expect(dutyFor({ ...show, status: "NotHeld", refundCursor: 5 }, 0)).toBeNull();
  });

  it("has nothing to do for a held show or an empty cancelled one", () => {
    expect(dutyFor({ ...show, status: "Held" }, 99_999)).toBeNull();
    expect(dutyFor({ ...show, status: "Cancelled", sold: 0 }, 0)).toBeNull();
  });

  it("knows which statuses refund", () => {
    expect(["Cancelled", "NotHeld"].every(isRefundable)).toBe(true);
    expect(["Open", "Held"].some(isRefundable)).toBe(false);
  });
});
