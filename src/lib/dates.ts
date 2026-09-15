// Pure date/timezone helpers for scheduling weeks in America/New_York.
// No library dependency — DST-correct via the "guess and correct with
// Intl" trick: format a candidate UTC instant back into ET wall-clock
// time, measure the drift from what was intended, and shift by that
// drift. Works for any date because it asks Intl what the *actual*
// offset was on that specific date, rather than hardcoding EST/EDT.

export const LEAGUE_TIME_ZONE = "America/New_York";

export type CalendarDate = { year: number; month: number; day: number };

function partsOf(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Wall-clock date/time in America/New_York -> the UTC instant it represents. */
export function etWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const shownInEt = partsOf(new Date(naiveUtc), LEAGUE_TIME_ZONE);
  const etAsUtc = Date.UTC(
    shownInEt.year,
    shownInEt.month - 1,
    shownInEt.day,
    shownInEt.hour,
    shownInEt.minute,
    shownInEt.second,
  );
  return new Date(naiveUtc + (naiveUtc - etAsUtc));
}

/** A UTC instant -> its calendar date as displayed in America/New_York. */
export function etCalendarDateOf(date: Date): CalendarDate {
  const { year, month, day } = partsOf(date, LEAGUE_TIME_ZONE);
  return { year, month, day };
}

/** Pure calendar-date arithmetic — no timezone involved, just Y/M/D shifting. */
export function addCalendarDays(base: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Parse an ISO "YYYY-MM-DD" date-only string (e.g. from a date input). */
export function parseIsoDateOnly(iso: string): CalendarDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

/** Day of week for a calendar date, 0=Sun..6=Sat — pure, no timezone. */
export function dayOfWeekOf(date: CalendarDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}
