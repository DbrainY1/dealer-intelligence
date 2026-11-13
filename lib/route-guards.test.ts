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
  const unguarded = routes.filter((p) => !/requireApiRole\(|decideAccess\(/.test(read(p))).map(rel);
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
    .filter((p) => /SERVICE_ROLE|createAdminSupabase|supabase-server|authz-server/.test(read(p)))
    .map(rel);
  assert.deepEqual(leaks, []);
});
