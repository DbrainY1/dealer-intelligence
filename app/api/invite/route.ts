import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
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

  const supabase = await createServerSupabase();

  const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: {
      first_name: firstName,
      last_name: lastName,
      organization: organization ?? "",
      phone: phone ?? "",
      role: role,
      notes: notes ?? "",
      invited_at: new Date().toISOString(),
    },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.redirect(new URL("/dashboard/settings?invited=true", req.url));
}
