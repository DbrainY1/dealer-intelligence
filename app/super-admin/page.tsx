import { requireOwnerPage } from "@/lib/authz-server";
import { isPageKey } from "@/lib/activity";
import { parseActivityFilters } from "@/lib/super-admin";
import { loadConsoleData, queryActivity } from "@/lib/super-admin-data";
import SuperAdminConsole, { CONSOLE_VIEWS, type ConsoleView } from "@/components/super-admin/SuperAdminConsole";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Ownership is verified before ANY data is loaded (the layout checks too).
  await requireOwnerPage();

  const params = await searchParams;
  const view = (CONSOLE_VIEWS as readonly string[]).includes(params.view as string) ? (params.view as ConsoleView) : "overview";
  const filters = parseActivityFilters(params, isPageKey);

  const [data, activity] = await Promise.all([
    loadConsoleData(new Date()),
    view === "activity" ? queryActivity(filters) : Promise.resolve({ rows: [], available: true }),
  ]);

  return <SuperAdminConsole data={data} view={view} filters={filters} activity={activity} />;
}
