// Pacific (America/Los_Angeles) calendar-date helpers.
//
// Daily market views are anchored to the Pacific calendar date so the website
// matches the DBRAIN Daily Market Movement email's date axis. Using UTC here
// would drift a day during the evening Pacific window.

const PACIFIC_TZ = "America/Los_Angeles";

/** Pacific calendar date for `base` (default: now) as a YYYY-MM-DD string. */
export function pacificDateStr(base: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD; timeZone yields the Pacific wall-clock date.
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC_TZ }).format(base);
}

/** Pacific calendar date `days` days before today, as a YYYY-MM-DD string. */
export function pacificDaysAgoStr(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return pacificDateStr(d);
}
