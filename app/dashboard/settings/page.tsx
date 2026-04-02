import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";
import type { ScrapeLog } from "@/types";

export default async function SettingsPage() {
  const supabase = await createServerSupabase();

  const { data: scrapeLogs } = await supabase
    .from("scrape_log")
    .select("*")
    .order("run_at", { ascending: false })
    .limit(50);

  const logList: ScrapeLog[] = scrapeLogs ?? [];

  // Latest per dealer
  const latestPerDealer = new Map<number, ScrapeLog>();
  for (const log of logList) {
    if (!latestPerDealer.has(log.dealer_id)) latestPerDealer.set(log.dealer_id, log);
  }

  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerMap = new Map((dealers ?? []).map((d: { id: number; name: string }) => [d.id, d.name]));

  return (
    <RoleGuard roles={["developer"]}>
      <div className="p-6 space-y-6">
        <h1 className="text-white text-xl font-bold">Settings</h1>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-4">Scrape Logs (Last Run per Dealer)</h2>
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-800">
              <tr>
                <th className="px-4 py-3">Dealer</th>
                <th className="px-4 py-3">Last Run</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(latestPerDealer.values()).map((log) => (
                <tr key={log.id} className="border-b border-gray-800">
                  <td className="px-4 py-3">{dealerMap.get(log.dealer_id) ?? log.dealer_id}</td>
                  <td className="px-4 py-3">{log.run_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${log.status === "success" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                      {log.status === "success" ? "OK" : "FAIL"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-red-400 text-xs">{log.error_msg ?? "—"}</td>
                </tr>
              ))}
              {latestPerDealer.size === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">No logs</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <InviteSection />
      </div>
    </RoleGuard>
  );
}

function InviteSection() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h2 className="text-white font-semibold mb-4">Invite User</h2>
      <form action="/api/invite" method="POST" className="flex gap-3">
        <input
          type="email"
          name="email"
          placeholder="user@example.com"
          required
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
        >
          Send Invite
        </button>
      </form>
    </div>
  );
}
