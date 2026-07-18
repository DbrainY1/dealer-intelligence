// Tests for the canonical cutoff helpers.
// Runner: node --experimental-strip-types --test lib/cutoff.test.ts
// "today" is always injected — never the wall clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_COMPUTED_BY,
  isCanonicalRow,
  cutoffLabel,
  elapsedDaysInclusive,
  cutoffPace,
  cutoffDaysOfSupply,
  paceDenominator,
  soldCellValue,
  pacificToday,
} from "./cutoff.ts";

// 1. Non-NULL cutoff renders a label derived from the date value.
test("cutoff label is derived from the projection_cutoff date", () => {
  assert.equal(cutoffLabel("2026-07-11"), "Since Jul 11");
  assert.equal(cutoffLabel("2026-07-11", "Sold Since"), "Sold Since Jul 11");
});

// 2. A different cutoff date produces a different label — no date is hardcoded.
test("a different cutoff date produces a different label", () => {
  assert.equal(cutoffLabel("2026-08-03"), "Since Aug 3");
  assert.equal(cutoffLabel("2026-01-01"), "Since Jan 1");
  assert.equal(cutoffLabel("2025-12-25"), "Since Dec 25");
  assert.notEqual(cutoffLabel("2026-08-03"), cutoffLabel("2026-07-11"));
});

// 3. NULL cutoff → no cutoff label (caller preserves its normal MTD/month label).
test("NULL cutoff yields no cutoff label", () => {
  assert.equal(cutoffLabel(null), null);
  assert.equal(cutoffLabel(undefined), null);
  assert.equal(cutoffLabel(""), null);
});

// 4/5/6. Inclusive elapsed-day denominator.
test("Jul 11 through Jul 11 is an inclusive denominator of 1", () => {
  assert.equal(elapsedDaysInclusive("2026-07-11", "2026-07-11"), 1);
});
test("Jul 11 through Jul 17 is an inclusive denominator of 7", () => {
  assert.equal(elapsedDaysInclusive("2026-07-11", "2026-07-17"), 7);
});
test("Jul 11 through Jul 18 is an inclusive denominator of 8", () => {
  assert.equal(elapsedDaysInclusive("2026-07-11", "2026-07-18"), 8);
});

test("elapsed days protects against zero/negative denominators", () => {
  assert.equal(elapsedDaysInclusive("2026-07-11", "2026-07-11"), 1); // same day → 1
  assert.equal(elapsedDaysInclusive("2026-07-20", "2026-07-18"), 1); // cutoff in future → clamp 1
});

// 7. America/Los_Angeles calendar boundaries are used.
test("pacificToday uses America/Los_Angeles calendar boundaries", () => {
  // 2026-07-18 06:30 UTC = 2026-07-17 23:30 Pacific (PDT, -07:00) → still the 17th.
  assert.equal(pacificToday(new Date("2026-07-18T06:30:00Z")), "2026-07-17");
  // 2026-07-18 07:30 UTC = 2026-07-18 00:30 Pacific → now the 18th.
  assert.equal(pacificToday(new Date("2026-07-18T07:30:00Z")), "2026-07-18");
  // And the elapsed count reflects that Pacific boundary, not UTC.
  const lateUtc = pacificToday(new Date("2026-07-18T06:30:00Z")); // "2026-07-17"
  assert.equal(elapsedDaysInclusive("2026-07-11", lateUtc), 7);
});

// 8. NULL cutoff preserves the existing pace / DoS denominator (day-of-month).
test("NULL cutoff preserves the existing day-of-month denominator", () => {
  assert.equal(paceDenominator(null, 18, "2026-07-18"), 18);
  assert.equal(paceDenominator(undefined, 30, "2026-07-30"), 30);
  // non-NULL cutoff switches to the inclusive canonical elapsed days
  assert.equal(paceDenominator("2026-07-11", 18, "2026-07-18"), 8);
});

// 9. computed_by IS NULL is not presented as canonical confirmed-sales truth.
test("only the canonical computed_by stamp counts as canonical", () => {
  assert.equal(isCanonicalRow(CANONICAL_COMPUTED_BY), true);
  assert.equal(isCanonicalRow("canonical_inventory_events_v1"), true);
  assert.equal(isCanonicalRow(null), false);
  assert.equal(isCanonicalRow(undefined), false);
  assert.equal(isCanonicalRow("legacy_removal_detector"), false);
  assert.equal(isCanonicalRow(""), false);
});

// 10. Canonical units_sold = 0 remains visible as 0 (not treated as missing).
test("a canonical zero stays visible as 0; only a missing row is —", () => {
  assert.equal(soldCellValue(0, true), 0);        // Platinum / Desert 215 = 0
  assert.equal(soldCellValue(8, true), 8);
  assert.equal(soldCellValue(null, true), 0);     // present row, null units → 0
  assert.equal(soldCellValue(null, false), null); // missing row → "—"
});

// 11. Globul fixture: units 8, cutoff 2026-07-11, today 2026-07-18 → pace 31.
test("Globul: 8 units since Jul 11 viewed Jul 18 → 31-day pace of 31", () => {
  const pace = cutoffPace(8, "2026-07-11", 31, "2026-07-18");
  assert.equal(pace, 31);
  assert.notEqual(pace, 14); // old day-of-month denominator (8/18*31)
  assert.notEqual(pace, 35); // wrong exclusive 7-day denominator (8/7*31)
});

test("cutoff Days of Supply uses inclusive elapsed days", () => {
  // Globul: 8 in stock example — inStock 100, 8 sold, elapsed 8 → 100*8/8 = 100.
  assert.equal(cutoffDaysOfSupply(100, 8, "2026-07-11", "2026-07-18"), 100);
  // zero sold → null (infinite supply), same contract as the day-of-month formula
  assert.equal(cutoffDaysOfSupply(50, 0, "2026-07-11", "2026-07-18"), null);
});
