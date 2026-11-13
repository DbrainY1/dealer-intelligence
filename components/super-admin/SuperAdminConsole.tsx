// Owner-only Super Admin console — presentation only. All data arrives via
// props from app/super-admin/page.tsx, which has already verified ownership.
//
// Interactive elements are plain links (keyboard-focusable anchors with a
// visible focus ring); static figures are never styled as links. Drill-down
// URLs come from lib/super-admin-nav.ts.

import Link from "next/link";
import KPICard from "@/components/KPICard";
import TrendChart from "@/components/TrendChart";
import { ACTION_LABELS, PAGE_LABELS } from "@/lib/activity";
import {
  ACTIVE_NOW_MINUTES,
  ACTIVITY_FILTERS,
  RETENTION_DAYS,
  USERS_FILTERS,
  USERS_FILTER_LABELS,
  countEvents,
  dailyActiveUsers,
  deriveSessions,
  filterDirectory,
  isActiveNow,
  isMissingRole,
  isPendingInvite,
  summarizeUser,
  topPages,
  type AccountStatus,
  type ActivityFilters,
  type ActivityRow,
  type ConsoleData,
  type DirectoryEntry,
  type UsersFilter,
} from "@/lib/super-admin";
import {
  activityHref,
  analyticsHref,
  overviewHref,
  securityEventsHref,
  userHref,
  usersHref,
  type ConsoleRoute,
} from "@/lib/super-admin-nav";

