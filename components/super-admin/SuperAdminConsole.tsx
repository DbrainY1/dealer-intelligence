// Owner-only Super Admin console — presentation only. All data arrives via
// props from app/super-admin/page.tsx, which has already verified ownership.

import Link from "next/link";
import KPICard from "@/components/KPICard";
import TrendChart from "@/components/TrendChart";
import { ACTION_LABELS, PAGE_LABELS } from "@/lib/activity";
import {
  ACTIVE_NOW_MINUTES,
  RETENTION_DAYS,
  activeUserCount,
  countEvents,
  dailyActiveUsers,
  deriveSessions,
  isActiveNow,
  roleCounts,
  startOfPacificDay,
  topPages,
  type AccountStatus,
  type ActivityFilters,
  type ActivityRow,
  type ConsoleData,
  type DirectoryEntry,
} from "@/lib/super-admin";

export type ConsoleView = "overview" | "activity" | "users" | "analytics";
export const CONSOLE_VIEWS: readonly ConsoleView[] = ["overview", "activity", "users", "analytics"];

interface Props {
  data: ConsoleData;
  view: ConsoleView;
  filters: ActivityFilters;
  activity: { rows: ActivityRow[]; available: boolean };
  basePath?: string;
}

const TZ = "America/Los_Angeles";
const fmtTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "—";

function fmtAgo(iso: string | null, now: Date): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const displayName = (e: Pick<DirectoryEntry, "firstName" | "lastName" | "email">) =>
  [e.firstName, e.lastName].filter(Boolean).join(" ") || e.email || "Unknown account";
const pageLabel = (k: string | null) => (k ? PAGE_LABELS[k] ?? k : "—");

const ROLE_LABEL: Record<string, string> = { developer: "Developer", dealer_principal: "Dealer Principal", viewer: "Viewer" };
const ROLE_STYLE: Record<string, string> = {
  developer: "bg-purple-900/60 text-purple-300",
  dealer_principal: "bg-blue-900/60 text-blue-300",
  viewer: "bg-gray-700 text-gray-300",
};

