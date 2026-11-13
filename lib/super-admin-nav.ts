// Super Admin navigation: every drill-down link the console renders, and the
// parser that turns the URL back into a validated view. Pure, so links and
// parsing are unit-tested together.
//
// The console is server-rendered behind requireOwnerPage(); these URLs carry
// only view/filter keys and an account id, never activity data. Opening one
// without Platform Owner status gives a 404.

import { isUsersFilter, type UsersFilter } from "./super-admin.ts";

export const CONSOLE_VIEWS = ["overview", "activity", "users", "user", "analytics"] as const;
export type ConsoleView = (typeof CONSOLE_VIEWS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ConsoleRoute {
  view: ConsoleView;
  usersFilter: UsersFilter;
  userId: string | null;
}

export function parseConsoleRoute(params: Record<string, string | string[] | undefined>): ConsoleRoute {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : null);
  const rawView = one("view");
  const rawFilter = one("filter");
  const rawId = one("id");
  const userId = rawId && UUID_RE.test(rawId) ? rawId : null;
  let view: ConsoleView = (CONSOLE_VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as ConsoleView) : "overview";
  // A user page without a valid id falls back to the full list.
  if (view === "user" && !userId) view = "users";
  return { view, usersFilter: isUsersFilter(rawFilter) ? rawFilter : "all", userId: view === "user" ? userId : null };
}

function href(base: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export const overviewHref = (base: string) => base;
export const usersHref = (base: string, filter: UsersFilter = "all") =>
  href(base, { view: "users", filter: filter === "all" ? null : filter });
export const userHref = (base: string, userId: string) => href(base, { view: "user", id: userId });
export const activityHref = (
  base: string,
  f: { user?: string | null; type?: "page_view" | "admin_event" | "security_event" | null } = {},
) => href(base, { view: "activity", user: f.user, type: f.type });
export const analyticsHref = (base: string) => href(base, { view: "analytics" });
export const securityEventsHref = (base: string) => activityHref(base, { type: "security_event" });
