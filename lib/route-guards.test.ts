// Static coverage check: every protected page and API route performs its own
// authorization check, and no client-side code can write roles or reach the
// service-role key. Catches a new route added without a guard.
// Runner: node --experimental-strip-types --test lib/route-guards.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const rel = (p: string) => relative(ROOT, p);
const read = (p: string) => readFileSync(p, "utf8");
const sourceFiles = ["app", "components", "lib"].flatMap((d) => walk(join(ROOT, d))).filter((p) => /\.tsx?$/.test(p) && !p.endsWith(".test.ts"));

test("every dashboard page checks the caller's role itself", () => {
  const pages = walk(join(ROOT, "app/dashboard")).filter((p) => p.endsWith("page.tsx"));
  assert.ok(pages.length >= 10, "expected to find the dashboard pages");
  const unguarded = pages.filter((p) => !/denyUnlessRole\(|<RoleGuard roles=/.test(read(p))).map(rel);
  assert.deepEqual(unguarded, []);
});

test("the dashboard layout denies accounts without a DealerIQ role", () => {
  assert.match(read(join(ROOT, "app/dashboard/layout.tsx")), /denyUnlessRole\(DEALERIQ_ROLES\)/);
});

test("every API route checks the caller's role itself", () => {
  const routes = walk(join(ROOT, "app/api")).filter((p) => p.endsWith("route.ts"));
  assert.ok(routes.length >= 3, "expected to find the API routes");
  const unguarded = routes.filter((p) => !/requireApiRole\(|decideAccess\(|requireOwnerApi\(/.test(read(p))).map(rel);
  assert.deepEqual(unguarded, []);
});

test("administrative routes require ADMIN_ROLES", () => {
  for (const p of ["app/api/invite/route.ts", "app/api/map-config/route.ts", "app/dashboard/settings/page.tsx"]) {
    assert.match(read(join(ROOT, p)), /ADMIN_ROLES/, p);
  }
});

test("only the server invite route writes user_roles", () => {
  const writers = sourceFiles
    .filter((p) => /from\(\s*["']user_roles["']\s*\)[\s\S]{0,80}\.(upsert|insert|update|delete)\(/.test(read(p)))
    .map(rel);
  assert.deepEqual(writers, ["app/api/invite/route.ts"]);
});

test("no source file reads a role from user_metadata", () => {
  const readers = sourceFiles.filter((p) => /user_metadata\??\.\s*role\b/.test(read(p))).map(rel);
  assert.deepEqual(readers, []);
});

test("client components never reference the service-role key or admin client", () => {
  const leaks = sourceFiles
    .filter((p) => /^\s*["']use client["']/.test(read(p)))
    .filter((p) => /SERVICE_ROLE|createAdminSupabase|supabase-server|authz-server|activity-server|super-admin-data/.test(read(p)))
    .map(rel);
  assert.deepEqual(leaks, []);
});

// ── Super Admin (Platform Owner) ─────────────────────────────────────────────

test("every Super Admin page and the layout require ownership before loading data", () => {
  const files = walk(join(ROOT, "app/super-admin")).filter((p) => /(page|layout)\.tsx$/.test(p));
  assert.ok(files.length >= 2, "expected the Super Admin layout and page");
  for (const p of files) {
    const src = read(p);
    assert.match(src, /await requireOwnerPage\(\)/, rel(p));
    // The owner check must come before any data loading in the file.
    const guard = src.indexOf("await requireOwnerPage()");
    for (const loader of ["loadConsoleData(", "queryActivity("]) {
      const at = src.indexOf(loader);
      if (at !== -1) assert.ok(guard < at, `${rel(p)}: ${loader} before ownership check`);
    }
  }
});

test("every owner-only API route requires ownership", () => {
  const routes = walk(join(ROOT, "app/api/super-admin")).filter((p) => p.endsWith("route.ts"));
  assert.ok(routes.length >= 1);
  for (const p of routes) assert.match(read(p), /requireOwnerApi\(\)/, rel(p));
});

test("owner data loaders are used only behind owner guards", () => {
  const users = sourceFiles.filter((p) => /from ["']@\/lib\/super-admin-data["']/.test(read(p))).map(rel).sort();
  assert.deepEqual(users, ["app/api/super-admin/activity/route.ts", "app/super-admin/page.tsx"]);
});

test("owner status never comes from roles, metadata or email", () => {
  const src = read(join(ROOT, "lib/authz-server.ts"));
  const fn = src.slice(src.indexOf("export const getIsPlatformOwner"), src.indexOf("export async function requireOwnerPage"));
  assert.match(fn, /from\("platform_owners"\)/);
  assert.doesNotMatch(fn, /user_roles|user_metadata|email|developer/);
});

test("no source file writes platform_owners or activity tables directly", () => {
  const writers = sourceFiles
    .filter((p) => /from\(\s*["'](platform_owners|dealeriq_activity|dealeriq_presence)["']\s*\)[\s\S]{0,80}\.(upsert|insert|update|delete)\(/.test(read(p)))
    .map(rel);
  assert.deepEqual(writers, []);
});

test("only lib/activity-server.ts calls the activity write function", () => {
  const callers = sourceFiles.filter((p) => /\.rpc\(\s*["']record_dealeriq_activity/.test(read(p))).map(rel);
  assert.deepEqual(callers, ["lib/activity-server.ts"]);
});

test("the activity endpoint takes identity from the session, never the body", () => {
  const src = read(join(ROOT, "app/api/activity/route.ts"));
  assert.match(src, /recordActivity\(ctx\.userId!/);
  assert.doesNotMatch(src, /user_?id\s*[:}]|userId\s*[:}]|body\.user/i);
  assert.match(src, /pageKeyForPath\(/);
});

test("the beacon sends only the pathname — no query string, hash or form data", () => {
  const src = read(join(ROOT, "components/ActivityBeacon.tsx"));
  assert.match(src, /JSON\.stringify\(\{ path, kind \}\)/);
  assert.doesNotMatch(src, /useSearchParams|location\.(search|hash|href)|FormData|document\.cookie/);
});

// ── Super Admin drill-downs: interaction and layout guarantees ───────────────

test("Super Admin console: clickable elements are real links with a visible focus ring", () => {
  const src = read(join(ROOT, "components/super-admin/SuperAdminConsole.tsx"));
  assert.doesNotMatch(src, /^\s*["']use client["']/m, "console stays a server component");
  assert.doesNotMatch(src, /onClick|role=["']button["']|tabIndex/, "no click handlers on non-interactive elements");
  const links = src.match(/<Link\b[\s\S]*?>/g) ?? [];
  assert.ok(links.length >= 5, "tabs, alerts, filter pills, user and text links");
  for (const l of links) assert.match(l, /FOCUS|focus-visible/, l.slice(0, 80));
  const card = read(join(ROOT, "components/KPICard.tsx"));
  assert.match(card, /<Link[\s\S]*focus-visible:ring/);
  assert.match(card, /if \(!href\)/, "cards without href render unchanged (static)");
});

test("Super Admin console: tables scroll horizontally and the user view is read-only", () => {
  const src = read(join(ROOT, "components/super-admin/SuperAdminConsole.tsx"));
  assert.match(src, /function Table[\s\S]*?overflow-x-auto/);
  const user = src.slice(src.indexOf('view === "user"'), src.indexOf('view === "activity"'));
  assert.ok(user.length > 200);
  assert.doesNotMatch(user, /<form|method=|delete|Delete|updateUser|upsert|insert/, "no editing or deletion in the user view");
  assert.doesNotMatch(src, /super-admin-data|createAdminSupabase|supabase-server/, "presentation never loads data itself");
});

test("drill-down routing goes through the validated parser", () => {
  const page = read(join(ROOT, "app/super-admin/page.tsx"));
  assert.match(page, /parseConsoleRoute\(params\)/);
  assert.ok(page.indexOf("await requireOwnerPage()") < page.indexOf("parseConsoleRoute("));
});

// ── Site footer ──────────────────────────────────────────────────────────────

test("every active footer link resolves to a real page", async () => {
  const { OWNER_LINKS, PLATFORM_LINKS } = await import("./footer.ts");
  for (const l of [...PLATFORM_LINKS, ...OWNER_LINKS]) {
    const path = l.href!.split("?")[0];
    const page = join(ROOT, "app", path, "page.tsx");
    assert.ok(statSync(page).isFile(), `${l.label} → ${path}`);
  }
});

test("no legal or support content is published without approval", () => {
  for (const p of ["app/privacy", "app/terms", "app/legal", "app/support"]) {
    assert.throws(() => statSync(join(ROOT, p)), `${p} must not exist until approved content is supplied`);
  }
  const src = read(join(ROOT, "components/SiteFooter.tsx")) + read(join(ROOT, "lib/footer.ts"));
  assert.doesNotMatch(src, /we collect|personal (data|information)|governing law|liability|arbitration|warrant(y|ies)|indemnif/i);
  // The only rights statement allowed is the owner-approved copyright line.
  const rights = src.match(/[^\n]*all rights reserved[^\n]*/gi) ?? [];
  assert.ok(rights.length >= 1 && rights.every((l) => l.includes("${LEGAL_OWNER} All rights reserved.")), rights.join(" | "));
});

test("the business address is not displayed anywhere in the app", () => {
  const leaks = sourceFiles.filter((p) => /3333\s+Fremont|Las Vegas,?\s*NV\s*89104|89104/i.test(read(p))).map(rel);
  assert.deepEqual(leaks, []);
});

test("footer brand text renders on one line with each segment's own color", () => {
  const src = read(join(ROOT, "components/SiteFooter.tsx"));
  assert.match(src, /whitespace-nowrap/);
  assert.match(src, /style=\{\{ color: seg\.color \}\}/);
  assert.match(src, /text-xs text-gray-500[^>]*>\{model\.poweredBy\.prefix\}/, "'Powered by' is smaller and muted");
});

test("footer is server-rendered, in normal flow, and keyboard-accessible", () => {
  const src = read(join(ROOT, "components/SiteFooter.tsx"));
  assert.doesNotMatch(src, /^\s*["']use client["']/m, "owner status must be decided on the server");
  assert.match(src, /getIsPlatformOwner\(\)/);
  assert.doesNotMatch(src, /className=[{"`][^>]*\b(fixed|sticky)\b/, "must not overlay page content");
  assert.match(src, /focus-visible:ring/);
  assert.match(src, /aria-disabled="true"/, "unavailable items are disabled text, not links");
  for (const layout of ["app/dashboard/layout.tsx", "app/super-admin/layout.tsx"]) assert.match(read(join(ROOT, layout)), /<SiteFooter \/>/, layout);
});
