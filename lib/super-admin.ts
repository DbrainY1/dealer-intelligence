// Super Admin metrics. Pure — "now" is always injected — so every number the
// console shows is unit-tested. Loading lives in lib/super-admin-data.ts.
//
// Presence is INFERRED from the last recorded page view or heartbeat; it is not
// proof of a live session. The console labels it that way.

import { pacificDateStr } from "./dates.ts";
import { isDealerIqRole } from "./authz.ts";

export const ACTIVE_NOW_MINUTES = 5;
export const SESSION_GAP_MINUTES = 30;
export const RETENTION_DAYS = 90;

export interface ActivityRow {
  user_id: string;
  occurred_at: string;
  event_type: "page_view" | "admin_event" | "security_event";
  page: string | null;
  action: string | null;
}

export interface PresenceRow {
  user_id: string;
  last_seen_at: string;
  last_page: string | null;
}

export interface AuthUserLite {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  invitedRole: string | null;
  invitedAt: string | null;
  confirmedAt: string | null;
  lastSignInAt: string | null;
}

export type AccountStatus = "active_now" | "pending_invite" | "missing_role" | "never_signed_in" | "active";

export interface DirectoryEntry extends AuthUserLite {
  role: string | null;
  isOwner: boolean;
  lastSeenAt: string | null;
  lastPage: string | null;
  status: AccountStatus;
}

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

export function isActiveNow(lastSeenAt: string | null, now: Date): boolean {
  return lastSeenAt !== null && new Date(lastSeenAt) >= minutesAgo(now, ACTIVE_NOW_MINUTES);
}

export function accountStatus(u: AuthUserLite, role: string | null, isOwner: boolean, lastSeenAt: string | null, now: Date): AccountStatus {
  if (isActiveNow(lastSeenAt, now)) return "active_now";
  if (u.invitedAt && !u.confirmedAt) return "pending_invite";
  if (!isDealerIqRole(role) && !isOwner) return "missing_role";
  if (!u.lastSignInAt) return "never_signed_in";
  return "active";
}

// The shared Supabase project also holds other applications' accounts. Only
// accounts with a DealerIQ connection are listed: a role, owner status, a
// DealerIQ invitation, or recorded DealerIQ activity. Others are only counted.
export function buildDirectory(
  users: AuthUserLite[],
  roles: Map<string, string>,
  owners: Set<string>,
  presence: Map<string, PresenceRow>,
  now: Date,
): { entries: DirectoryEntry[]; otherAccounts: number } {
  const entries: DirectoryEntry[] = [];
  let otherAccounts = 0;
  for (const u of users) {
    const role = roles.get(u.id) ?? null;
    const isOwner = owners.has(u.id);
    const p = presence.get(u.id) ?? null;
    const related = role !== null || isOwner || p !== null || isDealerIqRole(u.invitedRole);
    if (!related) {
      otherAccounts++;
      continue;
    }
    entries.push({
      ...u,
      role,
      isOwner,
      lastSeenAt: p?.last_seen_at ?? null,
      lastPage: p?.last_page ?? null,
      status: accountStatus(u, role, isOwner, p?.last_seen_at ?? null, now),
    });
  }
  entries.sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "") || (a.email ?? "").localeCompare(b.email ?? ""));
  return { entries, otherAccounts };
}

export function roleCounts(entries: DirectoryEntry[]): Record<string, number> {
  const out: Record<string, number> = { developer: 0, dealer_principal: 0, viewer: 0, none: 0 };
  for (const e of entries) out[isDealerIqRole(e.role) ? e.role : "none"]++;
  return out;
}

// Distinct users seen since `since`, using presence (covers heartbeats) and
// page views together.
export function activeUserIds(presence: PresenceRow[], events: ActivityRow[], since: Date): Set<string> {
  const ids = new Set<string>();
  for (const p of presence) if (new Date(p.last_seen_at) >= since) ids.add(p.user_id);
  for (const e of events) if (e.event_type === "page_view" && new Date(e.occurred_at) >= since) ids.add(e.user_id);
  return ids;
}

export function activeUserCount(presence: PresenceRow[], events: ActivityRow[], since: Date): number {
  return activeUserIds(presence, events, since).size;
}

