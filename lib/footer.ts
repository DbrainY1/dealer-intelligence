// DealerIQ footer — what each viewer sees. Pure (no Next.js imports), so the
// permission rules and link inventory are unit-tested. Rendered by
// components/SiteFooter.tsx, which supplies the viewer's role/owner status
// from the server session.
//
// Nothing here is a security control: owner-only destinations enforce
// ownership themselves (requireOwnerPage / requireOwnerApi / RLS). The footer
// simply doesn't advertise them to anyone else.

import { securityEventsHref, usersHref } from "./super-admin-nav.ts";

// ── Content awaiting owner approval ──────────────────────────────────────────
//
// DealerIQ has no support channel, feedback form, privacy policy or terms of
// service yet (verified 2026-11-14). Those footer items render as disabled
// "not yet available" text until approved content exists. To publish one,
// set its value here in a reviewed PR:
//   supportEmail — an approved, monitored address (enables Help & support
//                  and Send feedback as mailto: links)
//   privacyPath / termsPath — a route serving APPROVED policy text
//                  (e.g. "/privacy"); never placeholder legal language.
export const FOOTER_CONTENT: {
  supportEmail: string | null;
  privacyPath: string | null;
  termsPath: string | null;
} = {
  supportEmail: null,
  privacyPath: null,
  termsPath: null,
};

export interface FooterLink {
  label: string;
  // null = not available yet: rendered as disabled text, never as a link.
  href: string | null;
  unavailableNote?: string;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

export interface BrandSegment {
  text: string;
  color: string;
}

export interface FooterModel {
  productName: string;
  poweredBy: { prefix: string; brand: readonly BrandSegment[] };
  description: string;
  columns: FooterColumn[];
  copyright: string;
  buildLabel: string | null;
}

// Approved branding (owner decision, 2026-11-14). Dealer's Intel is the brand
// name, not a legal entity; the legal owner and operator is LEGAL_OWNER.
export const BRAND_BLUE = "#3B82F6";
export const BRAND_ORANGE = "#FF9900";
export const POWERED_BY_BRAND: readonly BrandSegment[] = [
  { text: "Dealer", color: BRAND_BLUE },
  { text: "'s", color: BRAND_ORANGE },
  { text: " Intel", color: BRAND_BLUE },
];
export const LEGAL_OWNER = "LV Business Solutions Inc.";

export const PLATFORM_LINKS: readonly FooterLink[] = [
  { label: "Market Intel", href: "/dashboard" },
  { label: "The Market", href: "/dashboard/market" },
  { label: "Market Pulse", href: "/dashboard/competitors" },
  { label: "Compare", href: "/dashboard/compare" },
  { label: "Locations", href: "/dashboard/locations" },
];

const SA = "/super-admin";
export const OWNER_LINKS: readonly FooterLink[] = [
  { label: "Super Admin", href: SA },
  { label: "Users & Access", href: usersHref(SA) },
  { label: "Security Events", href: securityEventsHref(SA) },
];

const isEmail = (v: string) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);
const isLocalPath = (v: string) => /^\/[a-z0-9/_-]*$/i.test(v) && !v.startsWith("//");

// Only a real commit SHA from the build environment is shown — never the
// unmaintained package.json version.
export function buildLabel(sha: string | undefined | null, env: string | undefined | null): string | null {
  if (!sha || !/^[0-9a-f]{7,40}$/i.test(sha)) return null;
  const short = sha.slice(0, 7).toLowerCase();
  if (env === "preview") return `Preview build ${short}`;
  if (env === "development") return `Development build ${short}`;
  return `Build ${short}`;
}

export function buildFooterModel(input: {
  hasDealerIqRole: boolean;
  isOwner: boolean;
  year: number;
  content?: typeof FOOTER_CONTENT;
  build?: { sha?: string | null; env?: string | null };
}): FooterModel {
  const content = input.content ?? FOOTER_CONTENT;
  const email = content.supportEmail && isEmail(content.supportEmail) ? content.supportEmail : null;
  const path = (p: string | null) => (p && isLocalPath(p) ? p : null);

  const columns: FooterColumn[] = [];
  if (input.hasDealerIqRole) columns.push({ title: "Platform", links: [...PLATFORM_LINKS] });
  columns.push({
    title: "Support",
    links: [
      { label: "Help & Support", href: email ? `mailto:${email}` : null, unavailableNote: "Coming soon" },
      { label: "Send Feedback", href: email ? `mailto:${email}?subject=${encodeURIComponent("DealerIQ feedback")}` : null, unavailableNote: "Coming soon" },
    ],
  });
  columns.push({
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: path(content.privacyPath), unavailableNote: "Not yet published" },
      { label: "Terms of Service", href: path(content.termsPath), unavailableNote: "Not yet published" },
    ],
  });
  if (input.isOwner) columns.push({ title: "Platform oversight", links: [...OWNER_LINKS] });

  return {
    productName: "DealerIQ",
    poweredBy: { prefix: "Powered by", brand: POWERED_BY_BRAND },
    description: "Automotive Market Intelligence",
    columns,
    copyright: `© ${input.year} ${LEGAL_OWNER} All rights reserved.`,
    buildLabel: buildLabel(input.build?.sha, input.build?.env),
  };
}
