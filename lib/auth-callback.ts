// What an auth email link handed to /auth/callback. Pure, so every link shape
// is unit-tested.
//
// Supabase can land here four ways:
//   ?code=…                      PKCE. The login page's "Forgot password?" uses
//                                the browser client, whose default flow is PKCE.
//                                The code must be exchanged in the SAME browser
//                                that requested the reset (it holds the verifier).
//   ?token_hash=…&type=…         Email templates that link straight to the app.
//   #access_token=…&refresh_token=…  Implicit flow (e.g. server-sent invites).
//   ?error=… / #error=…          Supabase rejected the link (expired, used, …).

export type LinkType = "invite" | "recovery";

export type CallbackAction =
  | { kind: "pkce"; code: string; type: LinkType }
  | { kind: "token_hash"; tokenHash: string; type: LinkType }
  | { kind: "implicit"; accessToken: string; refreshToken: string; type: LinkType | null }
  | { kind: "error"; reason: CallbackErrorReason }
  | { kind: "none" };

export type CallbackErrorReason = "expired" | "verifier_missing" | "unsupported" | "invalid";

export const CALLBACK_MESSAGES: Record<CallbackErrorReason, string> = {
  expired:
    "This link has expired or has already been used. Request a new password reset from the login page. If this was an invitation, ask your DealerIQ administrator to send a new one.",
  verifier_missing:
    "This password reset link has to be opened in the same browser where the reset was requested. Request a new reset from the login page in the browser you will use, then open the newest email.",
  unsupported: "This link type isn't supported. Request a new invite or password reset.",
  invalid: "Invalid or expired link. Please request a new invite or password reset.",
};

const asType = (v: string | null): LinkType | null => (v === "invite" || v === "recovery" ? v : null);

export function parseCallbackUrl(search: string, hash: string): CallbackAction {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

  // Supabase reports rejected links as ?error=… or #error=…
  const errorCode = q.get("error_code") ?? h.get("error_code");
  const error = q.get("error") ?? h.get("error");
  if (error || errorCode) return { kind: "error", reason: errorCode === "otp_expired" || error === "access_denied" ? "expired" : "invalid" };

  const code = q.get("code");
  if (code) {
    const raw = q.get("type");
    if (raw !== null && !asType(raw)) return { kind: "error", reason: "unsupported" };
    // DealerIQ only starts PKCE flows for password resets.
    return { kind: "pkce", code, type: asType(raw) ?? "recovery" };
  }

  const tokenHash = q.get("token_hash");
  if (tokenHash) {
    const type = asType(q.get("type"));
    return type ? { kind: "token_hash", tokenHash, type } : { kind: "error", reason: "unsupported" };
  }

  const accessToken = h.get("access_token");
  const refreshToken = h.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "implicit", accessToken, refreshToken, type: asType(h.get("type") ?? q.get("type")) };

  return { kind: "none" };
}

// exchangeCodeForSession fails this way when the link is opened in a browser
// other than the one that requested the reset.
export function isVerifierMissing(err: { name?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.name === "AuthPKCECodeVerifierMissingError" || /code verifier/i.test(err.message ?? "");
}
