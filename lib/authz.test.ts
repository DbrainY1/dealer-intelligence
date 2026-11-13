// Focused tests for DealerIQ authorization decisions.
// Runner: node --experimental-strip-types --test lib/authz.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_ROLES,
  DEALERIQ_ROLES,
  decideAccess,
  isDealerIqRole,
  loadAuthContext,
  type AuthLookups,
  type AuthContext,
} from "./authz.ts";

const ctx = (role: string | null, userId: string | null = "u1"): AuthContext => ({ userId, email: "a@b.co", role });

test("unauthenticated callers are rejected for every role set", () => {
  assert.equal(decideAccess(ctx(null, null), DEALERIQ_ROLES), "unauthenticated");
  assert.equal(decideAccess(ctx("developer", null), ADMIN_ROLES), "unauthenticated");
});

test("an account with no DealerIQ role is forbidden (shared-project users)", () => {
  assert.equal(decideAccess(ctx(null), DEALERIQ_ROLES), "forbidden");
  assert.equal(decideAccess(ctx(null), ADMIN_ROLES), "forbidden");
});

test("unrecognised or legacy role values are forbidden, not crashed on", () => {
  for (const role of ["underwriter", "store_manager", "admin", "", "Developer"]) {
    assert.equal(decideAccess(ctx(role), DEALERIQ_ROLES), "forbidden", role);
  }
});

test("viewer and dealer_principal can view dashboards", () => {
  assert.equal(decideAccess(ctx("viewer"), DEALERIQ_ROLES), "ok");
  assert.equal(decideAccess(ctx("dealer_principal"), DEALERIQ_ROLES), "ok");
});

test("viewer and dealer_principal are denied administrative actions", () => {
  assert.equal(decideAccess(ctx("viewer"), ADMIN_ROLES), "forbidden");
  assert.equal(decideAccess(ctx("dealer_principal"), ADMIN_ROLES), "forbidden");
});

test("developer keeps dashboard and administrative access", () => {
  assert.equal(decideAccess(ctx("developer"), DEALERIQ_ROLES), "ok");
  assert.equal(decideAccess(ctx("developer"), ADMIN_ROLES), "ok");
});

test("isDealerIqRole accepts exactly the three canonical roles", () => {
  assert.deepEqual(DEALERIQ_ROLES.filter(isDealerIqRole), [...DEALERIQ_ROLES]);
  assert.equal(isDealerIqRole("admin"), false);
  assert.equal(isDealerIqRole(undefined), false);
});

// ── loadAuthContext ──────────────────────────────────────────────────────────

interface FakeOpts {
  user?: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null;
  userError?: unknown;
  roleRow?: { role: string } | null;
  roleError?: unknown;
}

function fakeClient(opts: FakeOpts): AuthLookups & { roleLookups: string[] } {
  const roleLookups: string[] = [];
  return {
    roleLookups,
    // Mirrors authz-server: an auth error means no user.
    getUser: async () => (opts.userError ? null : opts.user ?? null),
    getRoleRow: async (userId) => {
      roleLookups.push(userId);
      return { data: opts.roleRow ?? null, error: opts.roleError ?? null };
    },
  };
}

test("role comes from the user_roles row", async () => {
  const c = fakeClient({ user: { id: "u1", email: "v@x.co" }, roleRow: { role: "viewer" } });
  assert.deepEqual(await loadAuthContext(c), { userId: "u1", email: "v@x.co", role: "viewer" });
  assert.deepEqual(c.roleLookups, ["u1"]);
});

test("user_metadata cannot grant access: metadata says developer, no role row", async () => {
  const c = fakeClient({ user: { id: "u2", user_metadata: { role: "developer", invited_role: "developer" } }, roleRow: null });
  const loaded = await loadAuthContext(c);
  assert.equal(loaded.role, null);
  assert.equal(decideAccess(loaded, ADMIN_ROLES), "forbidden");
  assert.equal(decideAccess(loaded, DEALERIQ_ROLES), "forbidden");
});

test("user_metadata cannot elevate: metadata says developer, row says viewer", async () => {
  const c = fakeClient({ user: { id: "u3", user_metadata: { role: "developer" } }, roleRow: { role: "viewer" } });
  const loaded = await loadAuthContext(c);
  assert.equal(loaded.role, "viewer");
  assert.equal(decideAccess(loaded, ADMIN_ROLES), "forbidden");
});

test("role lookup errors fail closed", async () => {
  const c = fakeClient({ user: { id: "u4" }, roleRow: { role: "developer" }, roleError: { message: "boom" } });
  const loaded = await loadAuthContext(c);
  assert.equal(loaded.role, null);
  assert.equal(decideAccess(loaded, DEALERIQ_ROLES), "forbidden");
});

test("an invalid session is unauthenticated and skips the role lookup", async () => {
  const c = fakeClient({ user: { id: "u5" }, userError: { message: "jwt expired" } });
  const loaded = await loadAuthContext(c);
  assert.equal(decideAccess(loaded, DEALERIQ_ROLES), "unauthenticated");
  assert.deepEqual(c.roleLookups, []);
});

// ── Platform Owner ───────────────────────────────────────────────────────────

import { decideOwnerAccess, loadIsPlatformOwner } from "./authz.ts";

const ownerLookup = (rows: Record<string, boolean>, error: unknown = null) => async (id: string) => ({
  data: rows[id] ? { user_id: id } : null,
  error,
});

test("Platform Owner: only a platform_owners row grants ownership", async () => {
  assert.equal(await loadIsPlatformOwner("owner-1", ownerLookup({ "owner-1": true })), true);
  assert.equal(decideOwnerAccess("owner-1", true), "ok");
});

test("Platform Owner: a developer without an owner row is forbidden", async () => {
  const isOwner = await loadIsPlatformOwner("dev-2", ownerLookup({ "owner-1": true }));
  assert.equal(isOwner, false);
  assert.equal(decideOwnerAccess("dev-2", isOwner), "forbidden");
  // The ordinary role rules are untouched: the same developer keeps admin access.
  assert.equal(decideAccess(ctx("developer", "dev-2"), ADMIN_ROLES), "ok");
});

test("Platform Owner: dealer principals and viewers are forbidden", async () => {
  for (const id of ["dp-1", "viewer-1"]) {
    assert.equal(decideOwnerAccess(id, await loadIsPlatformOwner(id, ownerLookup({}))), "forbidden");
  }
});

test("Platform Owner: unauthenticated callers never reach the lookup", async () => {
  let called = false;
  const isOwner = await loadIsPlatformOwner(null, async () => ((called = true), { data: { user_id: "x" }, error: null }));
  assert.equal(isOwner, false);
  assert.equal(called, false);
  assert.equal(decideOwnerAccess(null, true), "unauthenticated");
});

test("Platform Owner: lookup errors (e.g. table not migrated yet) fail closed", async () => {
  assert.equal(await loadIsPlatformOwner("owner-1", ownerLookup({ "owner-1": true }, { code: "PGRST205" })), false);
});

test("Platform Owner: a row for a DIFFERENT user does not grant ownership", async () => {
  assert.equal(await loadIsPlatformOwner("dev-2", async () => ({ data: { user_id: "owner-1" }, error: null })), false);
});
