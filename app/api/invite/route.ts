import { createAdminSupabase } from "@/lib/supabase-server";
import { getAuthContext } from "@/lib/authz-server";
import { ADMIN_ROLES, decideAccess } from "@/lib/authz";
import { inviteRedirectUrl, parseInviteForm, runInvite, type InviteOutcome } from "@/lib/invite";
import { NextResponse } from "next/server";

// The Add Member form posts here as a regular HTML form, so every outcome is a
// 303 redirect (POST → GET) back to Settings with a message code.
function backToSettings(req: Request, outcome: InviteOutcome) {
  return NextResponse.redirect(new URL(`/dashboard/settings?invite=${outcome}`, req.url), 303);
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  const decision = decideAccess(ctx, ADMIN_ROLES);
  if (decision === "unauthenticated") return NextResponse.redirect(new URL("/", req.url), 303);
  if (decision === "forbidden") return backToSettings(req, "forbidden");

  const formData = await req.formData();
  const parsed = parseInviteForm((name) => formData.get(name));
  if (!parsed.ok) return backToSettings(req, parsed.outcome);

  const admin = createAdminSupabase();

  const outcome = await runInvite(
    {
      async inviteUser(email, options) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, options);
        return {
          userId: data?.user?.id ?? null,
          error: error ? { code: error.code, status: error.status, message: error.message } : null,
        };
      },
      async assignRole(userId, role) {
        const { error } = await admin
          .from("user_roles")
          .upsert({ user_id: userId, role }, { onConflict: "user_id" });
        return { error };
      },
      now: () => new Date(),
      log: (message, detail) => console.error(`[invite] ${message}`, detail ?? ""),
    },
    parsed.input,
    ctx.userId!,
    inviteRedirectUrl(process.env.DEALERIQ_SITE_URL),
  );

  return backToSettings(req, outcome);
}