interface Props {
  data: ConsoleData;
  route: ConsoleRoute;
  filters: ActivityFilters;
  // Activity view: the filtered history. User view: that user's history.
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

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900";

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

const EVENT_LABEL: Record<ActivityRow["event_type"], string> = {
  page_view: "Page views",
  admin_event: "Admin events",
  security_event: "Security events",
};

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap border border-transparent ${className}`}>{children}</span>;
}

function RoleBadge({ role }: { role: string | null }) {
  return role && ROLE_LABEL[role] ? <Badge className={ROLE_STYLE[role]}>{ROLE_LABEL[role]}</Badge> : <Badge className="bg-red-900/40 text-red-300">No role</Badge>;
}

function EventBadge({ type }: { type: ActivityRow["event_type"] }) {
  if (type === "admin_event") return <Badge className="bg-blue-900/50 text-blue-300">Admin</Badge>;
  if (type === "security_event") return <Badge className="bg-red-900/50 text-red-300">Security</Badge>;
  return <Badge className="bg-gray-800 text-gray-300">Page view</Badge>;
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-white font-semibold text-base">{title}</h2>
          {subtitle && <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-gray-500 text-sm space-y-2">{children}</div>;
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

function TextLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`text-amber-300 hover:text-amber-200 underline-offset-2 hover:underline rounded ${FOCUS} ${className}`}>
      {children}
    </Link>
  );
}

// A user's name, linking to their detail page. Accounts not in the directory
// (e.g. deleted since the event) are shown as plain text.
function UserCell({ entry, base, fallback = "Account not listed" }: { entry: DirectoryEntry | undefined; base: string; fallback?: string }) {
  if (!entry) return <span className="text-gray-500">{fallback}</span>;
  return (
    <Link href={userHref(base, entry.id)} className={`group block rounded ${FOCUS}`}>
      <span className="text-white font-medium group-hover:text-amber-300 group-hover:underline underline-offset-2">{displayName(entry)}</span>
      {entry.isOwner && <Badge className="ml-1.5 bg-amber-900/50 text-amber-300">Owner</Badge>}
      <span className="block text-gray-500 text-xs">{entry.email}</span>
    </Link>
  );
}

const NOT_TRACKED = "Not tracked yet";

export default function SuperAdminConsole({ data, route, filters, activity, basePath = "/super-admin" }: Props) {
  const { view } = route;
  const now = new Date(data.now);
  const t = data.trackingAvailable;
  const byId = new Map(data.directory.map((e) => [e.id, e]));
  const ctx = { presence: data.presence, events: data.recent, now };
  const count = (f: UsersFilter) => filterDirectory(data.directory, f, ctx).length;
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const securityEvents7d = countEvents(data.recent, "security_event", week);
  const missingRoles = data.directory.filter(isMissingRole).length;
  const pendingInvites = data.directory.filter(isPendingInvite).length;

  const tab = (v: "overview" | "activity" | "users" | "analytics", label: string, href: string) => {
    const current = view === v || (v === "users" && view === "user");
    return (
      <Link
        key={v}
        href={href}
        aria-current={current ? "page" : undefined}
        className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${FOCUS} ${
          current ? "bg-gray-800 text-white font-semibold" : "text-gray-400 hover:text-white hover:bg-gray-800/60"
        }`}
      >
        {label}
      </Link>
    );
  };

  // Alerts link only when there is something to show and the data exists.
  const alert = (label: string, value: number | string, tone: string, href: string | null) => {
    const actionable = href !== null && typeof value === "number" && value > 0;
    const inner = (
      <>
        <span className="text-gray-300">{label}</span>
        <span className="flex items-center gap-3">
          <span className={typeof value === "number" && value > 0 ? `${tone} font-semibold` : "text-gray-500"}>{value}</span>
          {actionable && <span aria-hidden="true" className="text-xs text-gray-500 group-hover:text-amber-300">View →</span>}
        </span>
      </>
    );
    return (
      <li key={label}>
        {actionable ? (
          <Link href={href!} className={`group px-5 py-3 flex justify-between gap-4 hover:bg-gray-800/50 ${FOCUS}`}>{inner}</Link>
        ) : (
          <div className="px-5 py-3 flex justify-between gap-4">{inner}</div>
        )}
      </li>
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1600px]">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">Owner only</p>
          <h1 className="text-white text-2xl font-bold tracking-tight mt-1">Super Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Platform oversight · as of {fmtTime(data.now)} PT</p>
        </div>
        <nav aria-label="Super Admin sections" className="flex gap-1 overflow-x-auto p-1 -m-1">
          {tab("overview", "Overview", overviewHref(basePath))}
          {tab("activity", "Activity", activityHref(basePath))}
          {tab("users", "Users & access", usersHref(basePath))}
          {tab("analytics", "Usage analytics", analyticsHref(basePath))}
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
          <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3">
            <KPICard label="DealerIQ users" value={count("all")} href={usersHref(basePath)} />
            {t ? (
              <>
                <KPICard label={`Active now (${ACTIVE_NOW_MINUTES} min)`} value={count("active_now")} href={usersHref(basePath, "active_now")} />
                <KPICard label="Active today (PT)" value={count("active_today")} href={usersHref(basePath, "active_today")} />
                <KPICard label="Active last 7 days" value={count("active_7d")} href={usersHref(basePath, "active_7d")} />
              </>
            ) : (
              <>
                <KPICard label={`Active now (${ACTIVE_NOW_MINUTES} min)`} value={NOT_TRACKED} />
                <KPICard label="Active today (PT)" value={NOT_TRACKED} />
                <KPICard label="Active last 7 days" value={NOT_TRACKED} />
              </>
            )}
            <KPICard label="Developers" value={count("developer")} href={usersHref(basePath, "developer")} />
            <KPICard label="Dealer Principals" value={count("dealer_principal")} href={usersHref(basePath, "dealer_principal")} />
            <KPICard label="Viewers" value={count("viewer")} href={usersHref(basePath, "viewer")} />
            <KPICard label="Pending invitations" value={pendingInvites} href={usersHref(basePath, "pending_invite")} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            <Panel title="Alerts" subtitle="Onboarding problems and security events">
              <ul className="divide-y divide-gray-800 text-sm">
                {alert("Accounts without a DealerIQ role", missingRoles, "text-red-300", usersHref(basePath, "missing_role"))}
                {alert("Invitations not yet accepted", pendingInvites, "text-amber-300", usersHref(basePath, "pending_invite"))}
                {alert("Denied Super Admin attempts (7 days)", t ? securityEvents7d : NOT_TRACKED, "text-red-300", t ? securityEventsHref(basePath) : null)}
              </ul>
            </Panel>

            <div className="xl:col-span-2">
              <Panel
                title="Currently active"
                subtitle={`Seen in the last 24 hours. Inferred from the last recorded page view or heartbeat — "Online" means seen in the last ${ACTIVE_NOW_MINUTES} minutes, not a guaranteed live session.`}
                action={t ? <TextLink href={usersHref(basePath, "active_today")} className="text-xs whitespace-nowrap">All active today →</TextLink> : undefined}
              >
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
                          <td className="px-5 py-3"><UserCell entry={e} base={basePath} /></td>
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
            </div>
          </div>
        </>
      )}

      {view === "users" && (() => {
        const f = route.usersFilter;
        const needsTracking = ACTIVITY_FILTERS.includes(f) && !t;
        const rows = needsTracking ? [] : filterDirectory(data.directory, f, ctx);
        const showInvite = f === "pending_invite";
        return (
          <>
            <nav aria-label="User filters" className="flex flex-wrap gap-2">
              {USERS_FILTERS.map((k) => {
                const disabled = ACTIVITY_FILTERS.includes(k) && !t;
                const selected = k === f;
                const label = `${USERS_FILTER_LABELS[k]}${disabled ? "" : ` (${count(k)})`}`;
                return disabled ? (
                  <span key={k} className="px-3 py-1.5 rounded-full text-xs border border-gray-800 text-gray-600" title={NOT_TRACKED}>{USERS_FILTER_LABELS[k]} — {NOT_TRACKED.toLowerCase()}</span>
                ) : (
                  <Link
                    key={k}
                    href={usersHref(basePath, k)}
                    aria-current={selected ? "true" : undefined}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${FOCUS} ${
                      selected ? "bg-amber-900/40 border-amber-700 text-amber-200 font-semibold" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>

            <Panel
              title={f === "all" ? "Users & access" : `Users & access — ${USERS_FILTER_LABELS[f]}`}
              subtitle={`${needsTracking ? NOT_TRACKED : `${rows.length} account${rows.length === 1 ? "" : "s"}`}. Accounts connected to DealerIQ; invitations are sent from Settings → Team Access.${data.otherAccounts ? ` ${data.otherAccounts} other account(s) in the shared Supabase project are not shown.` : ""}`}
              action={f !== "all" ? (
                <span className="flex items-center gap-2 text-xs whitespace-nowrap">
                  <Badge className="bg-amber-900/40 text-amber-200 border-amber-800">Filter: {USERS_FILTER_LABELS[f]}</Badge>
                  <TextLink href={usersHref(basePath)}>Clear filter</TextLink>
                </span>
              ) : undefined}
            >
              {needsTracking ? (
                <Empty>{NOT_TRACKED}: this filter needs activity tracking.</Empty>
              ) : rows.length === 0 ? (
                <Empty>
                  <p>No accounts match this filter.</p>
                  {f !== "all" && <p><TextLink href={usersHref(basePath)}>Show all users</TextLink></p>}
                </Empty>
              ) : (
                <Table head={["User", "Role", "Status", showInvite ? "Invited" : "Last sign-in", "Last activity"]}>
                  {rows.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-800/30">
                      <td className="px-5 py-3"><UserCell entry={e} base={basePath} /></td>
                      <td className="px-5 py-3"><RoleBadge role={e.role} /></td>
                      <td className="px-5 py-3"><Badge className={STATUS[e.status].style}>{STATUS[e.status].label}</Badge></td>
                      <td className="px-5 py-3 text-gray-400 whitespace-nowrap">
                        {showInvite ? (
                          <>
                            {fmtTime(e.invitedAt)}
                            {e.invitedRole && <span className="block text-xs text-gray-500">Requested: {ROLE_LABEL[e.invitedRole] ?? e.invitedRole}</span>}
                          </>
                        ) : fmtTime(e.lastSignInAt)}
                      </td>
                      <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{t ? `${fmtAgo(e.lastSeenAt, now)}${e.lastPage ? ` · ${pageLabel(e.lastPage)}` : ""}` : NOT_TRACKED}</td>
                    </tr>
                  ))}
                </Table>
              )}
              <p className="px-5 py-3 border-t border-gray-800 text-xs text-gray-500">
                {showInvite && "Invitation dates come from Supabase Auth; the requested role is what the invitation asked for, and DealerIQ does not record invitation expiry. "}
                Manage invitations in <TextLink href="/dashboard/settings">Settings</TextLink>. Role and owner changes use the approved administrative procedures.
              </p>
            </Panel>
          </>
        );
      })()}

      {view === "user" && (() => {
        const e = route.userId ? byId.get(route.userId) : undefined;
        const back = <TextLink href={usersHref(basePath)} className="text-sm">← Users & access</TextLink>;
        if (!e) {
          return (
            <>
              {back}
              <Panel title="Account not found">
                <Empty>This account is not connected to DealerIQ, or it no longer exists.</Empty>
              </Panel>
            </>
          );
        }
        const s = summarizeUser(e.id, data.recent);
        const sessions = deriveSessions(activity.rows).slice(0, 15);
        const facts: [string, React.ReactNode][] = [
          ["Role", <RoleBadge key="r" role={e.role} />],
          ["Platform Owner", e.isOwner ? <Badge key="o" className="bg-amber-900/50 text-amber-300">Yes</Badge> : "No"],
          ["Status", <Badge key="s" className={STATUS[e.status].style}>{STATUS[e.status].label}</Badge>],
          ["Invited", e.invitedAt ? `${fmtTime(e.invitedAt)}${e.invitedRole ? ` · requested ${ROLE_LABEL[e.invitedRole] ?? e.invitedRole}` : ""}` : "No invitation on record"],
          ["Invitation accepted", e.invitedAt ? (e.confirmedAt ? fmtTime(e.confirmedAt) : "Not yet") : "—"],
          ["Last sign-in", e.lastSignInAt ? fmtTime(e.lastSignInAt) : "Never"],
          ["Last activity", t ? (e.lastSeenAt ? `${fmtAgo(e.lastSeenAt, now)} · ${pageLabel(e.lastPage)}` : "None recorded") : NOT_TRACKED],
        ];
        return (
          <>
            {back}
            <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
              <div>
                <h2 className="text-white text-xl font-bold">{displayName(e)}</h2>
                <p className="text-gray-400 text-sm">{e.email}</p>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {facts.map(([k, v]) => (
                  <div key={k} className="bg-gray-950/60 border border-gray-800 rounded-lg px-4 py-3">
                    <dt className="text-xs uppercase tracking-wider text-gray-500">{k}</dt>
                    <dd className="mt-1 text-sm text-gray-200">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-gray-500">Read-only. Role and owner changes use the approved administrative procedures; there is no editing or deletion here.</p>
            </section>

            {!t || !activity.available ? (
              <Panel title="Activity"><Empty>{NOT_TRACKED}.</Empty></Panel>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KPICard label="Page views (30 days)" value={s.pageViews30d} />
                  <KPICard label="Distinct pages (30 days)" value={s.distinctPages} />
                  <KPICard label="Admin events (30 days)" value={s.adminEvents30d} />
                  <KPICard label="Security events (30 days)" value={s.securityEvents30d} />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
                  <Panel title="Most visited pages" subtitle="Last 30 days">
                    {s.topPages.length === 0 ? (
                      <Empty>No page views recorded.</Empty>
                    ) : (
                      <ul className="divide-y divide-gray-800 text-sm">
                        {s.topPages.map((p) => (
                          <li key={p.page} className="px-5 py-3 flex justify-between gap-4"><span className="text-gray-300">{pageLabel(p.page)}</span><span className="text-gray-400">{p.views}</span></li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                  <div className="xl:col-span-2">
                    <Panel title="Recent sessions" subtitle="Derived from page views: a new session starts after 30 minutes without a page view.">
                      {sessions.length === 0 ? (
                        <Empty>No sessions recorded.</Empty>
                      ) : (
                        <Table head={["Started", "Duration", "Page views", "Pages"]}>
                          {sessions.map((x) => (
                            <tr key={x.start} className="hover:bg-gray-800/30">
                              <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtTime(x.start)}</td>
                              <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{Math.max(1, Math.round((new Date(x.end).getTime() - new Date(x.start).getTime()) / 60_000))} min</td>
                              <td className="px-5 py-3 text-gray-300">{x.pageViews}</td>
                              <td className="px-5 py-3 text-gray-400">{x.pages.map(pageLabel).join(", ")}</td>
                            </tr>
                          ))}
                        </Table>
                      )}
                    </Panel>
                  </div>
                </div>
                <Panel
                  title="Activity timeline"
                  subtitle={`Newest first, up to 200 events. Kept for ${RETENTION_DAYS} days.`}
                  action={<TextLink href={activityHref(basePath, { user: e.id })} className="text-xs whitespace-nowrap">Open in Activity →</TextLink>}
                >
                  {activity.rows.length === 0 ? (
                    <Empty>No activity recorded for this account.</Empty>
                  ) : (
                    <Table head={["Time (PT)", "Event", "Detail"]}>
                      {activity.rows.map((r, i) => (
                        <tr key={`${r.occurred_at}-${i}`} className="hover:bg-gray-800/30">
                          <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtTime(r.occurred_at)}</td>
                          <td className="px-5 py-3"><EventBadge type={r.event_type} /></td>
                          <td className="px-5 py-3 text-gray-300">{r.page ? pageLabel(r.page) : ACTION_LABELS[r.action ?? ""] ?? r.action}</td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Panel>
              </>
            )}
          </>
        );
      })()}

      {view === "activity" && (() => {
        const applied = [
          filters.user && `User: ${byId.get(filters.user) ? displayName(byId.get(filters.user)!) : "account not listed"}`,
          filters.page && `Page: ${pageLabel(filters.page)}`,
          filters.type && `Event: ${EVENT_LABEL[filters.type]}`,
          filters.from && `From ${filters.from}`,
          filters.to && `To ${filters.to}`,
        ].filter(Boolean) as string[];
        return (
          <>
            <form method="get" action={basePath} className="bg-gray-900 border border-gray-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
              <input type="hidden" name="view" value="activity" />
              <label className="text-xs text-gray-400 space-y-1 lg:col-span-2">
                <span className="block uppercase tracking-wider">User</span>
                <select name="user" defaultValue={filters.user ?? ""} className={`w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm ${FOCUS}`}>
                  <option value="">All users</option>
                  {data.directory.map((e) => <option key={e.id} value={e.id}>{displayName(e)}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-400 space-y-1">
                <span className="block uppercase tracking-wider">Page</span>
                <select name="page" defaultValue={filters.page ?? ""} className={`w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm ${FOCUS}`}>
                  <option value="">All pages</option>
                  {Object.entries(PAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="text-xs text-gray-400 space-y-1">
                <span className="block uppercase tracking-wider">Event</span>
                <select name="type" defaultValue={filters.type ?? ""} className={`w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm ${FOCUS}`}>
                  <option value="">All events</option>
                  <option value="page_view">Page views</option>
                  <option value="admin_event">Admin events</option>
                  <option value="security_event">Security events</option>
                </select>
              </label>
              <label className="text-xs text-gray-400 space-y-1">
                <span className="block uppercase tracking-wider">From</span>
                <input type="date" name="from" defaultValue={filters.from ?? ""} className={`w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm ${FOCUS}`} />
              </label>
              <label className="text-xs text-gray-400 space-y-1">
                <span className="block uppercase tracking-wider">To</span>
                <input type="date" name="to" defaultValue={filters.to ?? ""} className={`w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-white text-sm ${FOCUS}`} />
              </label>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-6 items-center justify-between flex-wrap">
                <p className="text-xs text-gray-400">
                  {applied.length > 0 ? <>Showing: <span className="text-amber-200">{applied.join(" · ")}</span></> : "Showing all activity."}
                </p>
                <div className="flex gap-2">
                  <Link href={activityHref(basePath)} className={`px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg ${FOCUS}`}>Clear filters</Link>
                  <button type="submit" className={`px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg ${FOCUS}`}>Apply filters</button>
                </div>
              </div>
            </form>

            {!activity.available ? (
              <Panel title="Activity history"><Empty>{NOT_TRACKED}.</Empty></Panel>
            ) : (
              <div className="grid grid-cols-1 2xl:grid-cols-5 gap-6 items-start">
                <div className="2xl:col-span-2">
                  <Panel title="Sessions" subtitle="Derived from page views: a new session starts after 30 minutes without a page view. Within the filtered results.">
                    {(() => {
                      const sessions = deriveSessions(activity.rows).slice(0, 25);
                      return sessions.length === 0 ? (
                        <Empty>No page views match these filters.</Empty>
                      ) : (
                        <Table head={["User", "Started", "Duration", "Views"]}>
                          {sessions.map((x) => (
                            <tr key={`${x.userId}-${x.start}`} className="hover:bg-gray-800/30">
                              <td className="px-5 py-3"><UserCell entry={byId.get(x.userId)} base={basePath} /></td>
                              <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtTime(x.start)}</td>
                              <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{Math.max(1, Math.round((new Date(x.end).getTime() - new Date(x.start).getTime()) / 60_000))} min</td>
                              <td className="px-5 py-3 text-gray-300">{x.pageViews}</td>
                            </tr>
                          ))}
                        </Table>
                      );
                    })()}
                  </Panel>
                </div>
                <div className="2xl:col-span-3">
                  <Panel title={filters.type === "security_event" ? "Security events" : "Activity history"} subtitle={`Newest first, up to 200 events. Kept for ${RETENTION_DAYS} days.`}>
                    {activity.rows.length === 0 ? (
                      <Empty>No activity matches these filters.</Empty>
                    ) : (
                      <Table head={["Time (PT)", "User", "Event", "Detail"]}>
                        {activity.rows.map((r, i) => (
                          <tr key={`${r.occurred_at}-${i}`} className="hover:bg-gray-800/30">
                            <td className="px-5 py-3 text-gray-400 whitespace-nowrap">{fmtTime(r.occurred_at)}</td>
                            <td className="px-5 py-3"><UserCell entry={byId.get(r.user_id)} base={basePath} /></td>
                            <td className="px-5 py-3"><EventBadge type={r.event_type} /></td>
                            <td className="px-5 py-3 text-gray-300">{r.page ? pageLabel(r.page) : ACTION_LABELS[r.action ?? ""] ?? r.action}</td>
                          </tr>
                        ))}
                      </Table>
                    )}
                  </Panel>
                </div>
              </div>
            )}
          </>
        );
      })()}

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
                <KPICard label="Weekly active users" value={count("active_7d")} href={usersHref(basePath, "active_7d")} />
                <KPICard label="Page views (7 days)" value={countEvents(data.recent, "page_view", week)} href={activityHref(basePath, { type: "page_view" })} />
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
              <Panel title="Administrative activity" subtitle="Last 30 days" action={<TextLink href={activityHref(basePath, { type: "admin_event" })} className="text-xs whitespace-nowrap">View events →</TextLink>}>
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
