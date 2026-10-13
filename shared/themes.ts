import type { League } from "./types.ts";

/**
 * Weekday themes for the Daily Gauntlet (dates are America/Chicago calendar days).
 * Saturday and Sunday stay the normal mixed set.
 */

/** First day the weekday themes apply. Earlier sets were written before themes existed. */
export const WEEKLY_THEMES_START = "2026-10-14";

/** Division Friday cycles through these in order, one per week. */
export const DIVISIONS = [
  "AFC East",
  "NFC East",
  "AFC North",
  "NFC North",
  "AFC South",
  "NFC South",
  "AFC West",
  "NFC West",
] as const;

/** The Friday that features DIVISIONS[0]. */
const DIVISION_ANCHOR = "2026-10-16";

export interface WeeklyTheme {
  key: "nfl" | "college" | "hodgepodge" | "throwback" | "division";
  /** shown on the Daily screen, e.g. "Throwback Thursday" */
  name: string;
  /** one-line description for players */
  blurb: string;
  /** every question must be from this league (null = mixed) */
  league: League | null;
  /** Division Friday only */
  division?: string;
}

const DAY_MS = 86_400_000;
const utcDay = (date: string) => Date.parse(date + "T00:00:00Z");

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD calendar date */
export function weekday(date: string): number {
  return new Date(utcDay(date)).getUTCDay();
}

export function divisionFor(date: string): string {
  const weeks = Math.floor((utcDay(date) - utcDay(DIVISION_ANCHOR)) / (7 * DAY_MS));
  const n = DIVISIONS.length;
  return DIVISIONS[((weeks % n) + n) % n];
}

export function weeklyTheme(date: string): WeeklyTheme | null {
  if (date < WEEKLY_THEMES_START) return null;
  switch (weekday(date)) {
    case 1:
      return { key: "nfl", name: "NFL Monday", blurb: "All NFL, all day", league: "NFL" };
    case 2:
      return { key: "college", name: "College Tuesday", blurb: "All FBS college football", league: "FBS" };
    case 3:
      return { key: "hodgepodge", name: "Hodgepodge Wednesday", blurb: "A little bit of everything", league: null };
    case 4:
      return { key: "throwback", name: "Throwback Thursday", blurb: "Everything from before the College Football Playoff", league: null };
    case 5: {
      const division = divisionFor(date);
      return { key: "division", name: `Division Friday: ${division}`, blurb: `All about the ${division}`, league: "NFL", division };
    }
    default:
      return null;
  }
}

// ---------------- seasonal site look ----------------

export type Season = "halloween" | "fall" | "christmas";
export const SEASONS: Season[] = ["halloween", "fall", "christmas"];

/** YYYY-MM-DD for `now` in America/Chicago (the Daily's calendar) */
export function chicagoDate(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

/** October = Halloween, November = fall, December = Christmas, otherwise the standard look. */
export function seasonFor(date: string): Season | null {
  const month = Number(date.slice(5, 7));
  return month === 10 ? "halloween" : month === 11 ? "fall" : month === 12 ? "christmas" : null;
}
