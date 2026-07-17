// Focused tests for the pure VIN-history helpers.
// Runner: Node's built-in test runner with native TypeScript type-stripping —
//   npm test  →  node --experimental-strip-types --test lib/vin-history.test.ts
// No framework dependency; "today" is always injected, never the wall clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTimeline,
  computeDaysOnMarket,
  computeLifecycle,
  daysBetween,
  getEventDisplay,
  sortEvents,
  type InventoryEvent,
} from "./vin-history.ts";

const TODAY = "2026-07-16"; // injected market-calendar date for every test

let seq = 1;
function mk(partial: Partial<InventoryEvent> & { event_type: InventoryEvent["event_type"]; event_date: string }): InventoryEvent {
  return {
    id: partial.id ?? seq++,
    vehicle_id: 500,
    to_dealer_id: null,
    dealer_group_id: null,
    from_dealer_id: null,
    old_price: null,
    new_price: null,
    price_at_listing: null,
    last_seen_price: null,
    last_seen_mileage: null,
    first_seen_date: null,
    event_status: null,
    source_pending_event_id: null,
    ...partial,
  };
}

function frozen(events: InventoryEvent[]): InventoryEvent[] {
  for (const e of events) Object.freeze(e);
  return Object.freeze(events) as InventoryEvent[];
}

// ── The three production evidence VINs (histories captured read-only) ────────

// VIN 1N4BL4EVXKC245343 — single legacy ADDED 2026-07-05 (Emporio #15).
const VIN_1 = frozen([
  mk({ id: 28744, event_type: "added", event_date: "2026-07-05", from_dealer_id: 15 }),
]);

// VIN WBAFR9C58DDX80823 — legacy: added 6/28, sold 6/30, added 7/01, dup added 7/03.
const VIN_2 = frozen([
  mk({ id: 26609, event_type: "added", event_date: "2026-06-28", from_dealer_id: 15 }),
  mk({ id: 27101, event_type: "sold", event_date: "2026-06-30", from_dealer_id: 15 }),
  mk({ id: 27895, event_type: "added", event_date: "2026-07-01", to_dealer_id: 15 }),
  mk({ id: 28265, event_type: "added", event_date: "2026-07-03", to_dealer_id: 15 }),
]);

// VIN ZAM57XSA5J1293370 — legacy: added 7/01, price_changed 7/16 (Platinum #7).
const VIN_3 = frozen([
  mk({ id: 27423, event_type: "added", event_date: "2026-07-01", from_dealer_id: 7 }),
  mk({ id: 31235, event_type: "price_changed", event_date: "2026-07-16", from_dealer_id: 7 }),
]);

// ── Days on Market: the three supplied histories ─────────────────────────────

test("VIN 1: single added 7/05, no departure → DoM 11d, Active", () => {
  assert.equal(computeDaysOnMarket(VIN_1, TODAY), 11);
  assert.equal(computeLifecycle(VIN_1).status.kind, "active");
});

test("VIN 2: legacy sold segments stints; current anchor 7/01 → DoM 15d, not Sold", () => {
  assert.equal(computeDaysOnMarket(VIN_2, TODAY), 15);
  const { status } = computeLifecycle(VIN_2);
  assert.equal(status.kind, "active"); // legacy sold must NOT make status Sold
});

test("VIN 3: price change controls neither anchor nor endpoint → DoM 15d", () => {
  assert.equal(computeDaysOnMarket(VIN_3, TODAY), 15);
  assert.equal(computeLifecycle(VIN_3).status.kind, "active");
});

// ── Status precedence ────────────────────────────────────────────────────────

test("legacy sold as last event → Unconfirmed, never Sold", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-06-01", to_dealer_id: 4 }),
    mk({ event_type: "sold", event_date: "2026-06-20", from_dealer_id: 4 }),
  ]);
  const { status } = computeLifecycle(events);
  assert.equal(status.kind, "unconfirmed");
  assert.equal(computeDaysOnMarket(events, TODAY), null); // honest —, not a number
});

test("legacy removed as last event + current-inventory context → Active fallback", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-06-01", to_dealer_id: 4 }),
    mk({ event_type: "removed", event_date: "2026-06-20", from_dealer_id: 4 }),
  ]);
  assert.equal(computeLifecycle(events).status.kind, "unconfirmed");
  assert.equal(
    computeLifecycle(events, { inCurrentInventory: true }).status.kind,
    "active"
  );
});

test("canonical resolved sold → Sold, DoM frozen at departure date", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ id: 900, event_type: "pending_removal", event_date: "2026-07-11", from_dealer_id: 4, event_status: "resolved" }),
    mk({ id: 901, event_type: "sold", event_date: "2026-07-11", from_dealer_id: 4, event_status: "resolved", source_pending_event_id: 900 }),
  ]);
  const { status } = computeLifecycle(events);
  assert.equal(status.kind, "sold");
  assert.equal(computeDaysOnMarket(events, TODAY), 10); // 7/01 → 7/11, not → today
});

