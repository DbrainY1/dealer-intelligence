// Freshness bucketing and market-scope rules.
//
// Covers the product rules directly: bucket boundaries, the two scopes,
// Pacific date boundaries, and automatic re-entry when a dealer recovers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarDaysBetween,
  freshnessFor,
  isInScope,
  lcdAgeDays,
  parseScope,
  scopeBuckets,
  DEFAULT_SCOPE,
} from "./freshness.ts";
import { shiftDate } from "./dealer-freshness.ts";
import { pacificDateStr } from "./dates.ts";

const TODAY = "2026-10-25";

// ── bucket boundaries ────────────────────────────────────────────────────────

test("bucket boundaries are exact and inclusive at the top of each range", () => {
  const cases: [number, string][] = [
    [0, "current"],
    [1, "current"],
    [2, "recent"],
    [7, "recent"],
    [8, "stale"],
    [14, "stale"],
    [15, "historic"],
    [120, "historic"],
  ];
  for (const [age, expected] of cases) {
    const lcd = shiftDate(TODAY, -age);
    assert.equal(freshnessFor(lcd, TODAY), expected, `age ${age} should be ${expected}`);
  }
});

test("a dealer that never captured is historic, never 'current with zero'", () => {
  assert.equal(freshnessFor(null, TODAY), "historic");
  assert.equal(freshnessFor(undefined, TODAY), "historic");
  assert.equal(lcdAgeDays(null, TODAY), null);
});

test("a future-dated capture (clock skew) clamps to current, never negative age", () => {
  assert.equal(freshnessFor("2026-10-26", TODAY), "current");
  assert.equal(lcdAgeDays("2026-10-26", TODAY), 0);
});

// ── scope selection ──────────────────────────────────────────────────────────

test("REQUIRED 1: Current + Recent includes LCD 0–7 days", () => {
  for (let age = 0; age <= 7; age++) {
    const f = freshnessFor(shiftDate(TODAY, -age), TODAY);
    assert.equal(isInScope(f, "current_recent"), true, `age ${age} must be in scope`);
  }
});

test("REQUIRED 2: Current Only includes LCD 0–1 days and nothing else", () => {
  assert.equal(isInScope(freshnessFor(shiftDate(TODAY, -0), TODAY), "current"), true);
  assert.equal(isInScope(freshnessFor(shiftDate(TODAY, -1), TODAY), "current"), true);
  for (let age = 2; age <= 10; age++) {
    const f = freshnessFor(shiftDate(TODAY, -age), TODAY);
    assert.equal(isInScope(f, "current"), false, `age ${age} must be out of scope`);
  }
});

test("REQUIRED 3: Stale and Historic are excluded from every current-market scope", () => {
  for (const age of [8, 14, 15, 90]) {
    const f = freshnessFor(shiftDate(TODAY, -age), TODAY);
    assert.equal(isInScope(f, "current"), false, `age ${age} vs current`);
    assert.equal(isInScope(f, "current_recent"), false, `age ${age} vs current+recent`);
  }
});

test("default scope is Current + Recent", () => {
  assert.equal(DEFAULT_SCOPE, "current_recent");
  assert.deepEqual(scopeBuckets("current_recent"), ["current", "recent"]);
  assert.deepEqual(scopeBuckets("current"), ["current"]);
});

test("parseScope only accepts the explicit opt-in, everything else defaults", () => {
  assert.equal(parseScope("current"), "current");
  assert.equal(parseScope("current_recent"), "current_recent");
  assert.equal(parseScope(undefined), "current_recent");
  assert.equal(parseScope("garbage"), "current_recent");
  assert.equal(parseScope(["current"]), "current", "array search params are handled");
});

// ── REQUIRED 6: Pacific date boundaries ──────────────────────────────────────

test("REQUIRED 6: freshness uses the Pacific calendar date, not UTC", () => {
  // 2026-10-26 06:00Z is still 2026-10-25 at 23:00 in Los Angeles.
  const instant = new Date("2026-10-26T06:00:00Z");
  assert.equal(instant.toISOString().slice(0, 10), "2026-10-26", "UTC has already rolled over");
  assert.equal(pacificDateStr(instant), "2026-10-25", "Pacific has not");

  // A capture dated 2026-10-25 is therefore age 0 (current), not age 1.
  assert.equal(freshnessFor("2026-10-25", pacificDateStr(instant)), "current");
  assert.equal(lcdAgeDays("2026-10-25", pacificDateStr(instant)), 0);
});

test("calendar arithmetic survives the PT daylight-saving transition", () => {
  // DST ends 2026-11-01 in America/Los_Angeles; that day has 25 hours.
  assert.equal(calendarDaysBetween("2026-10-31", "2026-11-02"), 2);
  assert.equal(calendarDaysBetween("2026-11-01", "2026-11-02"), 1);
  assert.equal(shiftDate("2026-11-02", -2), "2026-10-31");
  // And across the spring-forward boundary (23-hour day).
  assert.equal(calendarDaysBetween("2027-03-13", "2027-03-15"), 2);
  assert.equal(shiftDate("2027-03-15", -2), "2027-03-13");
});

test("calendar arithmetic crosses month and year boundaries", () => {
  assert.equal(calendarDaysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(calendarDaysBetween("2026-02-28", "2026-03-01"), 1); // 2026 is not a leap year
  assert.equal(shiftDate("2027-01-01", -1), "2026-12-31");
});

// ── REQUIRED 7: recovery ─────────────────────────────────────────────────────

test("REQUIRED 7: a recovered dealer re-enters scope automatically, with no state change", () => {
  const lcdWhileDown = shiftDate(TODAY, -40);
  assert.equal(freshnessFor(lcdWhileDown, TODAY), "historic");
  assert.equal(isInScope(freshnessFor(lcdWhileDown, TODAY), "current_recent"), false);

  // One validated capture lands today. Nothing else about the dealer changes —
  // no flag is flipped, no row is written by DealerIQ.
  const lcdAfterRecovery = TODAY;
  assert.equal(freshnessFor(lcdAfterRecovery, TODAY), "current");
  assert.equal(isInScope(freshnessFor(lcdAfterRecovery, TODAY), "current_recent"), true);
  assert.equal(isInScope(freshnessFor(lcdAfterRecovery, TODAY), "current"), true);
});

test("recovery also works into the Recent band without reaching Current", () => {
  const lcd = shiftDate(TODAY, -5);
  assert.equal(freshnessFor(lcd, TODAY), "recent");
  assert.equal(isInScope(freshnessFor(lcd, TODAY), "current_recent"), true);
  assert.equal(isInScope(freshnessFor(lcd, TODAY), "current"), false);
});

// ── drift: a dealer silently ages out ────────────────────────────────────────

test("a dealer ages out of scope as days pass with no new capture", () => {
  const lcd = "2026-10-25";
  assert.equal(freshnessFor(lcd, "2026-10-26"), "current"); // 1
  assert.equal(freshnessFor(lcd, "2026-10-27"), "recent"); // 2
  assert.equal(freshnessFor(lcd, "2026-11-01"), "recent"); // 7
  assert.equal(freshnessFor(lcd, "2026-11-02"), "stale"); // 8
  assert.equal(freshnessFor(lcd, "2026-11-09"), "historic"); // 15
});
