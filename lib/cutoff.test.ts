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
  isCanonicalSoldEvent,
  canonicalSoldEvents,
  type SoldEventLike,
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

// ── Dealer-detail canonical sold population (PR #8 amendment) ────────────────
const CUTOFF = "2026-07-11";

// A canonical resolved sold event (linked, not excluded, on/after cutoff).
// Each call gets a unique default source_pending_event_id + id so, absent an
// explicit override, events count as separate units.
let _pid = 0;
function canon(overrides: Partial<SoldEventLike> & { last_seen_price?: number } = {}) {
  _pid += 1;
  return {
    id: _pid,
    event_type: "sold",
    event_status: "resolved",
    source_pending_event_id: _pid,
    excluded_from_metrics: false,
    event_date: "2026-07-12",
    created_at: "2026-07-12T00:00:00Z",
    last_seen_price: 20000,
    ...overrides,
  } as SoldEventLike & { last_seen_price: number };
}

test("1. a legacy sold event before the cutoff is excluded", () => {
  const events = [canon(), { event_type: "sold", event_status: null, source_pending_event_id: null, excluded_from_metrics: false, event_date: "2026-07-02", last_seen_price: 9999 }];
  const out = canonicalSoldEvents(events, CUTOFF);
  assert.equal(out.length, 1);
  assert.equal(isCanonicalSoldEvent(events[1], CUTOFF), false);
});

test("2. a legacy/noncanonical event after the cutoff is excluded", () => {
  // after cutoff but event_status NULL and unlinked → not canonical
  const legacyAfter = { event_type: "sold", event_status: null, source_pending_event_id: null, excluded_from_metrics: false, event_date: "2026-07-15", last_seen_price: 9999 };
  assert.equal(isCanonicalSoldEvent(legacyAfter, CUTOFF), false);
  // resolved but missing source_pending_event_id → excluded
  const unlinked = { ...canon(), source_pending_event_id: null };
  assert.equal(isCanonicalSoldEvent(unlinked, CUTOFF), false);
  // excluded_from_metrics = true → excluded
  assert.equal(isCanonicalSoldEvent({ ...canon(), excluded_from_metrics: true }, CUTOFF), false);
});

test("3. a resolved+linked+not-excluded event counts even with a different confidence/reason_code", () => {
  // confidence/reason_code are extra fields not in SoldEventLike; the predicate
  // must include the row regardless of them.
  const futurePathway = { ...canon(), confidence: "low", reason_code: "some_future_sold_pathway" } as SoldEventLike;
  assert.equal(isCanonicalSoldEvent(futurePathway, CUTOFF), true);
  assert.equal(canonicalSoldEvents([futurePathway], CUTOFF).length, 1);
  // excluded_from_metrics NULL also passes (IS NOT TRUE)
  assert.equal(isCanonicalSoldEvent({ ...canon(), excluded_from_metrics: null }, CUTOFF), true);
});

test("4. confidence and reason_code are not used as extra filters", () => {
  const a = { ...canon(), confidence: "high", reason_code: "no_reappearance_sold" } as SoldEventLike;
  const b = { ...canon(), confidence: "medium", reason_code: "something_else" } as SoldEventLike;
  const c = { ...canon(), confidence: null, reason_code: null } as SoldEventLike;
  assert.equal(canonicalSoldEvents([a, b, c], CUTOFF).length, 3);
});

// Fixtures mirroring production shapes: N canonical events + M legacy pre-cutoff.
function dealerFixture(canonN: number, legacyPreCutoff: number) {
  const out: SoldEventLike[] = [];
  for (let i = 0; i < canonN; i++)
    out.push(canon({ source_pending_event_id: 2000 + i, event_date: "2026-07-12", last_seen_price: 20000 }));
  for (let i = 0; i < legacyPreCutoff; i++)
    out.push({ event_type: "sold", event_status: null, source_pending_event_id: null, excluded_from_metrics: false, event_date: "2026-07-02", last_seen_price: 9999 });
  return out;
}

