const dayFmt = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
const timeFmt = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });

/**
 * "Sat 17 Oct · 8:00 pm" in Lagos time, or once doors have opened "Doors open now · until Fri 6 Nov" ("On now · until
 * Fri 6 Nov" in the short form for lists and cards), never a doors-open date in the past.
 */
export function whenText(info: { doorsOpen: number; endTime: number; readAt: number }, short = false): string {
  if (info.readAt >= info.doorsOpen) {
    const until = dayFmt.format(new Date(info.endTime * 1000));
    return short ? `On now · until ${until}` : `Doors open now · until ${until}`;
  }
  const doors = new Date(info.doorsOpen * 1000);
  return `${dayFmt.format(doors)} · ${timeFmt.format(doors)}`;
}
