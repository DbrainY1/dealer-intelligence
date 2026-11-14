// Auth email link handling. Runner: node --experimental-strip-types --test lib/auth-callback.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { CALLBACK_MESSAGES, isVerifierMissing, parseCallbackUrl } from "./auth-callback.ts";

test("PKCE password reset link (the 2026-11-14 failure) is recognised", () => {
  // What Supabase sends back after verifying a reset requested from the login page.
  assert.deepEqual(parseCallbackUrl("?type=recovery&code=4a6b-9c", ""), { kind: "pkce", code: "4a6b-9c", type: "recovery" });
  // Links requested before this fix carry no type: still a password reset.
  assert.deepEqual(parseCallbackUrl("?code=4a6b-9c", ""), { kind: "pkce", code: "4a6b-9c", type: "recovery" });
  assert.deepEqual(parseCallbackUrl("?type=evil&code=x", ""), { kind: "error", reason: "unsupported" });
});

test("existing link shapes keep working", () => {
  assert.deepEqual(parseCallbackUrl("?token_hash=th&type=recovery", ""), { kind: "token_hash", tokenHash: "th", type: "recovery" });
  assert.deepEqual(parseCallbackUrl("?token_hash=th&type=invite", ""), { kind: "token_hash", tokenHash: "th", type: "invite" });
  assert.deepEqual(parseCallbackUrl("?token_hash=th", ""), { kind: "error", reason: "unsupported" });
  assert.deepEqual(parseCallbackUrl("", "#access_token=a&refresh_token=r&type=invite"), { kind: "implicit", accessToken: "a", refreshToken: "r", type: "invite" });
  assert.deepEqual(parseCallbackUrl("", "#access_token=a&refresh_token=r"), { kind: "implicit", accessToken: "a", refreshToken: "r", type: null });
});

test("Supabase-rejected links get a clear 'expired' message, not a generic one", () => {
  for (const [s, h] of [
    ["?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", ""],
    ["", "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"],
    ["?error=access_denied", ""],
  ]) assert.deepEqual(parseCallbackUrl(s, h), { kind: "error", reason: "expired" }, s + h);
  assert.deepEqual(parseCallbackUrl("?error=server_error", ""), { kind: "error", reason: "invalid" });
  // An error wins even if a code is also present.
  assert.deepEqual(parseCallbackUrl("?code=x&error_code=otp_expired", ""), { kind: "error", reason: "expired" });
});

test("a bare callback URL is 'none'", () => {
  assert.deepEqual(parseCallbackUrl("", ""), { kind: "none" });
  assert.deepEqual(parseCallbackUrl("?type=recovery", ""), { kind: "none" });
});

test("opening a PKCE link in another browser is explained, not reported as 'expired'", () => {
  assert.equal(isVerifierMissing({ name: "AuthPKCECodeVerifierMissingError", message: "PKCE code verifier not found in storage." }), true);
  assert.equal(isVerifierMissing({ name: "AuthApiError", message: "invalid request: both auth code and code verifier should be non-empty" }), true);
  assert.equal(isVerifierMissing({ name: "AuthApiError", message: "invalid flow state, no valid flow state found" }), false);
  assert.equal(isVerifierMissing(null), false);
  assert.match(CALLBACK_MESSAGES.verifier_missing, /same browser/);
  for (const m of Object.values(CALLBACK_MESSAGES)) assert.ok(m.length > 20);
});
