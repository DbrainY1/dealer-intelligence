// Super Admin data loading. Callers MUST have passed requireOwnerPage() or
// requireOwnerApi() first.
//
// Two access paths, deliberately:
//   * Activity and presence are read with the owner's own session client, so
//     RLS (is_platform_owner()) enforces ownership again in the database.
//   * The account directory needs auth.users (email, invitation, last sign-in)
//     and every user_roles row, which no client can read; it uses the
//     service-role client, server-side, only after the owner check.

import { createAdminSupabase, createServerSupabase } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  RETENTION_DAYS,
  buildDirectory,
  nextPacificDayStart,
  pacificDayStart,
  type ActivityFilters,
  type ActivityRow,
  type AuthUserLite,
  type ConsoleData,
  type PresenceRow,
} from "@/lib/super-admin";

export type { ConsoleData };

const ACTIVITY_COLUMNS = "user_id, occurred_at, event_type, page, action";


function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function loadAuthUsers(): Promise<AuthUserLite[]> {
  const admin = createAdminSupabase();
  const out: AuthUserLite[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) {
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      out.push({
        id: u.id,
        email: u.email ?? null,
        firstName: str(meta.first_name),
        lastName: str(meta.last_name),
        invitedRole: str(meta.invited_role),
        invitedAt: u.invited_at ?? null,
        confirmedAt: u.email_confirmed_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
    if (data.users.length < 200) break;
  }
  return out;
}

export async function loadConsoleData(now: Date): Promise<ConsoleData> {
  const errors: string[] = [];
  const session = await createServerSupabase();
  const admin = createAdminSupabase();

  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const [usersRes, rolesRes, ownersRes, presenceRes, recentRes] = await Promise.allSettled([
    loadAuthUsers(),
    admin.from("user_roles").select("user_id, role"),
    admin.from("platform_owners").select("user_id"),
    session.from("dealeriq_presence").select("user_id, last_seen_at, last_page"),
    fetchAllRows<ActivityRow>("super-admin recent activity", (from, to) =>
      session
        .from("dealeriq_activity")
        .select(ACTIVITY_COLUMNS)
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: false })
        .range(from, to),
    ),
  ]);

  const users = usersRes.status === "fulfilled" ? usersRes.value : (errors.push("Account list unavailable."), []);

  const roles = new Map<string, string>();
  if (rolesRes.status === "fulfilled" && !rolesRes.value.error) {
    for (const r of rolesRes.value.data ?? []) roles.set(r.user_id, r.role);
  } else errors.push("Roles unavailable.");

  const owners = new Set<string>();
  if (ownersRes.status === "fulfilled" && !ownersRes.value.error) {
    for (const o of ownersRes.value.data ?? []) owners.add(o.user_id);
  } else errors.push("Owner list unavailable.");

  let trackingAvailable = true;
  let presence: PresenceRow[] = [];
  if (presenceRes.status === "fulfilled" && !presenceRes.value.error) {
    presence = (presenceRes.value.data ?? []) as PresenceRow[];
  } else trackingAvailable = false;

  const recent = recentRes.status === "fulfilled" ? recentRes.value : ((trackingAvailable = false), []);

  const { entries, otherAccounts } = buildDirectory(users, roles, owners, new Map(presence.map((p) => [p.user_id, p])), now);
  return { now: now.toISOString(), trackingAvailable, directory: entries, otherAccounts, presence, recent, errors };
}

// Filtered history, newest first, capped. Uses the owner's session (RLS).
export async function queryActivity(filters: ActivityFilters, limit = 200): Promise<{ rows: ActivityRow[]; available: boolean }> {
  const session = await createServerSupabase();
  let q = session.from("dealeriq_activity").select(ACTIVITY_COLUMNS).order("occurred_at", { ascending: false }).limit(limit);
  if (filters.user) q = q.eq("user_id", filters.user);
  if (filters.page) q = q.eq("page", filters.page);
  if (filters.type) q = q.eq("event_type", filters.type);
  if (filters.from) q = q.gte("occurred_at", pacificDayStart(filters.from).toISOString());
  if (filters.to) q = q.lt("occurred_at", nextPacificDayStart(filters.to).toISOString());
  // Never reach further back than retention keeps anyway.
  q = q.gte("occurred_at", new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString());
  const { data, error } = await q;
  return error ? { rows: [], available: false } : { rows: (data ?? []) as ActivityRow[], available: true };
}
