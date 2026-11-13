import { createServerSupabase } from "@/lib/supabase-server";
import { requireApiRole } from "@/lib/authz-server";
import { ADMIN_ROLES } from "@/lib/authz";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // RLS (map_config_write_developer) also enforces this; checked here so the
  // route never depends on database policy alone.
  const access = await requireApiRole(ADMIN_ROLES);
  if (!access.ok) return access.response;

  const { updates } = await req.json();

  if (
    !Array.isArray(updates) ||
    updates.length === 0 ||
    !updates.every((u) => Number.isInteger(u?.id) && Number.isFinite(u?.value))
  ) {
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
