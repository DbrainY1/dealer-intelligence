// DealerIQ activity tracking — what may be recorded.
//
// Pure: no Next.js or Supabase imports, so the allowlists are unit-testable.
// The write path is lib/activity-server.ts → public.record_dealeriq_activity
// (service role only). The user id always comes from the verified server
// session, never from the client.
//
// Privacy: only short, allowlisted keys are stored. A page view records which
// KIND of page was opened (e.g. "dealer_detail"), never the URL, the record id
// in the path, query strings, fragments, form values or search input.

import type { InviteOutcome } from "./invite.ts";

interface PageRule {
  key: string;
  label: string;
  // Path with its query string and fragment already removed.
  test: (path: string) => boolean;
}

const exact = (p: string) => (path: string) => path === p;
const oneSegmentUnder = (prefix: string) => (path: string) =>
  path.startsWith(prefix) && /^[^/]+$/.test(path.slice(prefix.length));

const PAGE_RULES: readonly PageRule[] = [
  { key: "market_intel", label: "Market Intel", test: exact("/dashboard") },
  { key: "the_market", label: "The Market", test: exact("/dashboard/market") },
  { key: "market_archive", label: "Market Brief Archive", test: exact("/dashboard/market/archive") },
  { key: "market_pulse", label: "Market Pulse", test: exact("/dashboard/competitors") },
  { key: "compare", label: "Compare", test: exact("/dashboard/compare") },
  { key: "locations", label: "Locations", test: exact("/dashboard/locations") },
  { key: "dealer_detail", label: "Dealer detail", test: oneSegmentUnder("/dashboard/dealer/") },
  { key: "group_detail", label: "Group detail", test: oneSegmentUnder("/dashboard/group/") },
  { key: "vin_history", label: "VIN history", test: oneSegmentUnder("/dashboard/vin/") },
  { key: "settings", label: "Settings", test: exact("/dashboard/settings") },
  { key: "super_admin", label: "Super Admin", test: exact("/super-admin") },
];

export const PAGE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  PAGE_RULES.map((r) => [r.key, r.label]),
);

export function isPageKey(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(PAGE_LABELS, value);
}

// Map a browser pathname to an allowlisted page key, or null if it is not a
// tracked page. Anything after "?" or "#" is discarded before matching.
export function pageKeyForPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return null;
  let path = raw.split(/[?#]/, 1)[0];
  if (path.length > 1) path = path.replace(/\/+$/, "");
  if (!path.startsWith("/") || path.includes("//") || path.includes("..")) return null;
  return PAGE_RULES.find((r) => r.test(path))?.key ?? null;
}

const INVITE_OUTCOMES: readonly InviteOutcome[] = [
  "sent",
  "already_registered",
  "invalid_email",
  "invalid_role",
  "missing_fields",
  "rate_limited",
  "send_failed",
  "role_assignment_failed",
  "forbidden",
];

export const ADMIN_ACTIONS: readonly string[] = [...INVITE_OUTCOMES.map((o) => `invite.${o}`), "map_config.saved"];

export const SECURITY_ACTIONS: readonly string[] = ["super_admin.page_denied", "super_admin.api_denied"];

export const ACTION_LABELS: Readonly<Record<string, string>> = {
  "invite.sent": "Invitation sent",
  "invite.already_registered": "Invite skipped: already registered",
  "invite.invalid_email": "Invite rejected: invalid email",
  "invite.invalid_role": "Invite rejected: invalid role",
  "invite.missing_fields": "Invite rejected: missing fields",
  "invite.rate_limited": "Invite failed: rate limited",
  "invite.send_failed": "Invite failed: email not sent",
  "invite.role_assignment_failed": "Invite failed: role not assigned",
  "invite.forbidden": "Invite denied: not an administrator",
  "map_config.saved": "Map configuration saved",
  "super_admin.page_denied": "Super Admin page denied",
  "super_admin.api_denied": "Super Admin API denied",
};

export type ActivityEvent =
  | { type: "page_view"; page: string }
  | { type: "heartbeat"; page?: string | null }
  | { type: "admin_event"; action: string }
  | { type: "security_event"; action: string };

export interface RecordArgs {
  p_user_id: string;
  p_event_type: ActivityEvent["type"];
  p_page: string | null;
  p_action: string | null;
}

// Validates an event against the allowlists. Returns null for anything that
// must not be written.
export function toRecordArgs(userId: string | null, event: ActivityEvent): RecordArgs | null {
  if (!userId) return null;
  switch (event.type) {
    case "page_view":
      return isPageKey(event.page) ? { p_user_id: userId, p_event_type: "page_view", p_page: event.page, p_action: null } : null;
    case "heartbeat": {
      const page = event.page ?? null;
      if (page !== null && !isPageKey(page)) return null;
      return { p_user_id: userId, p_event_type: "heartbeat", p_page: page, p_action: null };
    }
    case "admin_event":
      return ADMIN_ACTIONS.includes(event.action)
        ? { p_user_id: userId, p_event_type: "admin_event", p_page: null, p_action: event.action }
        : null;
    case "security_event":
      return SECURITY_ACTIONS.includes(event.action)
        ? { p_user_id: userId, p_event_type: "security_event", p_page: null, p_action: event.action }
        : null;
    default:
      return null;
  }
}