test("5. Queen reconciles to 11 (not the legacy 12)", () => {
  const events = dealerFixture(11, 1); // 11 canonical + 1 pre-cutoff legacy
  assert.equal(events.length, 12);
  assert.equal(canonicalSoldEvents(events, CUTOFF).length, 11);
});

test("6. Emporio reconciles to 2 (not the legacy 3)", () => {
  const events = dealerFixture(2, 1); // 2 canonical + 1 pre-cutoff legacy
  assert.equal(events.length, 3);
  assert.equal(canonicalSoldEvents(events, CUTOFF).length, 2);
});

test("7. Globul remains 8 (all canonical, no legacy noise)", () => {
  const events = dealerFixture(8, 0);
  assert.equal(canonicalSoldEvents(events, CUTOFF).length, 8);
});

test("8. count, pace, average price and revenue use the same filtered population", () => {
  // 2 canonical @ 20000 + 1 legacy pre-cutoff @ 9999. All four metrics must
  // derive from the canonical set (the 9999 must not leak into revenue/avg).
  const events = [
    canon({ source_pending_event_id: 1, last_seen_price: 20000 }),
    canon({ source_pending_event_id: 2, last_seen_price: 30000 }),
    { event_type: "sold", event_status: null, source_pending_event_id: null, excluded_from_metrics: false, event_date: "2026-07-02", last_seen_price: 9999 },
  ];
  const pop = canonicalSoldEvents(events, CUTOFF);
  const count = pop.length;
  const revenue = pop.reduce((s, e) => s + ((e as { last_seen_price?: number }).last_seen_price ?? 0), 0);
  const avg = count > 0 ? revenue / count : 0;
  const pace = cutoffPace(count, CUTOFF, 31, "2026-07-18");
  assert.equal(count, 2);
  assert.equal(revenue, 50000);        // 9999 legacy excluded
  assert.equal(avg, 25000);
  assert.equal(pace, cutoffPace(2, CUTOFF, 31, "2026-07-18")); // pace uses the same count
});

test("9. dealer-detail canonical count equals monthly_sales.units_sold", () => {
  // For each dealer, the canonical population size must equal units_sold.
  const cases = [
    { unitsSold: 8, fixture: dealerFixture(8, 0) },   // Globul
    { unitsSold: 11, fixture: dealerFixture(11, 1) },  // Queen
    { unitsSold: 2, fixture: dealerFixture(2, 1) },   // Emporio
  ];
  for (const { unitsSold, fixture } of cases) {
    assert.equal(canonicalSoldEvents(fixture, CUTOFF).length, unitsSold);
  }
});

// ── Distinct pending-event parity (PR #8 final amendment) ───────────────────
test("dedup: two canonical rows sharing a source_pending_event_id count as one", () => {
  const events = [
    canon({ id: 1, source_pending_event_id: 500, last_seen_price: 20000, created_at: "2026-07-12T00:00:00Z" }),
    canon({ id: 2, source_pending_event_id: 500, last_seen_price: 20000, created_at: "2026-07-12T05:00:00Z" }),
  ];
  const pop = canonicalSoldEvents(events, CUTOFF);
  assert.equal(pop.length, 1);                       // one sold unit
});

test("dedup: revenue is not double-counted and average is not distorted", () => {
  const events = [
    canon({ id: 1, source_pending_event_id: 500, last_seen_price: 20000, created_at: "2026-07-12T00:00:00Z" }),
    canon({ id: 2, source_pending_event_id: 500, last_seen_price: 20000, created_at: "2026-07-12T05:00:00Z" }),
    canon({ id: 3, source_pending_event_id: 501, last_seen_price: 30000, created_at: "2026-07-12T00:00:00Z" }),
  ];
  const pop = canonicalSoldEvents(events, CUTOFF);
  const count = pop.length;
  const revenue = pop.reduce((s, e) => s + ((e as { last_seen_price?: number }).last_seen_price ?? 0), 0);
  assert.equal(count, 2);                            // two distinct pending ids
  assert.equal(revenue, 50000);                      // 20000 counted once + 30000, not 70000
  assert.equal(revenue / count, 25000);              // average undistorted
});

