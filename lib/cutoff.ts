// Canonical monthly_sales cutoff helpers (pure, testable).
//
// DBRAIN's monthly_sales projection stamps each canonical row with:
//   computed_by        = 'canonical_inventory_events_v1'
//   projection_cutoff  = the partial-month boundary (e.g. '2026-07-11')
// units_sold on a canonical current-month row counts confirmed departures
// beginning on projection_cutoff — NOT from the 1st of the month. So any
// MTD/month label and any daily-pace / Days-of-Supply denominator derived from
// it must be cutoff-aware, or velocity is understated for the partial month.
//
// Legacy rows (computed_by NULL) are pre-canonical frozen values and must never
// be presented as canonical confirmed sales; for them, callers preserve their
// existing plain MTD/month behavior.

const PACIFIC_TZ = "America/Los_Angeles";
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** The stamp the DBRAIN canonical projection writes to monthly_sales.computed_by. */
export const CANONICAL_COMPUTED_BY = "canonical_inventory_events_v1";

/** True only for a monthly_sales row produced by the canonical projection. A
 *  NULL/legacy/other computed_by is not canonical confirmed-sales truth. */
export function isCanonicalRow(computedBy: string | null | undefined): boolean {
  return computedBy === CANONICAL_COMPUTED_BY;
}

/** Parse a 'YYYY-MM-DD' calendar-date string into numeric parts (no TZ drift —
 *  the value is a plain date, not an instant). Returns null if unparseable. */
function parseYMD(dateStr: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * Cutoff-aware label derived from projection_cutoff, e.g. "Since Jul 11".
 * The month/day come entirely from the date value — no date is hardcoded.
 * Returns null when the cutoff is absent (caller keeps its plain MTD label).
 * `prefix` lets each surface pick the smallest wording ("Since", "Sold Since").
 */
export function cutoffLabel(
  projectionCutoff: string | null | undefined,
  prefix = "Since",
): string | null {
  const parts = parseYMD(projectionCutoff);
  if (!parts) return null;
  const mon = MONTHS[parts.m - 1];
  if (!mon) return null;
  return `${prefix} ${mon} ${parts.d}`;
}

/** Whole calendar days between two 'YYYY-MM-DD' dates (to − from). */
function calendarDaysBetween(fromYMD: string, toYMD: string): number {
  const a = parseYMD(fromYMD);
  const b = parseYMD(toYMD);
  if (!a || !b) return 0;
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000,
  );
}

/** Today's Pacific calendar date as 'YYYY-MM-DD'. Injectable for tests. */
export function pacificToday(base: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC_TZ }).format(base);
}

/**
 * Inclusive count of America/Los_Angeles calendar days from projection_cutoff
 * through today (both endpoints counted):
 *   Jul 11 → Jul 11 = 1
 *   Jul 11 → Jul 17 = 7
 *   Jul 11 → Jul 18 = 8
 * Always ≥ 1 (protects pace/DoS against zero or negative denominators, e.g. if
 * the cutoff is somehow in the future or equal to today).
 */
export function elapsedDaysInclusive(
  projectionCutoff: string | null | undefined,
  todayStr: string = pacificToday(),
): number {
  const parts = parseYMD(projectionCutoff);
  if (!parts) return 1;
  const days = calendarDaysBetween(projectionCutoff as string, todayStr) + 1;
  return days >= 1 ? days : 1;
}

/**
 * Cutoff-aware pace: project the canonical partial-month units to a full month.
 *   pace = round(units / elapsedDaysInclusive * daysInMonth)
 * Used only when projection_cutoff is non-NULL. Callers keep their existing
 * day-of-month behavior when it is NULL.
 */
export function cutoffPace(
  units: number,
  projectionCutoff: string | null | undefined,
  daysInMonth: number,
  todayStr: string = pacificToday(),
): number {
  const elapsed = elapsedDaysInclusive(projectionCutoff, todayStr);
  return Math.round((units / elapsed) * daysInMonth);
}

/**
 * Pace/DoS denominator selector. When projection_cutoff is non-NULL, use the
 * inclusive canonical elapsed-day count; otherwise preserve the caller's
 * existing day-of-month denominator exactly.
 */
export function paceDenominator(
  projectionCutoff: string | null | undefined,
  dayOfMonth: number,
  todayStr: string = pacificToday(),
): number {
  if (!projectionCutoff) return dayOfMonth;
  return elapsedDaysInclusive(projectionCutoff, todayStr);
}

/**
 * Display value for a monthly_sales "sold" cell. A missing row (rowPresent
 * false) → null so the caller renders "—"; a present value — including a
 * legitimate canonical 0 — renders as its number (0 is never treated as
 * missing).
 */
export function soldCellValue(
  unitsSold: number | null | undefined,
  rowPresent: boolean,
): number | null {
  if (!rowPresent) return null;
  return unitsSold ?? 0;
}

/**
 * Cutoff-aware Days of Supply: inventory ÷ canonical daily sales rate.
 *   DoS = round(inStock * elapsedDaysInclusive / units)   (units > 0)
 * Returns null when units is 0 (infinite supply — same contract as the existing
 * day-of-month formula). Used only when projection_cutoff is non-NULL.
 */
export function cutoffDaysOfSupply(
  inStock: number,
  units: number,
  projectionCutoff: string | null | undefined,
  todayStr: string = pacificToday(),
): number | null {
  if (units <= 0) return null;
  const elapsed = elapsedDaysInclusive(projectionCutoff, todayStr);
  return Math.round((inStock * elapsed) / units);
}
