// Focused tests for the invitation workflow.
// Runner: node --experimental-strip-types --test lib/invite.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVITE_MESSAGES,
  inviteRedirectUrl,
  isInviteOutcome,
  parseInviteForm,
  runInvite,
  type InviteDeps,
  type InviteInput,
} from "./invite.ts";

const NOW = new Date("2026-11-05T12:00:00.000Z");

function form(fields: Record<string, string>) {
  return (name: string) => fields[name] ?? null;
}

const VALID = {
  first_name: " Ana ",
  last_name: "Lopez",
  email: " Ana.Lopez@Example.com ",
  organization: "Lopez Motors",
  role: "viewer",
  phone: "",
  notes: "evaluation",
};

// ── parseInviteForm ──────────────────────────────────────────────────────────

test("valid form is trimmed and the email lower-cased", () => {
  const r = parseInviteForm(form(VALID));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.input.email, "ana.lopez@example.com");
    assert.equal(r.input.firstName, "Ana");
    assert.equal(r.input.role, "viewer");
  }
});

test("roles outside the allowlist are rejected", () => {
  for (const role of ["admin", "superuser", "Developer", "underwriter"]) {
    assert.deepEqual(parseInviteForm(form({ ...VALID, role })), { ok: false, outcome: "invalid_role" }, role);
  }
});

test("missing required fields and malformed emails are rejected", () => {
  assert.deepEqual(parseInviteForm(form({ ...VALID, role: "" })), { ok: false, outcome: "missing_fields" });
  assert.deepEqual(parseInviteForm(form({ ...VALID, last_name: "  " })), { ok: false, outcome: "missing_fields" });
  assert.deepEqual(parseInviteForm(form({ ...VALID, organization: "" })), { ok: false, outcome: "missing_fields" });
  assert.deepEqual(parseInviteForm(form({ ...VALID, email: "not-an-email" })), { ok: false, outcome: "invalid_email" });
});

test("non-string form values (e.g. file uploads) are treated as missing", () => {
  const r = parseInviteForm((name) => (name === "email" ? { name: "file.txt" } : VALID[name as keyof typeof VALID]));
  assert.deepEqual(r, { ok: false, outcome: "missing_fields" });
});

// ── inviteRedirectUrl ────────────────────────────────────────────────────────

test("invite redirect defaults to the production DealerIQ domain", () => {
  assert.equal(inviteRedirectUrl(undefined), "https://dealersintel.com/auth/callback");
  assert.equal(inviteRedirectUrl("  "), "https://dealersintel.com/auth/callback");
  assert.equal(inviteRedirectUrl("http://localhost:3000/"), "http://localhost:3000/auth/callback");
});

// ── runInvite ────────────────────────────────────────────────────────────────

const INPUT: InviteInput = {
  email: "ana@example.com",
  role: "viewer",
  firstName: "Ana",
  lastName: "Lopez",
  organization: "Lopez Motors",
  phone: "",
  notes: "",
};

type InviteResult = Awaited<ReturnType<InviteDeps["inviteUser"]>>;

function deps(inviteResult: InviteResult, roleError: { message: string } | null = null) {
  const calls = { invites: [] as { email: string; data: Record<string, string>; redirectTo: string }[], roles: [] as [string, string][], logs: [] as string[] };
  const d: InviteDeps = {
    inviteUser: async (email, options) => {
      calls.invites.push({ email, ...options });
      return inviteResult;
    },
    assignRole: async (userId, role) => {
      calls.roles.push([userId, role]);
      return { error: roleError };
    },
    now: () => NOW,
    log: (m) => calls.logs.push(m),
  };
  return { d, calls };
}

test("successful invite assigns the role server-side to the invited user id", async () => {
  const { d, calls } = deps({ userId: "new-user", error: null });
  const outcome = await runInvite(d, INPUT, "inviter-1", "https://dealersintel.com/auth/callback");
  assert.equal(outcome, "sent");
  assert.deepEqual(calls.roles, [["new-user", "viewer"]]);
  assert.equal(calls.invites[0].redirectTo, "https://dealersintel.com/auth/callback");
});

test("metadata records the requested role only as invited_role, never as role", async () => {
  const { d, calls } = deps({ userId: "new-user", error: null });
  await runInvite(d, INPUT, "inviter-1", "https://x/auth/callback");
  const data = calls.invites[0].data;
  assert.equal(data.invited_role, "viewer");
  assert.equal(data.invited_by, "inviter-1");
  assert.equal(data.invited_at, NOW.toISOString());
  assert.equal("role" in data, false);
});

test("role assignment failure is reported as a failure, never as sent", async () => {
  const { d, calls } = deps({ userId: "new-user", error: null }, { message: "permission denied" });
  assert.equal(await runInvite(d, INPUT, "inviter-1", "https://x/auth/callback"), "role_assignment_failed");
  assert.equal(calls.logs.length, 1);
});

test("missing user id from Supabase is a failure and assigns nothing", async () => {
  const { d, calls } = deps({ userId: null, error: null });
  assert.equal(await runInvite(d, INPUT, "inviter-1", "https://x/auth/callback"), "role_assignment_failed");
  assert.deepEqual(calls.roles, []);
});

test("already-registered accounts are not re-invited and their role is untouched", async () => {
  for (const error of [
    { code: "email_exists", status: 422, message: "exists" },
    { status: 422, message: "A user with this email address has already been registered" },
  ]) {
    const { d, calls } = deps({ userId: null, error });
    assert.equal(await runInvite(d, INPUT, "inviter-1", "https://x/auth/callback"), "already_registered");
    assert.deepEqual(calls.roles, []);
  }
});

test("other 422 validation errors are send failures, not 'already registered'", async () => {
  const { d, calls } = deps({ userId: null, error: { code: "validation_failed", status: 422, message: "Unable to validate email address" } });
  assert.equal(await runInvite(d, INPUT, "inviter-1", "https://x/auth/callback"), "send_failed");
  assert.deepEqual(calls.roles, []);
});

test("email rate limits and other send errors assign nothing", async () => {
  const limited = deps({ userId: null, error: { code: "over_email_send_rate_limit", status: 429, message: "rate" } });
  assert.equal(await runInvite(limited.d, INPUT, "i", "https://x/auth/callback"), "rate_limited");
  assert.deepEqual(limited.calls.roles, []);

  const broken = deps({ userId: null, error: { status: 500, message: "smtp down" } });
  assert.equal(await runInvite(broken.d, INPUT, "i", "https://x/auth/callback"), "send_failed");
  assert.deepEqual(broken.calls.roles, []);
});

test("re-sending to a pending invitee converges on one role row for the same user", async () => {
  // Supabase returns the same user id when re-inviting an unaccepted address.
  const first = deps({ userId: "pending-1", error: null });
  await runInvite(first.d, { ...INPUT, role: "viewer" }, "i", "https://x/auth/callback");
  const second = deps({ userId: "pending-1", error: null });
  await runInvite(second.d, { ...INPUT, role: "dealer_principal" }, "i", "https://x/auth/callback");
  assert.deepEqual([...first.calls.roles, ...second.calls.roles], [["pending-1", "viewer"], ["pending-1", "dealer_principal"]]);
});

test("every outcome has a message and only 'sent' is a success", () => {
  for (const [outcome, msg] of Object.entries(INVITE_MESSAGES)) {
    assert.ok(isInviteOutcome(outcome));
    assert.ok(msg.text.length > 0);
    assert.equal(msg.tone, outcome === "sent" ? "success" : "error", outcome);
  }
  assert.equal(isInviteOutcome("true"), false);
  assert.equal(isInviteOutcome("toString"), false);
});
