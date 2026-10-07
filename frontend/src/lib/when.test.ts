import { describe, expect, it } from "vitest";
import { whenText } from "./when";

// Sat 17 Oct 2026, 8:00 pm in Lagos (UTC+1).
const DOORS = Date.UTC(2026, 9, 17, 19) / 1000;

describe("whenText", () => {
  it("gives the day and time doors open, in Lagos time", () => {
    const text = whenText({ doorsOpen: DOORS, endTime: DOORS + 6 * 3600, readAt: DOORS - 86_400 });
    expect(text).toMatch(/^Sat,? 17 Oct · 8:00\s?pm$/i);
  });

  it("says doors are open once they are, with the last day", () => {
    const text = whenText({ doorsOpen: DOORS, endTime: DOORS + 6 * 3600, readAt: DOORS + 60 });
    expect(text).toMatch(/^Doors open now · until Sun,? 18 Oct$/);
    expect(whenText({ doorsOpen: DOORS, endTime: DOORS + 6 * 3600, readAt: DOORS + 60 }, true)).toMatch(/^On now · until Sun,? 18 Oct$/);
  });
});