// ── Drill-down filters ───────────────────────────────────────────────────────
//
// Each overview card and alert opens Users & access with one of these filters.
// The card's number and the filtered list come from the SAME predicate, so
// they always agree. Conditions are independent of the display status (an
// online account without a role is still "missing a role").

export const USERS_FILTERS = [
  "all", "active_now", "active_today", "active_7d",
  "developer", "dealer_principal", "viewer", "pending_invite", "missing_role",
] as const;
export type UsersFilter = (typeof USERS_FILTERS)[number];

export const USERS_FILTER_LABELS: Record<UsersFilter, string> = {
  all: "All DealerIQ users",
  active_now: `Active now (last ${ACTIVE_NOW_MINUTES} minutes)`,
  active_today: "Active today (Pacific time)",
  active_7d: "Active in the last 7 days",
  developer: "Developers",
  dealer_principal: "Dealer Principals",
  viewer: "Viewers",
  pending_invite: "Invitations not yet accepted",
  missing_role: "Accounts without a DealerIQ role",
};

/** Filters that need activity tracking to be meaningful. */
export const ACTIVITY_FILTERS: readonly UsersFilter[] = ["active_now", "active_today", "active_7d"];

export function isUsersFilter(v: unknown): v is UsersFilter {
  return typeof v === "string" && (USERS_FILTERS as readonly string[]).includes(v);
}

export const isPendingInvite = (e: Pick<AuthUserLite, "invitedAt" | "confirmedAt">) => Boolean(e.invitedAt && !e.confirmedAt);
export const isMissingRole = (e: Pick<DirectoryEntry, "role" | "isOwner" | "invitedAt" | "confirmedAt">) =>
  !isDealerIqRole(e.role) && !e.isOwner && !isPendingInvite(e);

export function filterDirectory(
  entries: DirectoryEntry[],
  filter: UsersFilter,
  ctx: { presence: PresenceRow[]; events: ActivityRow[]; now: Date },
): DirectoryEntry[] {
  const activeSince = (since: Date) => {
    const ids = activeUserIds(ctx.presence, ctx.events, since);
    return entries.filter((e) => ids.has(e.id));
  };
  switch (filter) {
    case "all": return entries;
    case "active_now": return activeSince(new Date(ctx.now.getTime() - ACTIVE_NOW_MINUTES * 60_000));
    case "active_today": return activeSince(startOfPacificDay(ctx.now));
    case "active_7d": return activeSince(new Date(ctx.now.getTime() - 7 * 86_400_000));
    case "developer":
    case "dealer_principal":
    case "viewer": return entries.filter((e) => e.role === filter);
    case "pending_invite": return entries.filter(isPendingInvite);
    case "missing_role": return entries.filter(isMissingRole);
  }
}

export interface UserSummary {
  pageViews30d: number;
  distinctPages: number;
  adminEvents30d: number;
  securityEvents30d: number;
  topPages: { page: string; views: number }[];
}

// Per-user totals over the rows provided (the console passes the last 30 days).
export function summarizeUser(userId: string, events: ActivityRow[]): UserSummary {
  const mine = events.filter((e) => e.user_id === userId);
  const views = mine.filter((e) => e.event_type === "page_view" && e.page);
  return {
    pageViews30d: views.length,
    distinctPages: new Set(views.map((e) => e.page)).size,
    adminEvents30d: mine.filter((e) => e.event_type === "admin_event").length,
    securityEvents30d: mine.filter((e) => e.event_type === "security_event").length,
    topPages: topPages(mine, 5).map(({ page, views }) => ({ page, views })),
  };
}

/** Start of the current Pacific calendar day, as an instant. */
export function startOfPacificDay(now: Date): Date {
  const today = pacificDateStr(now);
  // Walk back hour by hour until the Pacific date changes; exact across DST.
  let t = new Date(now.getTime());
  t.setUTCMinutes(0, 0, 0);
  while (pacificDateStr(new Date(t.getTime() - 1)) === today) t = new Date(t.getTime() - 3_600_000);
  return t;
}

/** Pacific calendar date (YYYY-MM-DD) → the instant that day starts. */
export function pacificDayStart(date: string): Date {
  return startOfPacificDay(new Date(`${date}T12:00:00Z`));
}

