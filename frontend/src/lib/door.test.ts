import { describe, expect, it } from "vitest";
import { salesSeries, sortDoorList } from "./door";

describe("sortDoorList", () => {
  it("puts the newest ticket first", () => {
    const rows = [1, 3, 2].map((ticketId) => ({ ticketId, state: "Active", boughtAt: 0, checkedInAt: null }));
    expect(sortDoorList(rows).map((r) => r.ticketId)).toEqual([3, 2, 1]);
  });
});

describe("salesSeries", () => {
  it("keeps running totals of sold and checked in", () => {
    const series = salesSeries(
      [
        { kind: "Purchased", timestamp: 10 },
        { kind: "Withdrawn", timestamp: 12 },
        { kind: "Purchased", timestamp: 20 },
        { kind: "CheckedIn", timestamp: 30 },
      ],
      40,
    );
    expect(series).toEqual([
      { t: 10, sold: 1, checkedIn: 0 },
      { t: 20, sold: 2, checkedIn: 0 },
      { t: 30, sold: 2, checkedIn: 1 },
      { t: 40, sold: 2, checkedIn: 1 },
    ]);
  });

  it("merges events in the same second and sorts unsorted input", () => {
    const series = salesSeries(
      [
        { kind: "CheckedIn", timestamp: 9 },
        { kind: "Purchased", timestamp: 5 },
        { kind: "Purchased", timestamp: 5 },
      ],
      9,
    );
    expect(series).toEqual([
      { t: 5, sold: 2, checkedIn: 0 },
      { t: 9, sold: 2, checkedIn: 1 },
    ]);
  });

  it("is empty before the first sale", () => {
    expect(salesSeries([{ kind: "Created", timestamp: 1 }], 5)).toEqual([]);
  });
});
