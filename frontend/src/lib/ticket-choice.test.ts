import { describe, expect, it } from "vitest";
import { chooseTicket } from "./ticket-choice";

const mine = [{ ticketId: "5" }, { ticketId: "3" }];

describe("chooseTicket", () => {
  it("picks the first unused ticket", () => {
    expect(chooseTicket(mine, { "5": "CheckedIn", "3": "Active" }, "")).toEqual({ ticketId: "3", usable: true });
  });

  it("still presents the newest ticket when all are used, so the gate shows red", () => {
    expect(chooseTicket(mine, { "5": "CheckedIn", "3": "CheckedIn" }, "")).toEqual({ ticketId: "5", usable: false });
  });

  it("presents a refunded ticket too", () => {
    expect(chooseTicket([{ ticketId: "2" }], { "2": "Refunded" }, "")).toEqual({ ticketId: "2", usable: false });
  });

  it("lets a typed number win", () => {
    expect(chooseTicket(mine, { "5": "Active" }, " 9 ")).toEqual({ ticketId: "9", usable: true });
    expect(chooseTicket(mine, { "5": "CheckedIn" }, "5")).toEqual({ ticketId: "5", usable: false });
  });

  it("has nothing to present without tickets", () => {
    expect(chooseTicket([], {}, "")).toBeNull();
  });
});
