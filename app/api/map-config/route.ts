import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { updates } = await req.json();

  if (!updates || !Array.isArray(updates)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from("map_config")
    .upsert(
      updates.map((u: { id: number; value: number }) => ({
        id: u.id,
        value: u.value,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
