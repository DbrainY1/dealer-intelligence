// DealerIQ authorization rules.
//
// Pure: no Next.js imports, so the decisions are unit-testable. The request-
// scoped wiring (session cookies, redirects, HTTP responses) lives in
// lib/authz-server.ts and components/RoleGuard.tsx.
//
// The ONLY source of a user's role is their row in public.user_roles, which
// users cannot write (RLS: SELECT own row only; rows are written by the
// service-role invite route). auth.users.user_metadata is user-editable via
// supabase.auth.updateUser({ data }) and must never feed an access decision.
//
// The Supabase project is shared with DBRAIN, TIME and Agent-42, so "has a
// valid session" is NOT the same as "is a DealerIQ user". Access requires a
// recognised DealerIQ role.

export const DEALERIQ_ROLES = ["developer", "dealer_principal", "viewer"] as const;
export type DealerIqRole = (typeof DEALERIQ_ROLES)[number];

// Roles allowed to use administrative functions (Settings, invites, map config).
export const ADMIN_ROLES: readonly DealerIqRole[] = ["developer"];

export function isDealerIqRole(value: unknown): value is DealerIqRole {
  return typeof value === "string" && (DEALERIQ_ROLES as readonly string[]).includes(value);
}

export interface AuthContext {
  userId: string | null;
  email: string | null;
  // The user_roles value, or null when there is no session, no row, or the
  // lookup failed. Unrecognised legacy values are preserved here (so they can
  // be displayed) but never pass decideAccess.
  role: string | null;
}

export type AccessDecision = "ok" | "unauthenticated" | "forbidden";

export function decideAccess(ctx: AuthContext, allowed: readonly DealerIqRole[]): AccessDecision {
  if (!ctx.userId) return "unauthenticated";
  if (!isDealerIqRole(ctx.role) || !allowed.includes(ctx.role)) return "forbidden";
  return "ok";
}

// The two lookups needed to resolve the caller, injected so tests can fake
// them. lib/authz-server.ts binds them to the session-scoped Supabase client.
export interface AuthLookups {
  // Must validate the JWT with Supabase Auth (getUser(), not getSession(),
  // which trusts the cookie). Returns null when there is no valid session.
  getUser(): Promise<{ id: string; email?: string | null } | null>;
  // The caller's own user_roles row (RLS: SELECT own row only).
  getRoleRow(userId: string): Promise<{ data: { role: string } | null; error: unknown }>;
}

// Any lookup error fails closed to role = null.
export async function loadAuthContext(lookups: AuthLookups): Promise<AuthContext> {
  const user = await lookups.getUser();
  if (!user) return { userId: null, email: null, role: null };

  const { data: row, error } = await lookups.getRoleRow(user.id);
  return {
    userId: user.id,
    email: user.email ?? null,
    role: error ? null : row?.role ?? null,
  };
}

// ── Platform Owner (Super Admin) ─────────────────────────────────────────────
//
// A separate designation, not a DealerIQ role: it comes only from the caller's
// row in public.platform_owners (keyed by auth.users.id; clients can read their
// own row and cannot write any). It is never derived from user_roles values,
// user_metadata or an email comparison, so a developer cannot become an owner
// by editing anything they control.

export type OwnerLookup = (userId: string) => Promise<{ data: { user_id: string } | null; error: unknown }>;

// Any lookup error (including the table not existing yet) fails closed.
export async function loadIsPlatformOwner(userId: string | null, lookup: OwnerLookup): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await lookup(userId);
  return !error && data?.user_id === userId;
}

export function decideOwnerAccess(userId: string | null, isOwner: boolean): AccessDecision {
  if (!userId) return "unauthenticated";
  return isOwner ? "ok" : "forbidden";
}
