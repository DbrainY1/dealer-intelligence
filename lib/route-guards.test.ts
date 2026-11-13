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
