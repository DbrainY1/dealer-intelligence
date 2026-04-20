import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";
import type { ScrapeLog } from "@/types";

const ROLES = [
  { value: "developer", label: "Developer", color: "bg-purple-900 text-purple-300", description: "Full system access including data sources, user management, and system configuration." },
  { value: "dealer_principal", label: "Dealer Principal", color: "bg-blue-900 text-blue-300", description: "Full market intel and competitor data across all locations. No system configuration." },
  { value: "store_manager", label: "Store Manager", color: "bg-cyan-900 text-cyan-300", description: "Single location access. Inventory and monthly performance data only." },
  { value: "finance_company", label: "Finance Company", color: "bg-emerald-900 text-emerald-300", description: "Market-level pricing trends and inventory data. No individual store operations." },
  { value: "investor", label: "Investor", color: "bg-amber-900 text-amber-300", description: "Market health and trend data. Read only. No operational data." },
  { value: "researcher", label: "Researcher", color: "bg-orange-900 text-orange-300", description: "Historical data and export access. Dealer data anonymized by default." },
  { value: "finance_manager", label: "Finance Manager", color: "bg-rose-900 text-rose-300", description: "Store financials and inventory access. No market intel." },
];

function getStatusBadge(runAt: string, status: string) {
  const hoursAgo = (Date.now() - new Date(runAt).getTime()) / (1000 * 60 * 60);
  if (status !== "success" || hoursAgo > 48)
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-900/50 text-red-300 border border-red-800"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Unavailable</span>;
  if (hoursAgo > 24)
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-900/50 text-amber-300 border border-amber-800"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />Delayed</span>;
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-900/50 text-emerald-300 border border-emerald-800"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Live</span>;
}

export default async function SettingsPage({ searchParams }: { searchParams: { invited?: string } }) {
  const supabase = await createServerSupabase();
  const invited = searchParams?.invited === "true";

  const { data: scrapeLogs } = await supabase.from("scrape_log").select("*").order("run_at", { ascending: false }).limit(50);
  const logList: ScrapeLog[] = scrapeLogs ?? [];
  const { data: dealers } = await supabase.from("dealers").select("*");
  const dealerMap = new Map((dealers ?? []).map((d: { id: number; name: string }) => [d.id, d.name]));
  const activeDealerIds = new Set((dealers ?? []).map((d: { id: number }) => d.id));
  const latestPerDealer = new Map<number, ScrapeLog>();
  for (const log of logList) {
    if (!latestPerDealer.has(log.dealer_id) && activeDealerIds.has(log.dealer_id))
      latestPerDealer.set(log.dealer_id, log);
  }

  return (
    <RoleGuard roles={["developer"]}>
      <div className="p-6 space-y-8 max-w-5xl">
        <div>
          <h1 className="text-white text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-gray-500 text-sm mt-1">Platform configuration and access management</p>
        </div>

        {invited && (
          <div className="flex items-center gap-3 px-5 py-4 bg-emerald-900/30 border border-emerald-700 rounded-xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <p className="text-emerald-300 text-sm font-medium">Invitation sent successfully. The user will receive an email with instructions to access the platform.</p>
          </div>
        )}

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-white font-semibold text-base">Data Sources</h2>
            <p className="text-gray-500 text-xs mt-0.5">Last updated times for all tracked market participants</p>
          </div>
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider bg-gray-800/50">
                <th className="px-6 py-3 font-medium">Market Participant</th>
                <th className="px-6 py-3 font-medium">Last Updated</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {Array.from(latestPerDealer.values()).map((log) => (
                <tr key={log.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-6 py-4 text-white font-medium">{dealerMap.get(log.dealer_id) ?? `Participant ${log.dealer_id}`}</td>
                  <td className="px-6 py-4 text-gray-400 font-mono text-xs">{log.run_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-6 py-4">{getStatusBadge(log.run_at, log.status)}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-800 rounded-full h-1.5 w-24">
                        <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: log.status === "success" ? "100%" : "0%" }} />
                      </div>
                      <span className="text-gray-400 text-xs font-mono">{log.status === "success" ? "100%" : "—"}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {latestPerDealer.size === 0 && (
                <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-600 text-sm">No data sources configured</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-white font-semibold text-base">Team Access</h2>
            <p className="text-gray-500 text-xs mt-0.5">Manage platform access and permissions</p>
          </div>
          <div className="p-6">
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 space-y-5">
              <div>
                <h3 className="text-white text-sm font-semibold">Add Member</h3>
                <p className="text-gray-500 text-xs mt-0.5">Invite a user and assign their access level. They will receive an email with instructions to access the platform.</p>
              </div>
              <form action="/api/invite" method="POST" className="space-y-4">

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">First Name <span className="text-red-400">*</span></label>
                    <input type="text" name="first_name" placeholder="John" required className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Last Name <span className="text-red-400">*</span></label>
                    <input type="text" name="last_name" placeholder="Smith" required className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Email Address <span className="text-red-400">*</span></label>
                  <input type="email" name="email" placeholder="name@company.com" required className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Organization <span className="text-red-400">*</span></label>
                    <input type="text" name="organization" placeholder="Company name" required className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Phone <span className="text-gray-600 font-normal normal-case">(optional)</span></label>
                    <input type="tel" name="phone" placeholder="+1 (555) 000-0000" className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Access Role <span className="text-red-400">*</span></label>
                  <select name="role" required className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors appearance-none cursor-pointer">
                    <option value="" disabled>Select a role...</option>
                    {ROLES.map((role) => (
                      <option key={role.value} value={role.value}>{role.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {ROLES.map((role) => (
                    <div key={role.value} className="flex items-start gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap mt-0.5 ${role.color}`}>{role.label}</span>
                      <p className="text-gray-500 text-xs leading-relaxed">{role.description}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400 font-medium uppercase tracking-wider">Notes <span className="text-gray-600 font-normal normal-case">(optional)</span></label>
                  <textarea name="notes" placeholder="How did they find the platform? What are they using it for?" rows={3} className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors resize-none" />
                </div>

                <div className="flex justify-end pt-2">
                  <button type="submit" className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900">
                    Send Invite →
                  </button>
                </div>

              </form>
            </div>
          </div>
        </div>

      </div>
    </RoleGuard>
  );
}
