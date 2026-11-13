import { requireOwnerPage } from "@/lib/authz-server";
import { isPageKey } from "@/lib/activity";
import { parseActivityFilters } from "@/lib/super-admin";
import { parseConsoleRoute } from "@/lib/super-admin-nav";
import { loadConsoleData, queryActivity } from "@/lib/super-admin-data";
import SuperAdminConsole from "@/components/super-admin/SuperAdminConsole";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Ownership is verified before ANY data is loaded (the layout checks too).
  await requireOwnerPage();

  const params = await searchParams;
  const route = parseConsoleRoute(params);
  const filters = parseActivityFilters(params, isPageKey);

  // History is read through the owner's session, so RLS enforces ownership too.
  const history =
    route.view === "activity"
      ? queryActivity(filters)
      : route.view === "user" && route.userId
        ? queryActivity({ user: route.userId, page: null, type: null, from: null, to: null })
        : Promise.resolve({ rows: [], available: true });

  const [data, activity] = await Promise.all([loadConsoleData(new Date()), history]);

  return <SuperAdminConsole data={data} route={route} filters={filters} activity={activity} />;
}
