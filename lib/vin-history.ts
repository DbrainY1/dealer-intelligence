// Pure helpers for the VIN History Modal: canonical-vs-legacy classification,
// current-stint Days on Market, duplicate-ADDED display grouping, effective
// status, and per-event display labels/styles.
//
// Data model (PR-A lifecycle repair):
//   LEGACY rows     — event_status IS NULL. Preserved historical evidence from
//                     the partial-scrape era: duplicate ADDED churn, false
//                     sold/removed rows. Never canonical outcome truth.
//   CANONICAL rows  — event_status set ('pending_resolution', 'resolved',
//                     'superseded', 'closed_unconfirmed'). Final outcomes link
//                     to their pending detection via source_pending_event_id.
//
// Everything here is display-layer only and must never mutate its inputs.

import type { InventoryEvent } from "@/types";

export type { InventoryEvent };

// ── Market timezone ──────────────────────────────────────────────────────────
// One explicit market calendar (Las Vegas inventory): America/Los_Angeles.
// All Days on Market arithmetic is calendar-date based (no elapsed-hours math,
// no browser-UTC off-by-one).
export const MARKET_TIMEZONE = "America/Los_Angeles";

/** Today's calendar date (YYYY-MM-DD) in the market timezone. Injectable via `now`. */
export function todayInMarketTz(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: MARKET_TIMEZONE }).format(now);
}

