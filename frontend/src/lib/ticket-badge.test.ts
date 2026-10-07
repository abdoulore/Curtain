import { describe, expect, it } from "vitest";
import type { CardStatus } from "./resale";
import { ticketBadge } from "./ticket-badge";

const ALL: CardStatus[] = ["checking", "ready", "listed", "used", "refunded", "refundOwed", "sold", "passedOn"];

describe("ticketBadge", () => {
  it.each(ALL)("gives %s a label and an icon, not just a colour", (status) => {
    const b = ticketBadge(status, "₦1,500");
    expect(b.label.length).toBeGreaterThan(0);
    expect(b.icon).toBeTruthy();
  });

  it("uses the shared vocabulary", () => {
    expect(ticketBadge("used", "₦1,500").label).toBe("Checked in");
    expect(ticketBadge("refunded", "₦1,500").label).toBe("Refunded");
    expect(ticketBadge("ready", "₦1,500").detail).toContain("gate");
  });

  it("names the money in the detail", () => {
    expect(ticketBadge("listed", "₦1,200").detail).toContain("₦1,200");
    expect(ticketBadge("refunded", "₦1,500").detail).toContain("₦1,500");
    expect(ticketBadge("sold", "₦1,500").detail).toContain("₦1,500");
  });

  it("gives every status a distinct label", () => {
    const labels = ALL.map((s) => ticketBadge(s, "₦1").label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
