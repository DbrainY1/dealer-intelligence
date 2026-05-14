import { createAdminSupabase, createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // Authentication check: require logged-in developer
  const serverSupabase = await createServerSupabase();
  const { data: { user } } = await serverSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check user_roles table for developer role
  const { data: userRole } = await serverSupabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (!userRole || userRole.role !== 'developer') {
    return NextResponse.json({ error: "Forbidden: Only developers can invite users" }, { status: 403 });
  }

  const formData = await req.formData();

  const email = formData.get("email") as string;
  const firstName = formData.get("first_name") as string;
  const lastName = formData.get("last_name") as string;
  const organization = formData.get("organization") as string;
  const phone = formData.get("phone") as string;
  const role = formData.get("role") as string;
  const notes = formData.get("notes") as string;

  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });
  if (!role) return NextResponse.json({ error: "Role required" }, { status: 400 });
  if (!firstName || !lastName) return NextResponse.json({ error: "Name required" }, { status: 400 });

  // Validate role is one of the allowed values
  const validRoles = ['developer', 'dealer_principal', 'viewer'];
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
  }

  const supabase = createAdminSupabase();

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: {
      first_name: firstName,
      last_name: lastName,
      organization: organization ?? "",
      phone: phone ?? "",
      role: role, // Will be used by /auth/callback to create user_roles entry
      notes: notes ?? "",
      invited_at: new Date().toISOString(),
      invited_by: user.id, // Track who sent the invite
    },
    redirectTo: `${new URL(req.url).origin}/auth/callback`,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.redirect(new URL("/dashboard/settings?invited=true", req.url));
}