test("canonical resolved sold wins even when caller claims current inventory", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ event_type: "sold", event_date: "2026-07-11", from_dealer_id: 4, event_status: "resolved", source_pending_event_id: 1 }),
  ]);
  assert.equal(
    computeLifecycle(events, { inCurrentInventory: true }).status.kind,
    "sold"
  );
});

test("canonical resolved transferred → Transferred", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ event_type: "transferred", event_date: "2026-07-12", from_dealer_id: 4, to_dealer_id: 5, event_status: "resolved", source_pending_event_id: 1 }),
  ]);
  assert.equal(computeLifecycle(events).status.kind, "transferred");
});

test("canonical open pending detection → Pending Departure; DoM keeps counting to today", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ event_type: "pending_removal", event_date: "2026-07-14", from_dealer_id: 4, event_status: "pending_resolution" }),
  ]);
  const { status } = computeLifecycle(events);
  assert.equal(status.kind, "pending_departure");
  assert.equal(computeDaysOnMarket(events, TODAY), 15); // stint 7/01 → today
});

test("superseded sold does not remain current; later canonical relist restores Active", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ id: 910, event_type: "sold", event_date: "2026-07-11", from_dealer_id: 4, event_status: "superseded", source_pending_event_id: 1 }),
    mk({ id: 911, event_type: "relist", event_date: "2026-07-14", from_dealer_id: 4, event_status: "resolved", source_pending_event_id: 1 }),
  ]);
  const { status } = computeLifecycle(events);
  assert.equal(status.kind, "active");
  assert.equal(computeDaysOnMarket(events, TODAY), 2); // relist 7/14 opened the current stint
});

test("transfer FROM a previous dealer does not close a newer stint at the destination", () => {
  // Real production shape (VIN 3FTTW8F94NRA34448): the vehicle reappears at the
  // destination dealer (added 7/13 @ dealer 4) BEFORE the departure-dated
  // transfer outcome row (7/14, from_dealer 11). The destination stint stays
  // open — the transfer closed the ORIGIN stint, not the new one.
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-07-01", to_dealer_id: 11 }),
    mk({ event_type: "added", event_date: "2026-07-13", to_dealer_id: 4 }),
    mk({ event_type: "transferred", event_date: "2026-07-14", from_dealer_id: 11, to_dealer_id: 4, event_status: "resolved", source_pending_event_id: 1 }),
  ]);
  const { status } = computeLifecycle(events);
  assert.equal(status.kind, "active"); // active at destination, not "Transferred"
  assert.equal(computeDaysOnMarket(events, TODAY), 3); // anchored 7/13 at dealer 4
});

test("canonical closed_unconfirmed detection → Unconfirmed (honest unknown)", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-07-01", to_dealer_id: 1 }),
    mk({ event_type: "pending_removal", event_date: "2026-07-12", from_dealer_id: 1, event_status: "closed_unconfirmed" }),
  ]);
  assert.equal(computeLifecycle(events).status.kind, "unconfirmed");
});

test("departure closes one stint, later ADDED opens another", () => {
  const events = frozen([
    mk({ event_type: "added", event_date: "2026-06-01", to_dealer_id: 4 }),
    mk({ event_type: "sold", event_date: "2026-06-10", from_dealer_id: 4, event_status: "resolved", source_pending_event_id: 1 }),
    mk({ event_type: "added", event_date: "2026-07-10", to_dealer_id: 4 }),
  ]);
  const { status } = computeLifecycle(events);
  assert.equal(status.kind, "active");
  assert.equal(computeDaysOnMarket(events, TODAY), 6); // anchored at 7/10, not 6/01
});

test("duplicate ADDED inside a stint never restarts Days on Market", () => {
  assert.equal(computeDaysOnMarket(VIN_2, TODAY), 15); // dup 7/03 ignored, anchor 7/01
});

// ── Timeline display grouping ────────────────────────────────────────────────

test("duplicate ADDEDs collapse across an intervening price change", () => {
  const events = frozen([
    mk({ id: 1, event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ id: 2, event_type: "price_changed", event_date: "2026-07-02", from_dealer_id: 4 }),
    mk({ id: 3, event_type: "added", event_date: "2026-07-03", to_dealer_id: 4 }),
  ]);
  const items = buildTimeline(events);
  assert.equal(items.length, 2); // one added group + the price change
  const added = items[0];
  assert.equal(added.event.id, 1);
  assert.equal(added.seenAgain.length, 1);
  assert.equal(added.seenAgain[0].id, 3);
});

test("ADDEDs at different dealers never collapse", () => {
  const events = frozen([
    mk({ id: 1, event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ id: 2, event_type: "added", event_date: "2026-07-03", to_dealer_id: 5 }),
  ]);
  const items = buildTimeline(events);
  assert.equal(items.length, 2);
  assert.equal(items[0].seenAgain.length, 0);
  assert.equal(items[1].seenAgain.length, 0);
});

