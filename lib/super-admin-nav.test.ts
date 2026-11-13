// Drill-down links and URL parsing. Runner: node --experimental-strip-types --test lib/super-admin-nav.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { USERS_FILTERS } from "./super-admin.ts";
import { activityHref, analyticsHref, overviewHref, parseConsoleRoute, securityEventsHref, userHref, usersHref } from "./super-admin-nav.ts";

const B = "/super-admin";
const ID = "8a6e0804-2bd0-4672-b79d-d97027f9071a";
const parse = (href: string) => parseConsoleRoute(Object.fromEntries(new URL(href, "https://x").searchParams));

test("every overview card and alert link opens the intended filtered view", () => {
  assert.deepEqual(parse(usersHref(B)), { view: "users", usersFilter: "all", userId: null });
  for (const f of USERS_FILTERS) assert.deepEqual(parse(usersHref(B, f)), { view: "users", usersFilter: f, userId: null }, f);
  assert.equal(usersHref(B), "/super-admin?view=users"); // "all" adds no filter param
  assert.equal(usersHref(B, "pending_invite"), "/super-admin?view=users&filter=pending_invite");
});

test("user links open that user's detail view", () => {
  assert.deepEqual(parse(userHref(B, ID)), { view: "user", usersFilter: "all", userId: ID });
});

test("denied-attempt alert opens security events; other links are well formed", () => {
  assert.equal(securityEventsHref(B), "/super-admin?view=activity&type=security_event");
  assert.equal(activityHref(B, { user: ID }), `/super-admin?view=activity&user=${ID}`);
  assert.equal(activityHref(B), "/super-admin?view=activity");
  assert.equal(overviewHref(B), "/super-admin");
  assert.equal(analyticsHref(B), "/super-admin?view=analytics");
  assert.equal(parse(securityEventsHref(B)).view, "activity");
});

test("malformed URLs fall back safely", () => {
  assert.deepEqual(parseConsoleRoute({}), { view: "overview", usersFilter: "all", userId: null });
  assert.deepEqual(parseConsoleRoute({ view: "admin" }), { view: "overview", usersFilter: "all", userId: null });
  assert.deepEqual(parseConsoleRoute({ view: "users", filter: "everyone'; drop" }), { view: "users", usersFilter: "all", userId: null });
  // A user page needs a valid account id; otherwise it shows the list.
  for (const id of [undefined, "", "abc", "' OR 1=1", ID.toUpperCase(), [ID]]) {
    assert.deepEqual(parseConsoleRoute({ view: "user", id: id as string }), { view: "users", usersFilter: "all", userId: null }, String(id));
  }
  // An id on a non-user view is ignored.
  assert.equal(parseConsoleRoute({ view: "users", id: ID }).userId, null);
});

test("drill-down URLs carry only view keys and account ids — never activity data", () => {
  const all = [usersHref(B), ...USERS_FILTERS.map((f) => usersHref(B, f)), userHref(B, ID), securityEventsHref(B), activityHref(B, { user: ID }), analyticsHref(B)];
  for (const h of all) {
    const keys = [...new URL(h, "https://x").searchParams.keys()];
    for (const k of keys) assert.ok(["view", "filter", "id", "user", "type"].includes(k), `${h}: ${k}`);
    assert.ok(h.startsWith(`${B}`), h);
  }
});