test("dedup: the Vehicles Sold list shows one item per pending id", () => {
  const events = [
    canon({ id: 1, source_pending_event_id: 500, created_at: "2026-07-12T00:00:00Z" }),
    canon({ id: 2, source_pending_event_id: 500, created_at: "2026-07-12T05:00:00Z" }),
  ];
  assert.equal(canonicalSoldEvents(events, CUTOFF).length, 1);
});

test("dedup: different source_pending_event_id values still count separately", () => {
  const events = [
    canon({ id: 1, source_pending_event_id: 500 }),
    canon({ id: 2, source_pending_event_id: 501 }),
    canon({ id: 3, source_pending_event_id: 502 }),
  ];
  assert.equal(canonicalSoldEvents(events, CUTOFF).length, 3);
});

test("dedup: representative is the newest created_at, tie broken by highest id", () => {
  const events = [
    canon({ id: 10, source_pending_event_id: 500, last_seen_price: 100, created_at: "2026-07-12T00:00:00Z" }),
    canon({ id: 11, source_pending_event_id: 500, last_seen_price: 200, created_at: "2026-07-14T00:00:00Z" }), // newest
    canon({ id: 12, source_pending_event_id: 500, last_seen_price: 300, created_at: "2026-07-13T00:00:00Z" }),
  ];
  const pop = canonicalSoldEvents(events, CUTOFF);
  assert.equal(pop.length, 1);
  assert.equal((pop[0] as { last_seen_price?: number }).last_seen_price, 200); // newest created_at wins
  // created_at tie → higher id wins
  const tie = [
    canon({ id: 20, source_pending_event_id: 501, last_seen_price: 1, created_at: "2026-07-12T00:00:00Z" }),
    canon({ id: 21, source_pending_event_id: 501, last_seen_price: 2, created_at: "2026-07-12T00:00:00Z" }),
  ];
  assert.equal((canonicalSoldEvents(tie, CUTOFF)[0] as { last_seen_price?: number }).last_seen_price, 2);
});

test("dedup: NOT deduplicated by VIN/vehicle_id/event_date — two stints of one VIN count twice", () => {
  // Same vehicle, two distinct pending detections (two sales) → two units.
  const events = [
    { ...canon({ id: 1, source_pending_event_id: 500, event_date: "2026-07-12" }), vehicle_id: 999 },
    { ...canon({ id: 2, source_pending_event_id: 600, event_date: "2026-07-12" }), vehicle_id: 999 },
  ] as SoldEventLike[];
  assert.equal(canonicalSoldEvents(events, CUTOFF).length, 2);
});

test("dedup: Queen/Emporio/Globul unchanged (no duplicate pending ids)", () => {
  // Production has a unique index on source_pending_event_id, so counts are
  // unchanged by dedup — the reconciliation still holds.
  assert.equal(canonicalSoldEvents(dealerFixture(8, 0), CUTOFF).length, 8);   // Globul
  assert.equal(canonicalSoldEvents(dealerFixture(11, 1), CUTOFF).length, 11); // Queen
  assert.equal(canonicalSoldEvents(dealerFixture(2, 1), CUTOFF).length, 2);   // Emporio
});

test("10. no canonical cutoff preserves legacy MTD behavior and wording", () => {
  // When the month is not canonical, the page uses mtdCutoff=null: the label
  // stays "MTD" and the population is the legacy filter (excluded_from_metrics
  // === false), not the canonical predicate.
  assert.equal(cutoffLabel(null) ?? "MTD", "MTD");
  const legacyEvents = [
    { event_type: "sold", event_status: null, source_pending_event_id: null, excluded_from_metrics: false, event_date: "2026-07-02", last_seen_price: 9999 },
    { event_type: "sold", event_status: null, source_pending_event_id: null, excluded_from_metrics: true, event_date: "2026-07-05", last_seen_price: 1 },
  ] as (SoldEventLike & { excluded_from_metrics: boolean })[];
  const legacyPop = legacyEvents.filter((e) => e.excluded_from_metrics === false);
  assert.equal(legacyPop.length, 1); // legacy behavior unchanged (excluded=false only)
  // and the day-of-month denominator is preserved when there is no cutoff
  assert.equal(paceDenominator(null, 18, "2026-07-18"), 18);
});
