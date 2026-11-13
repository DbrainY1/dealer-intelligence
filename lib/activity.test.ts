// Focused tests for the activity allowlists and privacy rules.
// Runner: node --experimental-strip-types --test lib/activity.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_ACTIONS, ACTION_LABELS, PAGE_LABELS, SECURITY_ACTIONS, pageKeyForPath, toRecordArgs } from "./activity.ts";

test("dashboard paths map to allowlisted page keys", () => {
  const cases: [string, string][] = [
    ["/dashboard", "market_intel"],
    ["/dashboard/", "market_intel"],
    ["/dashboard/market", "the_market"],
    ["/dashboard/market/archive", "market_archive"],
    ["/dashboard/competitors", "market_pulse"],
    ["/dashboard/compare", "compare"],
    ["/dashboard/locations", "locations"],
    ["/dashboard/dealer/42", "dealer_detail"],
    ["/dashboard/group/7", "group_detail"],
    ["/dashboard/vin/1HGCM82633A004352", "vin_history"],
    ["/dashboard/settings", "settings"],
    ["/super-admin", "super_admin"],
  ];
  for (const [path, key] of cases) assert.equal(pageKeyForPath(path), key, path);
});

test("record ids, query strings and fragments are never part of the stored key", () => {
  assert.equal(pageKeyForPath("/dashboard/dealer/42?token=secret&email=a@b.co"), "dealer_detail");
  assert.equal(pageKeyForPath("/dashboard?scope=lv#private"), "market_intel");
  assert.equal(pageKeyForPath("/super-admin?view=activity&user=abc"), "super_admin");
  for (const key of Object.keys(PAGE_LABELS)) assert.match(key, /^[a-z][a-z0-9_]{0,47}$/);
});

test("unknown, malformed or oversized paths are rejected", () => {
  for (const bad of [
    "/", "/login", "/api/invite", "/dashboard/unknown", "/dashboard/dealer", "/dashboard/dealer/1/extra",
    "dashboard", "//dashboard", "/dashboard/../super-admin", "/dashboard/vin/a/../b", "",
    "/dashboard/" + "x".repeat(400), 42, null, undefined, { path: "/dashboard" },
  ]) {
    assert.equal(pageKeyForPath(bad), null, String(bad));
  }
});

test("toRecordArgs: identity comes only from the server-supplied user id", () => {
  assert.equal(toRecordArgs(null, { type: "page_view", page: "market_intel" }), null);
  assert.deepEqual(toRecordArgs("u1", { type: "page_view", page: "market_intel" }), {
    p_user_id: "u1", p_event_type: "page_view", p_page: "market_intel", p_action: null,
  });
});

test("toRecordArgs: only allowlisted pages and actions are written", () => {
  assert.equal(toRecordArgs("u1", { type: "page_view", page: "https://evil.example/?q=1" }), null);
  assert.equal(toRecordArgs("u1", { type: "page_view", page: "toString" }), null);
  assert.equal(toRecordArgs("u1", { type: "admin_event", action: "drop_tables" }), null);
  assert.equal(toRecordArgs("u1", { type: "security_event", action: "invite.sent" }), null);
  assert.equal(toRecordArgs("u1", { type: "admin_event", action: "super_admin.page_denied" }), null);
  assert.deepEqual(toRecordArgs("u1", { type: "admin_event", action: "invite.sent" })?.p_action, "invite.sent");
  assert.deepEqual(toRecordArgs("u1", { type: "security_event", action: "super_admin.api_denied" })?.p_event_type, "security_event");
  // @ts-expect-error — unknown event types are rejected at runtime too
  assert.equal(toRecordArgs("u1", { type: "keystroke", action: "x" }), null);
});

test("heartbeats carry at most an allowlisted page", () => {
  assert.equal(toRecordArgs("u1", { type: "heartbeat" })?.p_page, null);
  assert.equal(toRecordArgs("u1", { type: "heartbeat", page: "compare" })?.p_page, "compare");
  assert.equal(toRecordArgs("u1", { type: "heartbeat", page: "/dashboard?x=1" }), null);
});

test("every action matches the database CHECK pattern and has a label", () => {
  for (const a of [...ADMIN_ACTIONS, ...SECURITY_ACTIONS]) {
    assert.match(a, /^[a-z][a-z0-9_.]{0,63}$/, a);
    assert.ok(ACTION_LABELS[a], `label for ${a}`);
  }
});