/** Whole calendar days between two YYYY-MM-DD dates (to − from). */
export function daysBetween(fromDate: string, toDate: string): number {
  const [y1, m1, d1] = fromDate.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = toDate.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

// ── Classification predicates ────────────────────────────────────────────────
export function isLegacy(e: InventoryEvent): boolean {
  return e.event_status == null;
}

export function isCanonical(e: InventoryEvent): boolean {
  return e.event_status != null;
}

export function isSuperseded(e: InventoryEvent): boolean {
  return e.event_status === "superseded";
}

/** Canonical final outcome: resolved sold / transferred / relist. */
export function isCanonicalResolvedOutcome(e: InventoryEvent): boolean {
  return (
    e.event_status === "resolved" &&
    (e.event_type === "sold" || e.event_type === "transferred" || e.event_type === "relist")
  );
}

/** An unresolved canonical pending-removal detection. */
export function isOpenPendingDetection(e: InventoryEvent): boolean {
  return e.event_type === "pending_removal" && e.event_status === "pending_resolution";
}

/** Dealer identity for grouping: legacy rows are inconsistent about which side
 *  carries the dealer (some ADDEDs use from_dealer_id, some to_dealer_id). */
export function effectiveDealerId(e: InventoryEvent): number | null {
  return e.to_dealer_id ?? e.from_dealer_id ?? null;
}

// ── Normalized ordering ──────────────────────────────────────────────────────
/** Chronological order: event_date asc, then id asc (insert order within a day).
 *  Returns a new array; never mutates the input. */
export function sortEvents(events: InventoryEvent[]): InventoryEvent[] {
  return [...events].sort((a, b) => {
    const da = a.event_date.slice(0, 10);
    const db = b.event_date.slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    return a.id - b.id;
  });
}

// ── Effective lifecycle state ────────────────────────────────────────────────
export type EffectiveStatus =
  | { kind: "active"; since: string | null }
  | { kind: "pending_departure"; since: string | null; pendingSince: string }
  | { kind: "sold"; date: string; since: string | null }
  | { kind: "transferred"; date: string; since: string | null }
  | { kind: "unconfirmed"; lastIndication: string | null };

export interface LifecycleResult {
  status: EffectiveStatus;
  /** Anchor date (YYYY-MM-DD) of the currently open stint, if any. */
  stintOpen: string | null;
}

export interface LifecycleOptions {
  /** Caller context: the modal was opened from a surface showing today's
   *  current inventory (e.g. an active-snapshot table row). Used only as a
   *  fallback when event history alone cannot answer. */
  inCurrentInventory?: boolean;
}

/**
 * Walk events chronologically and derive the latest effective lifecycle state.
 *
 * Stint rules:
 *  - `added` opens a stint (a same-dealer duplicate ADDED inside an open stint
 *    is churn and does NOT restart it; a different dealer opens a new stint).
 *  - Canonical resolved `relist` opens/restores an active stint.
 *  - Canonical resolved `sold`/`transferred` closes the stint (confirmed
 *    departure).
 *  - Legacy `sold`/`removed` act only as historical segmentation boundaries:
 *    they close the running stint for anchoring purposes but never establish
 *    confirmed status.
 *  - Canonical `closed_unconfirmed` detection closes the stint into an honest
 *    unknown.
 *  - `pending_removal` (open) does NOT close the stint.
 *  - `price_changed` never opens or closes a stint.
 *  - Superseded outcomes are reversed truth and have no state effect (their
 *    reversal row — a later canonical relist/transfer — carries the story).
 */
export function computeLifecycle(
  events: InventoryEvent[],
  opts?: LifecycleOptions
): LifecycleResult {
  const sorted = sortEvents(events);

  let stintOpen: string | null = null;
  let stintDealer: number | null = null;
  let confirmed: { kind: "sold" | "transferred"; date: string; anchor: string | null } | null =
    null;
  let legacyBoundary: string | null = null;
  let unconfirmedClose: string | null = null;
  let pendingSince: string | null = null;

  for (const e of sorted) {
    const d = e.event_date.slice(0, 10);
    switch (e.event_type) {
      case "added": {
        const dealer = effectiveDealerId(e);
        const sameDealerDup =
          stintOpen != null && (dealer == null || stintDealer == null || dealer === stintDealer);
        if (!sameDealerDup) {
          stintOpen = d;
          stintDealer = dealer;
          confirmed = null;
          legacyBoundary = null;
          unconfirmedClose = null;
          pendingSince = null;
        }
        break;
      }
      case "relist":
        // Canonical relist restores an active stint. Legacy relist rows are
        // display-only evidence (untrusted churn) with no state effect.
        if (e.event_status === "resolved") {
          stintOpen = d;
          stintDealer = effectiveDealerId(e) ?? stintDealer;
          confirmed = null;
          legacyBoundary = null;
          unconfirmedClose = null;
          pendingSince = null;
        }
        break;
      case "sold":
      case "transferred":
        if (e.event_status === "resolved") {
          // A departure closes the stint it left FROM. If the currently open
          // stint is at a different dealer (e.g. the vehicle already reappeared
          // at the transfer destination before the outcome row), the departure
          // belongs to the previous stint and the current one stays open.
          const departedElsewhere =
            stintOpen != null &&
            stintDealer != null &&
            e.from_dealer_id != null &&
            e.from_dealer_id !== stintDealer;
          if (!departedElsewhere) {
            confirmed = { kind: e.event_type, date: d, anchor: stintOpen };
            stintOpen = null;
            stintDealer = null;
            pendingSince = null;
            legacyBoundary = null;
            unconfirmedClose = null;
          }
        } else if (e.event_status == null && e.event_type === "sold") {
          // Legacy sale indication: segmentation boundary only.
          legacyBoundary = d;
          stintOpen = null;
          stintDealer = null;
          pendingSince = null;
        }
        // superseded: no state effect.
        break;
      case "removed":
        if (e.event_status == null) {
          // Legacy removal indication: segmentation boundary only.
          legacyBoundary = d;
          stintOpen = null;
          stintDealer = null;
          pendingSince = null;
        }
        break;
      case "pending_removal":
        if (e.event_status === "pending_resolution") {
          pendingSince = d;
        } else if (e.event_status === "closed_unconfirmed") {
          unconfirmedClose = d;
          stintOpen = null;
          stintDealer = null;
          pendingSince = null;
        }
        // resolved detections: their linked outcome row tells the story.
        // legacy pending_removal churn: inert.
        break;
      case "price_changed":
        break; // never opens or closes a stint
    }
  }

  let status: EffectiveStatus;
  if (stintOpen != null) {
    status =
      pendingSince != null
        ? { kind: "pending_departure", since: stintOpen, pendingSince }
        : { kind: "active", since: stintOpen };
  } else if (pendingSince != null) {
    // Detector saw a departure but no stint anchor exists in the payload.
    status = { kind: "pending_departure", since: null, pendingSince };
  } else if (confirmed != null) {
    status = { kind: confirmed.kind, date: confirmed.date, since: confirmed.anchor };
  } else if (opts?.inCurrentInventory) {
    // Trusted caller context: the vehicle is in today's current inventory even
    // though event history alone closed with an unconfirmed indication.
    status = { kind: "active", since: null };
  } else {
    status = { kind: "unconfirmed", lastIndication: legacyBoundary ?? unconfirmedClose };
  }

  return { status, stintOpen };
}

// ── Days on Market ───────────────────────────────────────────────────────────
/**
 * Days on Market = calendar days from the opening of the current listing stint
 * to `today` (Active / Pending Departure) or to the canonical departure date
 * (Sold / Transferred). Returns null when no trustworthy anchor exists —
 * callers should render an honest "—", never a fabricated number.
 */
export function computeDaysOnMarket(
  events: InventoryEvent[],
  todayStr: string,
  opts?: LifecycleOptions
): number | null {
  const { status } = computeLifecycle(events, opts);
  switch (status.kind) {
    case "active":
      return status.since != null ? daysBetween(status.since, todayStr) : null;
    case "pending_departure":
      return status.since != null ? daysBetween(status.since, todayStr) : null;
    case "sold":
    case "transferred":
      return status.since != null ? daysBetween(status.since, status.date) : null;
    default:
      return null;
  }
}

// ── Per-event display ────────────────────────────────────────────────────────
export type DisplayTone = "positive" | "danger" | "warning" | "info" | "muted" | "neutral";

export interface EventDisplay {
  label: string;
  tone: DisplayTone;
  icon: string;
  /** Legacy / unconfirmed styling: visually demoted, never a confident mark. */
  demoted: boolean;
  /** Superseded outcomes render struck-through. */
  struck: boolean;
}

/** Explicit label + style for every production event type × population.
 *  Never returns a blank label. */
export function getEventDisplay(e: InventoryEvent): EventDisplay {
  const legacy = isLegacy(e);

  switch (e.event_type) {
    case "added":
      return { label: "Added to Inventory", tone: "positive", icon: "+", demoted: false, struck: false };
    case "price_changed":
      return { label: "Price Changed", tone: "warning", icon: "$", demoted: false, struck: false };
    case "sold":
      if (legacy)
        return { label: "Sale indication — unconfirmed legacy", tone: "muted", icon: "?", demoted: true, struck: false };
      if (e.event_status === "superseded")
        return { label: "Sale reversed", tone: "muted", icon: "↩", demoted: true, struck: true };
      return { label: "Sold", tone: "danger", icon: "✓", demoted: false, struck: false };
    case "removed":
      // Legacy-only type. Never labeled "Sold", never a confident red check.
      return { label: "Removal indication — unconfirmed legacy", tone: "muted", icon: "?", demoted: true, struck: false };
    case "transferred":
      if (legacy)
        return { label: "Transfer indication — legacy", tone: "muted", icon: "→", demoted: true, struck: false };
      if (e.event_status === "superseded")
        return { label: "Transfer superseded", tone: "muted", icon: "↩", demoted: true, struck: true };
      return { label: "Transferred", tone: "info", icon: "→", demoted: false, struck: false };
    case "relist":
      if (legacy)
        return { label: "Relisted — legacy", tone: "muted", icon: "↻", demoted: true, struck: false };
      if (e.event_status === "superseded")
        return { label: "Relist superseded", tone: "muted", icon: "↩", demoted: true, struck: true };
      return { label: "Relisted", tone: "positive", icon: "↻", demoted: false, struck: false };
    case "pending_removal":
      if (legacy)
        return { label: "Possible departure — legacy", tone: "muted", icon: "?", demoted: true, struck: false };
      if (e.event_status === "pending_resolution")
        return { label: "Pending Departure", tone: "warning", icon: "…", demoted: false, struck: false };
      if (e.event_status === "closed_unconfirmed")
        return { label: "Departure not confirmed", tone: "muted", icon: "?", demoted: true, struck: false };
      // resolved detection (normally nested under its linked outcome).
      return { label: "Departure detected", tone: "muted", icon: "…", demoted: true, struck: false };
    default:
      // Unknown future type: visible, neutral, never blank.
      return { label: String(e.event_type), tone: "neutral", icon: "•", demoted: false, struck: false };
  }
}

// ── Timeline display grouping ────────────────────────────────────────────────
export interface TimelineItem {
  event: InventoryEvent;
  display: EventDisplay;
  /** Duplicate ADDED evidence collapsed into this stint-opening ADDED. */
  seenAgain: InventoryEvent[];
  /** The pending-removal detection nested under its linked resolved outcome. */
  nestedDetection: InventoryEvent | null;
}

/**
 * Build display timeline items from raw events (display grouping only — every
 * raw row is preserved in the API payload and in `seenAgain`/`nestedDetection`).
 *
 * - Consecutive ADDEDs at the same dealer collapse into the first (stint-open)
 *   ADDED; intervening `price_changed` events do NOT break the collapse; any
 *   other event does. Different dealers never collapse together.
 * - A canonical resolved outcome hides its source pending-removal detection
 *   (linked via source_pending_event_id) and carries it as `nestedDetection`.
 *   Unresolved pending detections remain visible.
 */
export function buildTimeline(events: InventoryEvent[]): TimelineItem[] {
  const sorted = sortEvents(events);

  // Detections referenced by a canonical outcome are nested, not standalone.
  const detectionById = new Map<number, InventoryEvent>();
  const nestedDetectionIds = new Set<number>();
  for (const e of sorted) {
    if (e.event_type === "pending_removal") detectionById.set(e.id, e);
  }
  for (const e of sorted) {
    if (
      isCanonical(e) &&
      e.event_type !== "pending_removal" &&
      e.source_pending_event_id != null &&
      detectionById.has(e.source_pending_event_id)
    ) {
      nestedDetectionIds.add(e.source_pending_event_id);
    }
  }

  const items: TimelineItem[] = [];
  let openAddedIndex: number | null = null;

  for (const e of sorted) {
    if (e.event_type === "pending_removal" && nestedDetectionIds.has(e.id)) {
      continue; // rendered nested under its linked outcome
    }

    if (e.event_type === "added") {
      const dealer = effectiveDealerId(e);
      if (
        openAddedIndex != null &&
        effectiveDealerId(items[openAddedIndex].event) === dealer
      ) {
        const open = items[openAddedIndex];
        items[openAddedIndex] = { ...open, seenAgain: [...open.seenAgain, e] };
        continue;
      }
      openAddedIndex = items.length;
      items.push({ event: e, display: getEventDisplay(e), seenAgain: [], nestedDetection: null });
      continue;
    }

    if (e.event_type !== "price_changed") {
      openAddedIndex = null; // anything except a price change breaks the collapse
    }

    const nested =
      isCanonical(e) && e.source_pending_event_id != null
        ? detectionById.get(e.source_pending_event_id) ?? null
        : null;
    items.push({ event: e, display: getEventDisplay(e), seenAgain: [], nestedDetection: nested });
  }

  return items;
}
