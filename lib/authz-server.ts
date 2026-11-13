// Request-scoped authorization for server components and route handlers.
// Rules live in lib/authz.ts; this file only binds them to the session.

import { cache } from "react";
import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase-server";
import { recordActivity } from "@/lib/activity-server";
import {
  decideAccess,
  decideOwnerAccess,
  loadAuthContext,
  loadIsPlatformOwner,
  type AuthContext,
  type DealerIqRole,
} from "@/lib/authz";

// Memoised per request, so the layout, TopNav and page guards share one
// getUser() + user_roles lookup.
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createServerSupabase();
  return loadAuthContext({
    async getUser() {
      const { data, error } = await supabase.auth.getUser();
      return error ? null : data.user;
    },
    async getRoleRow(userId) {
      return supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
    },
  });
});

// Every protected API route calls this first and returns `response` when
// access is denied. Layout guards and hidden links are not a substitute.
export async function requireApiRole(
  allowed: readonly DealerIqRole[],
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }> {
  const ctx = await getAuthContext();
  const decision = decideAccess(ctx, allowed);
  if (decision === "unauthenticated") {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (decision === "forbidden") {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

// ── Platform Owner ───────────────────────────────────────────────────────────

// Memoised per request. Reads the caller's own platform_owners row through the
// session client (RLS: own row only). Fails closed — including before the
// Super Admin migration exists.
export const getIsPlatformOwner = cache(async (): Promise<boolean> => {
  const { userId } = await getAuthContext();
  const supabase = await createServerSupabase();
  return loadIsPlatformOwner(userId, async (id) =>
    supabase.from("platform_owners").select("user_id").eq("user_id", id).maybeSingle(),
  );
});

// Super Admin pages call this before loading any data. Non-owners get a plain
// 404 so the console's existence is not advertised; the attempt is logged as a
// security event.
export async function requireOwnerPage(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  const decision = decideOwnerAccess(ctx.userId, await getIsPlatformOwner());
  if (decision === "unauthenticated") redirect("/");
  if (decision === "forbidden") {
    await recordActivity(ctx.userId!, { type: "security_event", action: "super_admin.page_denied" });
    notFound();
  }
  return ctx;
}

// Every owner-only API route calls this first.
export async function requireOwnerApi(): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }> {
  const ctx = await getAuthContext();
  const decision = decideOwnerAccess(ctx.userId, await getIsPlatformOwner());
  if (decision === "unauthenticated") {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (decision === "forbidden") {
    await recordActivity(ctx.userId!, { type: "security_event", action: "super_admin.api_denied" });
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, ctx };
}
