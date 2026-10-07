const dayFmt = new Intl.DateTimeFormat("en-NG", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" });
const timeFmt = new Intl.DateTimeFormat("en-NG", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });

/** "Sat 17 Oct · 8:00 pm" in Lagos time, or "Doors open now · until Fri 6 Nov" once doors have opened. */
export function whenText(info: { doorsOpen: number; endTime: number; readAt: number }): string {
  if (info.readAt >= info.doorsOpen) return `Doors open now · until ${dayFmt.format(new Date(info.endTime * 1000))}`;
  const doors = new Date(info.doorsOpen * 1000);
  return `${dayFmt.format(doors)} · ${timeFmt.format(doors)}`;
}
