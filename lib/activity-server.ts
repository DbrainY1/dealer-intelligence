// Server-only activity writer. The single caller of
// public.record_dealeriq_activity, which only service_role may execute.
//
// Never throws and never blocks the caller's real work: tracking is
// best-effort. Before the Super Admin migration is applied the RPC does not
// exist; that error is swallowed and nothing is written.

import { createAdminSupabase } from "@/lib/supabase-server";
import { toRecordArgs, type ActivityEvent } from "@/lib/activity";

export async function recordActivity(userId: string, event: ActivityEvent): Promise<void> {
  const args = toRecordArgs(userId, event);
  if (!args) return;
  try {
    const { error } = await createAdminSupabase().rpc("record_dealeriq_activity", args);
    if (error && error.code !== "PGRST202") {
      // PGRST202 = function not found (migration not applied yet): expected, silent.
      console.error("[activity] record failed", error.code ?? "", error.message);
    }
  } catch (err) {
    console.error("[activity] record failed", err);
  }
}
