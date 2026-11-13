import { NextResponse } from "next/server";
import { getAuthContext, getIsPlatformOwner } from "@/lib/authz-server";
import { DEALERIQ_ROLES, decideAccess } from "@/lib/authz";
import { pageKeyForPath } from "@/lib/activity";
import { recordActivity } from "@/lib/activity-server";

// Page-view / heartbeat beacon from components/ActivityBeacon.tsx.
//
// The body carries only { path, kind }. The user is ALWAYS the verified
// session user — any other field in the body is ignored, so nobody can record
// activity as someone else. The path is reduced to an allowlisted page key
// (no ids, query strings or fragments are stored). Coalescing and per-user
// rate limits are enforced in the database function.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  const decision = decideAccess(ctx, DEALERIQ_ROLES);
  if (decision === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // DealerIQ users, plus Platform Owners (whose access does not depend on a role).
  if (decision === "forbidden" && !(await getIsPlatformOwner())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = await req.text();
  if (raw.length > 512) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { path, kind } = (body ?? {}) as { path?: unknown; kind?: unknown };
  const page = pageKeyForPath(path);
  if (!page || (kind !== "view" && kind !== "heartbeat")) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await recordActivity(ctx.userId!, kind === "view" ? { type: "page_view", page } : { type: "heartbeat", page });
  return new NextResponse(null, { status: 204 });
}
