import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const formData = await req.formData();
  const email = formData.get("email") as string;
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.admin.inviteUserByEmail(email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.redirect(new URL("/dashboard/settings", req.url));
}
