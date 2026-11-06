// Invitation workflow for /api/invite.
//
// Pure orchestration with injected Supabase operations so every branch is
// unit-testable. The route handler supplies the real admin-client calls.
//
// Authorization is assigned HERE, on the trusted server, with the service-role
// client, at the moment the invite is sent. The invited user never writes
// their own role: /auth/callback only sets a password. The requested role is
// recorded in user_metadata as `invited_role` for reference only; nothing reads
// it for access decisions.

import { isDealerIqRole, type DealerIqRole } from "./authz.ts";

export type InviteOutcome =
  | "sent"
  | "already_registered"
  | "invalid_email"
  | "invalid_role"
  | "missing_fields"
  | "rate_limited"
  | "send_failed"
  | "role_assignment_failed"
  | "forbidden";

// Friendly, user-facing copy for each outcome (shown on /dashboard/settings).
export const INVITE_MESSAGES: Record<InviteOutcome, { tone: "success" | "error"; text: string }> = {
  sent: {
    tone: "success",
    text: "Invitation sent. They'll receive an email with a link to create their password and access DealerIQ.",
  },
  already_registered: {
    tone: "error",
    text: "That email already has an account, so no invitation was sent and their access was not changed.",
  },
  invalid_email: { tone: "error", text: "Please enter a valid email address." },
  invalid_role: { tone: "error", text: "Please choose an access role." },
  missing_fields: { tone: "error", text: "First name, last name, email, organization and role are required." },
  rate_limited: {
    tone: "error",
    text: "Too many invitation emails were sent recently. Please wait a few minutes and try again.",
  },
  send_failed: { tone: "error", text: "The invitation could not be sent. Please try again." },
  role_assignment_failed: {
    tone: "error",
    text: "The invitation was not completed: their access could not be set up, so they will not be able to use DealerIQ yet. Please send the invite again.",
  },
  forbidden: { tone: "error", text: "Only administrators can send invitations." },
};

export function isInviteOutcome(value: unknown): value is InviteOutcome {
  return typeof value === "string" && Object.hasOwn(INVITE_MESSAGES, value);
}

export interface InviteInput {
  email: string;
  role: DealerIqRole;
  firstName: string;
  lastName: string;
  organization: string;
  phone: string;
  notes: string;
}

// Deliberately simple: one "@", something on both sides, a dot in the domain,
// no whitespace. Supabase performs the authoritative check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseInviteForm(
  get: (name: string) => unknown,
): { ok: true; input: InviteInput } | { ok: false; outcome: InviteOutcome } {
  const str = (name: string) => {
    const v = get(name);
    return typeof v === "string" ? v.trim() : "";
  };

  const email = str("email").toLowerCase();
  const role = str("role");
  const firstName = str("first_name");
  const lastName = str("last_name");
  const organization = str("organization");

  if (!email || !firstName || !lastName || !organization || !role) return { ok: false, outcome: "missing_fields" };
  if (!EMAIL_RE.test(email)) return { ok: false, outcome: "invalid_email" };
  if (!isDealerIqRole(role)) return { ok: false, outcome: "invalid_role" };

  return {
    ok: true,
    input: { email, role, firstName, lastName, organization, phone: str("phone"), notes: str("notes") },
  };
}

// Where the invite email's link lands. Pinned to the canonical domain rather
// than derived from the request Host header. Supabase only honours it if the
// URL is in the project's Redirect URLs allow-list (Auth → URL Configuration).
export function inviteRedirectUrl(siteUrl: string | undefined): string {
  const base = (siteUrl?.trim() || "https://dealersintel.com").replace(/\/+$/, "");
  return `${base}/auth/callback`;
}

export interface InviteDeps {
  // auth.admin.inviteUserByEmail. For an address whose earlier invite was
  // never accepted, Supabase re-sends the invite for the same user id; for a
  // confirmed account it fails with code "email_exists".
  inviteUser(
    email: string,
    options: { redirectTo: string; data: Record<string, string> },
  ): Promise<{ userId: string | null; error: { code?: string; status?: number; message: string } | null }>;
  // Service-role write to public.user_roles (bypasses RLS).
  assignRole(userId: string, role: DealerIqRole): Promise<{ error: { message: string } | null }>;
  now(): Date;
  log(message: string, detail?: unknown): void;
}

export async function runInvite(
  deps: InviteDeps,
  input: InviteInput,
  inviterId: string,
  redirectTo: string,
): Promise<InviteOutcome> {
  const { userId, error } = await deps.inviteUser(input.email, {
    redirectTo,
    data: {
      first_name: input.firstName,
      last_name: input.lastName,
      organization: input.organization,
      phone: input.phone,
      notes: input.notes,
      invited_role: input.role,
      invited_at: deps.now().toISOString(),
      invited_by: inviterId,
    },
  });

  if (error) {
    if (error.code === "email_exists" || /already been registered/i.test(error.message)) {
      // An account that already accepted (or signed up). Never touch its role
      // from the invite form.
      return "already_registered";
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) return "rate_limited";
    deps.log("invite send failed", error);
    return "send_failed";
  }

  if (!userId) {
    deps.log("invite returned no user id");
    return "role_assignment_failed";
  }

  // Idempotent: a re-sent invite for a not-yet-accepted address converges on
  // the latest requested role instead of creating a second record.
  const { error: roleError } = await deps.assignRole(userId, input.role);
  if (roleError) {
    // The email may already be delivered, but the account has no DealerIQ
    // role, so every protected page and API fails closed for it. Re-sending
    // the invite retries the assignment for the same user id.
    deps.log("role assignment failed after invite", { userId, roleError });
    return "role_assignment_failed";
  }

  return "sent";
}
