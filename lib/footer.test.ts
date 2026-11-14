// Footer model: who sees what, unapproved content stays disabled, honest build label.
// Runner: node --experimental-strip-types --test lib/footer.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAND_BLUE, BRAND_ORANGE, FOOTER_CONTENT, LEGAL_OWNER, OWNER_LINKS, PLATFORM_LINKS, POWERED_BY_BRAND, buildFooterModel, buildLabel } from "./footer.ts";

const titles = (m: ReturnType<typeof buildFooterModel>) => m.columns.map((c) => c.title);
const hrefs = (m: ReturnType<typeof buildFooterModel>) => m.columns.flatMap((c) => c.links.map((l) => l.href)).filter(Boolean) as string[];

test("Platform Owner sees the owner-only oversight column", () => {
  const m = buildFooterModel({ hasDealerIqRole: true, isOwner: true, year: 2026 });
  assert.deepEqual(titles(m), ["Platform", "Support", "Legal", "Platform oversight"]);
  assert.deepEqual(m.columns.at(-1)!.links.map((l) => l.href), ["/super-admin", "/super-admin?view=users", "/super-admin?view=activity&type=security_event"]);
});

test("non-owner Developer (e.g. Herb), Dealer Principal and Viewer never get owner links", () => {
  const m = buildFooterModel({ hasDealerIqRole: true, isOwner: false, year: 2026 });
  assert.deepEqual(titles(m), ["Platform", "Support", "Legal"]);
  assert.ok(hrefs(m).every((h) => !h.startsWith("/super-admin")));
});

test("accounts without a DealerIQ role see no Platform links", () => {
  const m = buildFooterModel({ hasDealerIqRole: false, isOwner: false, year: 2026 });
  assert.deepEqual(titles(m), ["Support", "Legal"]);
  assert.deepEqual(hrefs(m), []);
});

test("support, feedback and legal stay disabled until approved content exists", () => {
  assert.deepEqual(FOOTER_CONTENT, { supportEmail: null, privacyPath: null, termsPath: null }, "no unapproved content is configured");
  const m = buildFooterModel({ hasDealerIqRole: true, isOwner: false, year: 2026 });
  const byTitle = (t: string) => m.columns.find((c) => c.title === t)!.links;
  for (const l of [...byTitle("Support"), ...byTitle("Legal")]) {
    assert.equal(l.href, null, l.label);
    assert.ok(l.unavailableNote, `${l.label} explains why it is unavailable`);
  }
});

test("approved content switches the links on; malformed values do not", () => {
  const ok = buildFooterModel({ hasDealerIqRole: true, isOwner: false, year: 2026, content: { supportEmail: "help@example.com", privacyPath: "/privacy", termsPath: "/terms" } });
  const all = ok.columns.flatMap((c) => c.links);
  assert.equal(all.find((l) => l.label === "Help & Support")!.href, "mailto:help@example.com");
  assert.equal(all.find((l) => l.label === "Send Feedback")!.href, "mailto:help@example.com?subject=DealerIQ%20feedback");
  assert.equal(all.find((l) => l.label === "Privacy Policy")!.href, "/privacy");
  const bad = buildFooterModel({ hasDealerIqRole: true, isOwner: false, year: 2026, content: { supportEmail: "not an email", privacyPath: "javascript:alert(1)", termsPath: "//evil.example/terms" } });
  for (const l of bad.columns.filter((c) => c.title !== "Platform").flatMap((c) => c.links)) assert.equal(l.href, null, l.label);
});

test("build label shows only a real commit SHA — never a made-up version", () => {
  assert.equal(buildLabel("c13c4e1a9f0b2c3d4e5f60718293a4b5c6d7e8f9", "production"), "Build c13c4e1");
  assert.equal(buildLabel("C13C4E1A", undefined), "Build c13c4e1");
  assert.equal(buildLabel("4802e87", "preview"), "Preview build 4802e87");
  for (const v of [undefined, null, "", "0.1.0", "v1.2.3", "latest", "c13c4e", "zzzzzzz"]) assert.equal(buildLabel(v as string, "production"), null, String(v));
  assert.equal(buildFooterModel({ hasDealerIqRole: true, isOwner: false, year: 2026 }).buildLabel, null);
});

test("approved copyright: LV Business Solutions Inc., dynamic year", () => {
  assert.equal(LEGAL_OWNER, "LV Business Solutions Inc.");
  assert.equal(buildFooterModel({ hasDealerIqRole: true, isOwner: false, year: 2026 }).copyright, "© 2026 LV Business Solutions Inc. All rights reserved.");
  assert.equal(buildFooterModel({ hasDealerIqRole: false, isOwner: false, year: 2027 }).copyright, "© 2027 LV Business Solutions Inc. All rights reserved.");
});

test("approved brand hierarchy: DealerIQ / Powered by Dealer's Intel / Automotive Market Intelligence", () => {
  const m = buildFooterModel({ hasDealerIqRole: true, isOwner: false, year: 2026 });
  assert.equal(m.productName, "DealerIQ");
  assert.equal(m.poweredBy.prefix, "Powered by");
  assert.equal(m.poweredBy.brand.map((s) => s.text).join(""), "Dealer's Intel");
  assert.equal(m.description, "Automotive Market Intelligence");
});

test("Dealer's Intel uses the exact brand colors: Dealer blue, 's orange, Intel blue", () => {
  assert.equal(BRAND_BLUE, "#3B82F6");
  assert.equal(BRAND_ORANGE, "#FF9900");
  assert.deepEqual(POWERED_BY_BRAND.map((s) => [s.text, s.color]), [["Dealer", "#3B82F6"], ["'s", "#FF9900"], [" Intel", "#3B82F6"]]);
});

test("Platform links match the main navigation set", () => {
  assert.deepEqual(PLATFORM_LINKS.map((l) => l.label), ["Market Intel", "The Market", "Market Pulse", "Compare", "Locations"]);
  assert.deepEqual(OWNER_LINKS.map((l) => l.label), ["Super Admin", "Users & Access", "Security Events"]);
});
