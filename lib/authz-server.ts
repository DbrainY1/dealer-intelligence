// Request-scoped authorization for server components and route handlers.
// Rules live in lib/authz.ts; this file only binds them to the session.

import { cache } from "react";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { decideAccess, loadAuthContext, type AuthContext, type DealerIqRole } from "@/lib/authz";

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