/** The instant the Pacific day AFTER `date` starts (exclusive upper bound). */
export function nextPacificDayStart(date: string): Date {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return startOfPacificDay(d);
}

// Distinct active users per Pacific calendar day, oldest first, `days` long.
export function dailyActiveUsers(events: ActivityRow[], days: number, now: Date): { date: string; value: number }[] {
  const byDay = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.event_type !== "page_view") continue;
    const d = pacificDateStr(new Date(e.occurred_at));
    if (!byDay.has(d)) byDay.set(d, new Set());
    byDay.get(d)!.add(e.user_id);
  }
  const out: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = pacificDateStr(new Date(now.getTime() - i * 86_400_000));
    out.push({ date: d.slice(5), value: byDay.get(d)?.size ?? 0 });
  }
  return out;
}

export function topPages(events: ActivityRow[], limit = 8): { page: string; views: number; users: number }[] {
  const m = new Map<string, { views: number; users: Set<string> }>();
  for (const e of events) {
    if (e.event_type !== "page_view" || !e.page) continue;
    if (!m.has(e.page)) m.set(e.page, { views: 0, users: new Set() });
    const v = m.get(e.page)!;
    v.views++;
    v.users.add(e.user_id);
  }
  return [...m.entries()]
    .map(([page, v]) => ({ page, views: v.views, users: v.users.size }))
    .sort((a, b) => b.views - a.views || a.page.localeCompare(b.page))
    .slice(0, limit);
}

export interface SessionSummary {
  userId: string;
  start: string;
  end: string;
  pageViews: number;
  pages: string[];
}

// Sessions are derived, not tracked: consecutive page views by one user with
// no gap longer than SESSION_GAP_MINUTES. Newest first.
export function deriveSessions(events: ActivityRow[]): SessionSummary[] {
  const views = events
    .filter((e) => e.event_type === "page_view" && e.page)
    .sort((a, b) => a.user_id.localeCompare(b.user_id) || a.occurred_at.localeCompare(b.occurred_at));
  const out: SessionSummary[] = [];
  let cur: SessionSummary | null = null;
  for (const e of views) {
    const gapOk =
      cur !== null &&
      cur.userId === e.user_id &&
      new Date(e.occurred_at).getTime() - new Date(cur.end).getTime() <= SESSION_GAP_MINUTES * 60_000;
    if (gapOk) {
      cur!.end = e.occurred_at;
      cur!.pageViews++;
      if (!cur!.pages.includes(e.page!)) cur!.pages.push(e.page!);
    } else {
      cur = { userId: e.user_id, start: e.occurred_at, end: e.occurred_at, pageViews: 1, pages: [e.page!] };
      out.push(cur);
    }
  }
  return out.sort((a, b) => b.start.localeCompare(a.start));
}

export function countEvents(events: ActivityRow[], type: ActivityRow["event_type"], since: Date): number {
  return events.filter((e) => e.event_type === type && new Date(e.occurred_at) >= since).length;
}

// Everything the console renders; produced by lib/super-admin-data.ts.
export interface ConsoleData {
  now: string;
  trackingAvailable: boolean;
  directory: DirectoryEntry[];
  otherAccounts: number;
  presence: PresenceRow[];
  recent: ActivityRow[]; // last 30 days, for analytics
  errors: string[];
}

// ── Activity filters (from the URL; validated before use in a query) ────────

export interface ActivityFilters {
  user: string | null;
  page: string | null;
  type: ActivityRow["event_type"] | null;
  from: string | null; // YYYY-MM-DD (Pacific), inclusive
  to: string | null; // YYYY-MM-DD (Pacific), inclusive
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EVENT_TYPES = ["page_view", "admin_event", "security_event"] as const;

export function parseActivityFilters(
  params: Record<string, string | string[] | undefined>,
  isPage: (v: string) => boolean,
): ActivityFilters {
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
  };
  const user = one("user");
  const page = one("page");
  const type = one("type");
  const from = one("from");
  const to = one("to");
  return {
    user: user && UUID_RE.test(user) ? user : null,
    page: page && isPage(page) ? page : null,
    type: type && (EVENT_TYPES as readonly string[]).includes(type) ? (type as ActivityFilters["type"]) : null,
    from: from && DATE_RE.test(from) ? from : null,
    to: to && DATE_RE.test(to) ? to : null,
  };
}
