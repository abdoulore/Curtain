import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, fold, icsFileName } from "./ics";

const entry = {
  uid: "0xa01efa5bc1cdb594a6ec70d2bd1b1138b496cb0e-4@curtaintickets.vercel.app",
  name: "Ember Comedy Night",
  venue: "The Ember Room, Yaba",
  start: 1_791_400_000,
  end: 1_791_421_600,
  url: "https://curtaintickets.vercel.app/tickets",
};

describe("buildIcs", () => {
  const ics = buildIcs(entry, 1_791_300_000);

  it("is a VCALENDAR with one event and CRLF line endings", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
  });

  it("carries the name, venue, doors-open time in UTC and a link to the ticket", () => {
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:Ember Comedy Night");
    expect(unfolded).toContain("LOCATION:The Ember Room\\, Yaba");
    expect(unfolded).toContain(`DTSTART:${new Date(entry.start * 1000).toISOString().replace(/[-:]/g, "").replace(".000", "")}`);
    expect(unfolded).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(unfolded).toContain("URL:https://curtaintickets.vercel.app/tickets");
    expect(unfolded).toContain("Your ticket: https://curtaintickets.vercel.app/tickets");
  });

  it("keeps every line within 75 octets", () => {
    const long = buildIcs({ ...entry, name: "A very long show name ".repeat(8), description: "Line one\nLine two, with commas; and semicolons" }, 0);
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(long.replace(/\r\n /g, "")).toContain("Line one\\nLine two\\, with commas\\; and semicolons");
  });
});

describe("helpers", () => {
  it("escapes text and folds long lines", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(fold("x".repeat(80))).toBe(`${"x".repeat(75)}\r\n ${"x".repeat(5)}`);
  });

  it("names the file after the show", () => {
    expect(icsFileName("Ember Comedy Night!")).toBe("ember-comedy-night.ics");
    expect(icsFileName("₦₦")).toBe("curtain-show.ics");
  });
});