test("a departure event breaks the ADDED collapse group", () => {
  const items = buildTimeline(VIN_2);
  // added 6/28 | legacy sold 6/30 | added 7/01 (+ seenAgain 7/03)
  assert.equal(items.length, 3);
  assert.equal(items[0].seenAgain.length, 0);
  assert.equal(items[2].event.id, 27895);
  assert.equal(items[2].seenAgain.length, 1);
  assert.equal(items[2].seenAgain[0].id, 28265);
});

test("mixed-attribution dealer identity (to ?? from) still collapses", () => {
  const events = frozen([
    mk({ id: 1, event_type: "added", event_date: "2026-07-01", from_dealer_id: 15 }),
    mk({ id: 2, event_type: "added", event_date: "2026-07-02", to_dealer_id: 15 }),
  ]);
  const items = buildTimeline(events);
  assert.equal(items.length, 1);
  assert.equal(items[0].seenAgain.length, 1);
});

test("resolved outcome nests its linked pending detection", () => {
  const events = frozen([
    mk({ id: 1, event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ id: 900, event_type: "pending_removal", event_date: "2026-07-11", from_dealer_id: 4, event_status: "resolved" }),
    mk({ id: 901, event_type: "sold", event_date: "2026-07-11", from_dealer_id: 4, event_status: "resolved", source_pending_event_id: 900 }),
  ]);
  const items = buildTimeline(events);
  assert.equal(items.length, 2); // detection row not rendered standalone
  const sold = items[1];
  assert.equal(sold.event.id, 901);
  assert.equal(sold.nestedDetection?.id, 900);
});

test("unresolved pending detection remains visible", () => {
  const events = frozen([
    mk({ id: 1, event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
    mk({ id: 902, event_type: "pending_removal", event_date: "2026-07-14", from_dealer_id: 4, event_status: "pending_resolution" }),
  ]);
  const items = buildTimeline(events);
  assert.equal(items.length, 2);
  assert.equal(items[1].event.id, 902);
});

// ── Display labels: every type × population gets a non-empty label ──────────

test("every supported event type receives a non-empty display label", () => {
  const variants: Array<[InventoryEvent["event_type"], InventoryEvent["event_status"] | null]> = [
    ["added", null],
    ["price_changed", null],
    ["sold", null],
    ["sold", "resolved"],
    ["sold", "superseded"],
    ["removed", null],
    ["transferred", null],
    ["transferred", "resolved"],
    ["transferred", "superseded"],
    ["relist", null],
    ["relist", "resolved"],
    ["relist", "superseded"],
    ["pending_removal", null],
    ["pending_removal", "pending_resolution"],
    ["pending_removal", "resolved"],
    ["pending_removal", "closed_unconfirmed"],
  ];
  for (const [type, status] of variants) {
    const d = getEventDisplay(
      mk({ event_type: type, event_date: "2026-07-01", event_status: status })
    );
    assert.ok(d.label.trim().length > 0, `${type}/${status} must have a label`);
  }
});

test("legacy sold/removed are demoted and never confident red", () => {
  const legacySold = getEventDisplay(mk({ event_type: "sold", event_date: "2026-07-01" }));
  const legacyRemoved = getEventDisplay(mk({ event_type: "removed", event_date: "2026-07-01" }));
  for (const d of [legacySold, legacyRemoved]) {
    assert.equal(d.demoted, true);
    assert.equal(d.tone, "muted");
    assert.notEqual(d.icon, "✓");
    assert.ok(!d.label.includes("Sold"), "legacy must not be labeled Sold");
  }
  const canonicalSold = getEventDisplay(
    mk({ event_type: "sold", event_date: "2026-07-11", event_status: "resolved" })
  );
  assert.equal(canonicalSold.tone, "danger");
  assert.equal(canonicalSold.label, "Sold");
  assert.equal(canonicalSold.demoted, false);
});

test("superseded outcomes render struck-through", () => {
  const d = getEventDisplay(
    mk({ event_type: "sold", event_date: "2026-07-11", event_status: "superseded" })
  );
  assert.equal(d.struck, true);
  assert.equal(d.label, "Sale reversed");
});

// ── Purity ───────────────────────────────────────────────────────────────────

test("helpers never mutate input events (frozen inputs, unsorted order preserved)", () => {
  const raw = frozen([
    mk({ id: 2, event_type: "sold", event_date: "2026-06-30", from_dealer_id: 4 }),
    mk({ id: 1, event_type: "added", event_date: "2026-06-01", to_dealer_id: 4 }),
    mk({ id: 3, event_type: "added", event_date: "2026-07-01", to_dealer_id: 4 }),
  ]);
  // Throws in strict mode if any helper writes to a frozen object/array.
  sortEvents(raw);
  computeLifecycle(raw, { inCurrentInventory: true });
  computeDaysOnMarket(raw, TODAY);
  buildTimeline(raw);
  assert.equal(raw[0].id, 2); // original order untouched
});

test("daysBetween is pure calendar math (no TZ drift)", () => {
  assert.equal(daysBetween("2026-07-05", "2026-07-16"), 11);
  assert.equal(daysBetween("2026-06-30", "2026-07-01"), 1);
  assert.equal(daysBetween("2026-07-16", "2026-07-16"), 0);
});