const STATUS: Record<AccountStatus, { label: string; style: string }> = {
  active_now: { label: "Online (inferred)", style: "bg-emerald-900/50 text-emerald-300 border-emerald-800" },
  active: { label: "Active account", style: "bg-gray-800 text-gray-300 border-gray-700" },
  pending_invite: { label: "Invited — not accepted", style: "bg-amber-900/40 text-amber-300 border-amber-800" },
  missing_role: { label: "No DealerIQ role", style: "bg-red-900/40 text-red-300 border-red-800" },
  never_signed_in: { label: "Never signed in", style: "bg-gray-800 text-gray-400 border-gray-700" },
};

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap border border-transparent ${className}`}>{children}</span>;
}

function RoleBadge({ role }: { role: string | null }) {
  return role && ROLE_LABEL[role] ? <Badge className={ROLE_STYLE[role]}>{ROLE_LABEL[role]}</Badge> : <Badge className="bg-red-900/40 text-red-300">No role</Badge>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-white font-semibold text-base">{title}</h2>
        {subtitle && <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-gray-500 text-sm">{children}</p>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-xs text-gray-500 uppercase tracking-wider bg-gray-800/50">
            {head.map((h) => (
              <th key={h} scope="col" className="px-5 py-3 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">{children}</tbody>
      </table>
    </div>
  );
}

const NOT_TRACKED = "Not tracked yet";

export default function SuperAdminConsole({ data, view, filters, activity, basePath = "/super-admin" }: Props) {
  const now = new Date(data.now);
  const byId = new Map(data.directory.map((e) => [e.id, e]));
  const who = (id: string) => (byId.get(id) ? displayName(byId.get(id)!) : "Account not listed");
  const roles = roleCounts(data.directory);
  const pendingInvites = data.directory.filter((e) => e.status === "pending_invite").length;
  const missingRoles = data.directory.filter((e) => e.status === "missing_role").length;
  const t = data.trackingAvailable;
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const securityEvents7d = countEvents(data.recent, "security_event", week);

  const tab = (v: ConsoleView, label: string) => (
    <Link
      key={v}
      href={v === "overview" ? basePath : `${basePath}?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
        view === v ? "bg-gray-800 text-white font-semibold" : "text-gray-400 hover:text-white hover:bg-gray-800/60"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">Owner only</p>
          <h1 className="text-white text-2xl font-bold tracking-tight mt-1">Super Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Platform oversight · as of {fmtTime(data.now)} PT</p>
        </div>
        <nav aria-label="Super Admin sections" className="flex gap-1 overflow-x-auto">
          {tab("overview", "Overview")}
          {tab("activity", "Activity")}
          {tab("users", "Users & access")}
          {tab("analytics", "Usage analytics")}
        </nav>
      </header>

      {!t && (
        <div role="status" className="px-5 py-4 bg-amber-900/20 border border-amber-800 rounded-xl text-amber-200 text-sm">
          Activity tracking is not enabled yet. Account data is shown; presence, activity and usage figures will appear once tracking is switched on.
        </div>
      )}
      {data.errors.length > 0 && (
        <div role="alert" className="px-5 py-4 bg-red-900/20 border border-red-800 rounded-xl text-red-300 text-sm">
          Some data could not be loaded: {data.errors.join(" ")}
        </div>
      )}

      {view === "overview" && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard label="DealerIQ users" value={data.directory.length} />
            <KPICard label={`Active now (${ACTIVE_NOW_MINUTES} min)`} value={t ? activeUserCount(data.presence, [], new Date(now.getTime() - ACTIVE_NOW_MINUTES * 60_000)) : NOT_TRACKED} />
            <KPICard label="Active today (PT)" value={t ? activeUserCount(data.presence, data.recent, startOfPacificDay(now)) : NOT_TRACKED} />
            <KPICard label="Active last 7 days" value={t ? activeUserCount(data.presence, data.recent, week) : NOT_TRACKED} />
            <KPICard label="Developers" value={roles.developer} />
            <KPICard label="Dealer Principals" value={roles.dealer_principal} />
            <KPICard label="Viewers" value={roles.viewer} />
            <KPICard label="Pending invitations" value={pendingInvites} />
          </div>

          <Panel title="Alerts" subtitle="Onboarding problems and security events">
            <ul className="divide-y divide-gray-800 text-sm">
              <li className="px-5 py-3 flex justify-between gap-4">
                <span className="text-gray-300">Accounts without a DealerIQ role</span>
                <span className={missingRoles ? "text-red-300 font-semibold" : "text-gray-500"}>{missingRoles}</span>
              </li>
              <li className="px-5 py-3 flex justify-between gap-4">
                <span className="text-gray-300">Invitations not yet accepted</span>
                <span className={pendingInvites ? "text-amber-300 font-semibold" : "text-gray-500"}>{pendingInvites}</span>
              </li>
              <li className="px-5 py-3 flex justify-between gap-4">
                <span className="text-gray-300">Denied Super Admin attempts (7 days)</span>
                <span className={securityEvents7d ? "text-red-300 font-semibold" : "text-gray-500"}>{t ? securityEvents7d : NOT_TRACKED}</span>
              </li>
            </ul>
          </Panel>

          <Panel title="Currently active" subtitle={`Inferred from the last recorded page view or heartbeat. "Online" means seen in the last ${ACTIVE_NOW_MINUTES} minutes — not a guaranteed live session.`}>
            {!t ? (
              <Empty>{NOT_TRACKED}.</Empty>
            ) : (() => {
              const recent = data.directory.filter((e) => e.lastSeenAt && now.getTime() - new Date(e.lastSeenAt).getTime() < 86_400_000);
              return recent.length === 0 ? (
                <Empty>Nobody has been seen in the last 24 hours.</Empty>
              ) : (
                <Table head={["User", "Role", "Current / last page", "Last activity", "Status"]}>
                  {recent.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-800/30">
                      <td className="px-5 py-3"><p className="text-white font-medium">{displayName(e)}</p><p className="text-gray-500 text-xs">{e.email}</p></td>
                      <td className="px-5 py-3"><RoleBadge role={e.role} /></td>
                      <td className="px-5 py-3 text-gray-300">{pageLabel(e.lastPage)}</td>
                      <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtAgo(e.lastSeenAt, now)}</td>
                      <td className="px-5 py-3">
                        {isActiveNow(e.lastSeenAt, now) ? (
                          <Badge className={STATUS.active_now.style}><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5" />Online (inferred)</Badge>
                        ) : (
                          <Badge className="bg-gray-800 text-gray-400">Idle</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              );
            })()}
          </Panel>
        </>
      )}

      {view === "users" && (
        <Panel
          title="Users & access"
          subtitle={`Accounts connected to DealerIQ. Invitations are sent from Settings → Team Access.${data.otherAccounts ? ` ${data.otherAccounts} other account(s) in the shared Supabase project are not shown.` : ""}`}
        >
          {data.directory.length === 0 ? (
            <Empty>No DealerIQ accounts found.</Empty>
          ) : (
            <Table head={["User", "Role", "Status", "Last sign-in", "Last activity"]}>
              {data.directory.map((e) => (
                <tr key={e.id} className="hover:bg-gray-800/30">
                  <td className="px-5 py-3">
                    <p className="text-white font-medium">
                      {displayName(e)} {e.isOwner && <Badge className="ml-1 bg-amber-900/50 text-amber-300">Owner</Badge>}
                    </p>
                    <p className="text-gray-500 text-xs">{e.email}</p>
                  </td>
                  <td className="px-5 py-3"><RoleBadge role={e.role} /></td>
                  <td className="px-5 py-3"><Badge className={STATUS[e.status].style}>{STATUS[e.status].label}</Badge></td>
                  <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtTime(e.lastSignInAt)}</td>
                  <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{t ? `${fmtAgo(e.lastSeenAt, now)}${e.lastPage ? ` · ${pageLabel(e.lastPage)}` : ""}` : NOT_TRACKED}</td>
                </tr>
              ))}
            </Table>
          )}
          <p className="px-5 py-3 border-t border-gray-800 text-xs text-gray-500">
            Manage invitations in <Link href="/dashboard/settings" className="text-blue-400 hover:text-blue-300">Settings</Link>. Role and owner changes use the approved administrative procedures.
          </p>
        </Panel>
      )}

      {view === "activity" && (
        <>
          <form method="get" action={basePath} className="bg-gray-900 border border-gray-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <input type="hidden" name="view" value="activity" />
            <label className="text-xs text-gray-400 space-y-1 lg:col-span-2">
              <span className="block uppercase tracking-wider">User</span>
              <select name="user" defaultValue={filters.user ?? ""} className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm">
                <option value="">All users</option>
                {data.directory.map((e) => <option key={e.id} value={e.id}>{displayName(e)}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-400 space-y-1">
              <span className="block uppercase tracking-wider">Page</span>
              <select name="page" defaultValue={filters.page ?? ""} className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm">
                <option value="">All pages</option>
                {Object.entries(PAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-400 space-y-1">
              <span className="block uppercase tracking-wider">Event</span>
              <select name="type" defaultValue={filters.type ?? ""} className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm">
                <option value="">All events</option>
                <option value="page_view">Page views</option>
                <option value="admin_event">Admin events</option>
                <option value="security_event">Security events</option>
              </select>
            </label>
            <label className="text-xs text-gray-400 space-y-1">
              <span className="block uppercase tracking-wider">From</span>
              <input type="date" name="from" defaultValue={filters.from ?? ""} className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm" />
            </label>
            <label className="text-xs text-gray-400 space-y-1">
              <span className="block uppercase tracking-wider">To</span>
              <input type="date" name="to" defaultValue={filters.to ?? ""} className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm" />
            </label>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-6 justify-end">
              <Link href={`${basePath}?view=activity`} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Clear</Link>
              <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Apply filters</button>
            </div>
          </form>

          {!activity.available ? (
            <Panel title="Activity history"><Empty>{NOT_TRACKED}.</Empty></Panel>
          ) : (
            <>
              <Panel title="Sessions" subtitle={`Derived from page views: a new session starts after 30 minutes without a page view. Within the filtered results.`}>
                {(() => {
                  const sessions = deriveSessions(activity.rows).slice(0, 25);
                  return sessions.length === 0 ? (
                    <Empty>No page views match these filters.</Empty>
                  ) : (
                    <Table head={["User", "Started", "Duration", "Page views", "Pages"]}>
                      {sessions.map((s) => (
                        <tr key={`${s.userId}-${s.start}`} className="hover:bg-gray-800/30">
                          <td className="px-5 py-3 text-white">{who(s.userId)}</td>
                          <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtTime(s.start)}</td>
                          <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{Math.max(1, Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60_000))} min</td>
                          <td className="px-5 py-3 text-gray-300">{s.pageViews}</td>
                          <td className="px-5 py-3 text-gray-400">{s.pages.map(pageLabel).join(", ")}</td>
                        </tr>
                      ))}
                    </Table>
                  );
                })()}
              </Panel>
              <Panel title="Activity history" subtitle={`Newest first, up to 200 events. Kept for ${RETENTION_DAYS} days.`}>
                {activity.rows.length === 0 ? (
                  <Empty>No activity matches these filters.</Empty>
                ) : (
                  <Table head={["Time (PT)", "User", "Event", "Detail"]}>
                    {activity.rows.map((r, i) => (
                      <tr key={`${r.occurred_at}-${i}`} className="hover:bg-gray-800/30">
                        <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtTime(r.occurred_at)}</td>
                        <td className="px-5 py-3 text-white">{who(r.user_id)}</td>
                        <td className="px-5 py-3">
                          {r.event_type === "page_view" && <Badge className="bg-gray-800 text-gray-300">Page view</Badge>}
                          {r.event_type === "admin_event" && <Badge className="bg-blue-900/50 text-blue-300">Admin</Badge>}
                          {r.event_type === "security_event" && <Badge className="bg-red-900/50 text-red-300">Security</Badge>}
                        </td>
                        <td className="px-5 py-3 text-gray-300">{r.page ? pageLabel(r.page) : ACTION_LABELS[r.action ?? ""] ?? r.action}</td>
                      </tr>
                    ))}
                  </Table>
                )}
              </Panel>
            </>
          )}
        </>
      )}

      {view === "analytics" && (
        !t ? (
          <Panel title="Usage analytics"><Empty>{NOT_TRACKED}.</Empty></Panel>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <TrendChart data={dailyActiveUsers(data.recent, 14, now)} label="Daily active users — last 14 days (PT)" color="#f59e0b" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
                <KPICard label="Weekly active users" value={activeUserCount(data.presence, data.recent, week)} />
                <KPICard label="Page views (7 days)" value={countEvents(data.recent, "page_view", week)} />
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Panel title="Most visited pages" subtitle="Last 30 days">
                {(() => {
                  const pages = topPages(data.recent);
                  const max = Math.max(1, ...pages.map((p) => p.views));
                  return pages.length === 0 ? (
                    <Empty>No page views recorded yet.</Empty>
                  ) : (
                    <ul className="px-5 py-4 space-y-3">
                      {pages.map((p) => (
                        <li key={p.page}>
                          <div className="flex justify-between text-sm"><span className="text-gray-300">{pageLabel(p.page)}</span><span className="text-gray-400">{p.views} views · {p.users} users</span></div>
                          <div className="mt-1 h-1.5 rounded-full bg-gray-800"><div className="h-1.5 rounded-full bg-amber-500" style={{ width: `${(p.views / max) * 100}%` }} /></div>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </Panel>
              <Panel title="Administrative activity" subtitle="Last 30 days">
                {(() => {
                  const counts = new Map<string, number>();
                  for (const e of data.recent) if (e.event_type !== "page_view" && e.action) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
                  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
                  return rows.length === 0 ? (
                    <Empty>No administrative events recorded yet.</Empty>
                  ) : (
                    <ul className="divide-y divide-gray-800 text-sm">
                      {rows.map(([a, n]) => (
                        <li key={a} className="px-5 py-3 flex justify-between gap-4"><span className="text-gray-300">{ACTION_LABELS[a] ?? a}</span><span className="text-gray-400">{n}</span></li>
                      ))}
                    </ul>
                  );
                })()}
              </Panel>
            </div>
          </>
        )
      )}
    </div>
  );
}
