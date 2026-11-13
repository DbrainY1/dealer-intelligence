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

// ── Drill-down filters ───────────────────────────────────────────────────────

import { ACTIVITY_FILTERS, USERS_FILTERS, USERS_FILTER_LABELS, filterDirectory, isMissingRole, isPendingInvite, summarizeUser } from "./super-admin.ts";

function fixture() {
  const users = [
    user("owner"),
    user("dev2"),
    user("dp"),
    user("viewer"),
    user("pending", { invitedRole: "viewer", invitedAt: ago(60), confirmedAt: null, lastSignInAt: null }),
    user("norole-online"),
    user("old"),
  ];
  const roles = new Map([["owner", "developer"], ["dev2", "developer"], ["dp", "dealer_principal"], ["viewer", "viewer"], ["pending", "viewer"], ["old", "viewer"]]);
  const presence: PresenceRow[] = [
    { user_id: "owner", last_seen_at: ago(1), last_page: "super_admin" },
    { user_id: "norole-online", last_seen_at: ago(2), last_page: "market_intel" },
    { user_id: "dp", last_seen_at: ago(60 * 3), last_page: "compare" },
    { user_id: "viewer", last_seen_at: ago(60 * 24 * 3), last_page: "locations" },
    { user_id: "old", last_seen_at: ago(60 * 24 * 20), last_page: "locations" },
  ];
  const events = [view("dev2", 60 * 24 * 2)]; // page view without presence (e.g. purged) still counts
  const { entries } = buildDirectory(users, roles, new Set(["owner"]), new Map(presence.map((p) => [p.user_id, p])), NOW);
  return { entries, ctx: { presence, events, now: NOW } };
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

test("each filter selects exactly the intended accounts", () => {
  const { entries, ctx } = fixture();
  const f = (k: Parameters<typeof filterDirectory>[1]) => ids(filterDirectory(entries, k, ctx));
  assert.deepEqual(f("all"), ids(entries));
  assert.deepEqual(f("active_now"), ["norole-online", "owner"]);
  assert.deepEqual(f("active_today"), ["dp", "norole-online", "owner"]);
  assert.deepEqual(f("active_7d"), ["dev2", "dp", "norole-online", "owner", "viewer"]);
  assert.deepEqual(f("developer"), ["dev2", "owner"]);
  assert.deepEqual(f("dealer_principal"), ["dp"]);
  assert.deepEqual(f("viewer"), ["old", "pending", "viewer"]);
  assert.deepEqual(f("pending_invite"), ["pending"]);
  assert.deepEqual(f("missing_role"), ["norole-online"]);
});

test("a KPI number always equals the length of the list it opens", () => {
  const { entries, ctx } = fixture();
  for (const k of USERS_FILTERS) {
    const list = filterDirectory(entries, k, ctx);
    assert.equal(new Set(list.map((e) => e.id)).size, list.length, `${k}: no duplicates`);
  }
  assert.equal(filterDirectory(entries, "active_7d", ctx).length, activeUserCount(ctx.presence, ctx.events, new Date(NOW.getTime() - 7 * 86_400_000)));
});

test("'missing role' and 'pending' do not depend on the online status", () => {
  const { entries } = fixture();
  const online = entries.find((e) => e.id === "norole-online")!;
  assert.equal(online.status, "active_now"); // display status says online…
  assert.equal(isMissingRole(online), true); // …but it still lacks a role
  assert.equal(isMissingRole(entries.find((e) => e.id === "owner")!), false); // owners never "missing"
  assert.equal(isPendingInvite(entries.find((e) => e.id === "pending")!), true);
  assert.equal(isMissingRole({ role: null, isOwner: false, invitedAt: ago(5), confirmedAt: null }), false); // pending, not missing
});

test("every filter has a label and activity filters are marked as needing tracking", () => {
  for (const k of USERS_FILTERS) assert.ok(USERS_FILTER_LABELS[k]);
  assert.deepEqual([...ACTIVITY_FILTERS].sort(), ["active_7d", "active_now", "active_today"]);
});

test("empty directory gives empty results for every filter", () => {
  for (const k of USERS_FILTERS) assert.deepEqual(filterDirectory([], k, { presence: [], events: [], now: NOW }), []);
});

test("summarizeUser counts only that user's events", () => {
  const ev: ActivityRow[] = [
    view("a", 1, "compare"), view("a", 2, "compare"), view("a", 3, "locations"), view("b", 1, "compare"),
    { user_id: "a", occurred_at: ago(4), event_type: "admin_event", page: null, action: "invite.sent" },
    { user_id: "a", occurred_at: ago(5), event_type: "security_event", page: null, action: "super_admin.page_denied" },
  ];
  assert.deepEqual(summarizeUser("a", ev), {
    pageViews30d: 3, distinctPages: 2, adminEvents30d: 1, securityEvents30d: 1,
    topPages: [{ page: "compare", views: 2 }, { page: "locations", views: 1 }],
  });
  assert.deepEqual(summarizeUser("nobody", ev), { pageViews30d: 0, distinctPages: 0, adminEvents30d: 0, securityEvents30d: 0, topPages: [] });
});
