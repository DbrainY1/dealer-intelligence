// Focused tests for the Super Admin metrics. "now" is always injected.
// Runner: node --experimental-strip-types --test lib/super-admin.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountStatus,
  activeUserCount,
  buildDirectory,
  countEvents,
  dailyActiveUsers,
  deriveSessions,
  isActiveNow,
  nextPacificDayStart,
  pacificDayStart,
  parseActivityFilters,
  roleCounts,
  startOfPacificDay,
  topPages,
  type ActivityRow,
  type AuthUserLite,
  type PresenceRow,
} from "./super-admin.ts";

const NOW = new Date("2026-11-13T20:00:00Z"); // 12:00 PST
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const view = (user: string, min: number, page = "market_intel"): ActivityRow => ({
  user_id: user, occurred_at: ago(min), event_type: "page_view", page, action: null,
});
const user = (id: string, over: Partial<AuthUserLite> = {}): AuthUserLite => ({
  id, email: `${id}@test.local`, firstName: null, lastName: null, invitedRole: null,
  invitedAt: null, confirmedAt: "2026-11-01T00:00:00Z", lastSignInAt: "2026-11-12T00:00:00Z", ...over,
});

test("active now uses a 5-minute window", () => {
  assert.equal(isActiveNow(ago(4), NOW), true);
  assert.equal(isActiveNow(ago(5), NOW), true);
  assert.equal(isActiveNow(ago(6), NOW), false);
  assert.equal(isActiveNow(null, NOW), false);
});

test("account status distinguishes online, invited, missing role, never signed in", () => {
  assert.equal(accountStatus(user("a"), "viewer", false, ago(1), NOW), "active_now");
  assert.equal(accountStatus(user("b", { invitedAt: ago(60), confirmedAt: null }), "viewer", false, null, NOW), "pending_invite");
  assert.equal(accountStatus(user("c"), null, false, null, NOW), "missing_role");
  assert.equal(accountStatus(user("d"), null, true, null, NOW), "active"); // owner without a role is not "missing"
  assert.equal(accountStatus(user("e", { lastSignInAt: null }), "developer", false, null, NOW), "never_signed_in");
  assert.equal(accountStatus(user("f"), "developer", false, ago(600), NOW), "active");
});

test("directory lists only DealerIQ-connected accounts and counts the rest", () => {
  const users = [
    user("owner"), user("dev"), user("dp"), user("pending", { invitedRole: "viewer", confirmedAt: null, invitedAt: ago(30) }),
    user("agent42"), user("tracked"),
  ];
  const roles = new Map([["owner", "developer"], ["dev", "developer"], ["dp", "dealer_principal"]]);
  const owners = new Set(["owner"]);
  const presence = new Map<string, PresenceRow>([["tracked", { user_id: "tracked", last_seen_at: ago(2), last_page: "compare" }]]);
  const { entries, otherAccounts } = buildDirectory(users, roles, owners, presence, NOW);
  assert.deepEqual(entries.map((e) => e.id).sort(), ["dev", "dp", "owner", "pending", "tracked"]);
  assert.equal(otherAccounts, 1);
  assert.equal(entries[0].id, "tracked"); // most recently seen first
  assert.equal(entries.find((e) => e.id === "owner")!.isOwner, true);
  assert.equal(entries.find((e) => e.id === "dev")!.isOwner, false);
  assert.deepEqual(roleCounts(entries), { developer: 2, dealer_principal: 1, viewer: 0, none: 2 });
});

test("active user counts merge presence and page views and count each user once", () => {
  const presence: PresenceRow[] = [{ user_id: "a", last_seen_at: ago(3), last_page: null }];
  const events = [view("a", 10), view("b", 30), view("c", 60 * 30)];
  assert.equal(activeUserCount(presence, events, new Date(NOW.getTime() - 5 * 60_000)), 1);
  assert.equal(activeUserCount(presence, events, new Date(NOW.getTime() - 60 * 60_000)), 2);
  assert.equal(activeUserCount(presence, events, new Date(NOW.getTime() - 7 * 86_400_000)), 3);
  // admin/security events do not count as activity
  assert.equal(activeUserCount([], [{ ...view("z", 1), event_type: "security_event", page: null, action: "super_admin.page_denied" }], new Date(0)), 0);
});

test("Pacific day boundaries are exact, including across DST", () => {
  assert.equal(startOfPacificDay(NOW).toISOString(), "2026-11-13T08:00:00.000Z"); // PST
  assert.equal(pacificDayStart("2026-07-04").toISOString(), "2026-07-04T07:00:00.000Z"); // PDT
  assert.equal(pacificDayStart("2026-11-01").toISOString(), "2026-11-01T07:00:00.000Z"); // DST ends that day
  assert.equal(nextPacificDayStart("2026-11-01").toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(nextPacificDayStart("2026-03-07").toISOString(), "2026-03-08T08:00:00.000Z"); // DST starts on the 8th
});

test("daily active users are distinct users per Pacific day", () => {
  const events = [view("a", 60), view("a", 120), view("b", 60), view("a", 60 * 24 + 60)];
  const series = dailyActiveUsers(events, 3, NOW);
  assert.deepEqual(series, [
    { date: "11-11", value: 0 },
    { date: "11-12", value: 1 },
    { date: "11-13", value: 2 },
  ]);
});

test("top pages rank by views and count distinct users", () => {
  const events = [view("a", 1, "compare"), view("b", 2, "compare"), view("a", 3, "compare"), view("a", 4, "locations")];
  assert.deepEqual(topPages(events), [
    { page: "compare", views: 3, users: 2 },
    { page: "locations", views: 1, users: 1 },
  ]);
});

test("sessions split after a 30-minute gap, per user, newest first", () => {
  const events = [view("a", 100, "market_intel"), view("a", 80, "compare"), view("a", 40, "compare"), view("b", 10)];
  const s = deriveSessions(events);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((x) => [x.userId, x.pageViews]), [["b", 1], ["a", 1], ["a", 2]]);
  assert.deepEqual(s[2].pages, ["market_intel", "compare"]);
});

test("countEvents filters by type and time", () => {
  const ev: ActivityRow[] = [
    { user_id: "a", occurred_at: ago(10), event_type: "security_event", page: null, action: "super_admin.api_denied" },
    { user_id: "a", occurred_at: ago(60 * 24 * 8), event_type: "security_event", page: null, action: "super_admin.api_denied" },
  ];
  assert.equal(countEvents(ev, "security_event", new Date(NOW.getTime() - 7 * 86_400_000)), 1);
});

test("activity filters accept only well-formed values", () => {
  const isPage = (p: string) => p === "compare";
  assert.deepEqual(
    parseActivityFilters({ user: "8a6e0804-2bd0-4672-b79d-d97027f9071a", page: "compare", type: "page_view", from: "2026-11-01", to: "2026-11-13" }, isPage),
    { user: "8a6e0804-2bd0-4672-b79d-d97027f9071a", page: "compare", type: "page_view", from: "2026-11-01", to: "2026-11-13" },
  );
  assert.deepEqual(
    parseActivityFilters({ user: "' OR 1=1 --", page: "/etc/passwd", type: "keystroke", from: "yesterday", to: ["2026-11-13"] }, isPage),
    { user: null, page: null, type: null, from: null, to: null },
  );
});
