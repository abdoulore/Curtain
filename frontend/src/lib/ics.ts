/** A calendar entry for a show, as an iCalendar (.ics) file. */
export type CalendarEntry = {
  uid: string;
  name: string;
  venue: string;
  /** Unix seconds. */
  start: number;
  end: number;
  url: string;
  description?: string;
};

const stamp = (unix: number) => new Date(unix * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Escapes text per RFC 5545: backslash, semicolon, comma and newlines. */
export const escapeText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line at 75 octets, continuing with a leading space. */
export function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function buildIcs(e: CalendarEntry, now: number): string {
  const description = [e.description, `Your ticket: ${e.url}`].filter(Boolean).join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Curtain//Tickets//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${escapeText(e.name)}`,
    `LOCATION:${escapeText(e.venue)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${e.url}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`${e.name} doors open in 2 hours`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** A tidy file name, e.g. "lagos-laughs.ics". */
export const icsFileName = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "curtain-show"}.ics`;
