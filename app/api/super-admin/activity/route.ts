import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/authz-server";
import { isPageKey } from "@/lib/activity";
import { parseActivityFilters } from "@/lib/super-admin";
import { queryActivity } from "@/lib/super-admin-data";

// Owner-only: filtered activity history as JSON (newest first, max 500).
// Ownership is checked here AND by RLS on dealeriq_activity.
export async function GET(req: Request) {
  const access = await requireOwnerApi();
  if (!access.ok) return access.response;

  const params = Object.fromEntries(new URL(req.url).searchParams);
  const filters = parseActivityFilters(params, isPageKey);
  const { rows, available } = await queryActivity(filters, 500);
  if (!available) return NextResponse.json({ error: "Activity tracking is not enabled" }, { status: 503 });
  return NextResponse.json({ filters, rows });
}
