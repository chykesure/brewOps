// Server-side day boundaries drawn on the REPORTER's wall clock.
// The brewery floor (Africa/Lagos, UTC+1) does not share the server clock, so every
// "today" the app draws — the daily round, the day report, the Excel/CSV exports —
// must use the timezone the reporting device actually lives in. The client sends its
// IANA timezone alongside the date; when it does, boundaries are computed for that
// zone, otherwise the historical server-local behaviour is kept.

function tzOffsetMs(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // Some engines emit hour "24" for midnight — normalise before Date.UTC
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - at.getTime();
}

export function zonedDayBounds(
  dateStr: string | null | undefined,
  tz?: string | null,
): { start: Date; end: Date; dateStr: string } {
  const valid = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;

  // Fallback: server-local wall clock (legacy behaviour when no tz is supplied)
  if (!valid || !tz) {
    const base = valid ? new Date(`${valid}T00:00:00`) : new Date();
    if (isNaN(base.getTime())) return zonedDayBounds(null, null);
    const start = new Date(base);
    start.setHours(0, 0, 0, 0);
    const end = new Date(base);
    end.setHours(23, 59, 59, 999);
    const ds = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    return { start, end, dateStr: ds };
  }

  try {
    // Wall-clock midnight of that date in the client zone, expressed as a UTC instant.
    const utcMidnight = new Date(`${valid}T00:00:00Z`);
    // Offset sampled at local noon to stay correct across DST shifts
    const offset = tzOffsetMs(tz, new Date(utcMidnight.getTime() + 12 * 3600_000));
    const start = new Date(utcMidnight.getTime() - offset);
    const end = new Date(start.getTime() + 86_400_000 - 1);
    return { start, end, dateStr: valid };
  } catch {
    return zonedDayBounds(valid, null);
  }
}

export function isFiniteDate(d: Date): boolean {
  return !isNaN(d.getTime());
}
