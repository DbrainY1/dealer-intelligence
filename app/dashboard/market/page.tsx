import { createServerSupabase } from "@/lib/supabase-server";
import RoleGuard from "@/components/RoleGuard";

export const dynamic = "force-dynamic";

export default async function TheMarketPage() {
  const supabase = await createServerSupabase();

  const { data: marketSignals = [], error: marketSignalsError } = await supabase
    .from("market_signals")
    .select("*")
    .eq("is_active", true)
    .order("detected_at", { ascending: false })
    .limit(12);

  const formatSignalTime = (value: string) =>
    new Date(value).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Los_Angeles",
    });

  const severityWeight: Record<string, number> = {
    Critical: 4,
    Alert: 3,
    Active: 2,
    Watch: 1,
  };

  const sortedSignals = [...(marketSignals ?? [])].sort(
    (a, b) =>
      (severityWeight[b.severity] ?? 0) - (severityWeight[a.severity] ?? 0)
  );


  const { count: activeDealerCount } = await supabase
    .from("dealers")
    .select("*", { count: "exact", head: true });

  const { count: flaggedDealerCount } = await supabase
    .from("market_signals")
    .select("*", { count: "exact", head: true })
    .in("severity", ["Alert", "Critical"])
    .eq("is_active", true);

  const { data: trackedDealers = [] } = await supabase
    .from("dealers")
    .select("id, name")
    .order("name");

  const signalPills =
    sortedSignals.length > 0
      ? sortedSignals.slice(0, 6).map((signal) => ({
          label: signal.title,
          direction:
            signal.signal_class === "CONTRACTION" ||
            signal.signal_class === "PRESSURE"
              ? "↓"
              : signal.signal_class === "DISTORTION"
              ? "!"
              : "↑",
        }))
      : [
          { label: "Market Active", direction: "↑" },
          { label: "Sell-Through Accelerating", direction: "↑" },
          { label: "SUV Inventory Rising", direction: "↑" },
          { label: "Luxury Under Pressure", direction: "↓" },
          { label: "Price Cuts Increasing", direction: "↑" },
          { label: "Transfer Activity Moderate", direction: "→" },
        ];

  const feedSignals =
    sortedSignals.length > 0
      ? sortedSignals.slice(0, 5)
      : [];

  return (
    <RoleGuard roles={['developer', 'dealer_principal', 'viewer']}>
      <div className="min-h-screen bg-gray-950 text-white px-6 py-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.25em] text-blue-400 font-semibold">
          DealerIQ Intelligence
        </p>
        <h1 className="text-3xl font-bold mt-2">The Market</h1>
        <p className="text-gray-400 mt-2">
          Real-time visibility into inventory movement, dealer behavior, and market velocity.
        </p>
      </div>

      <section className="rounded-2xl border border-gray-800 bg-gray-900/90 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-gray-500 font-semibold">
              Market Intelligence Brief
            </p>
            <h2 className="text-2xl font-bold mt-2">Las Vegas Region</h2>
            <p className="text-sm text-gray-500 mt-1">Daily Market Interpretation • Last updated 7:12 AM PST</p>
          </div>

          <a
            href="/dashboard/market/archive"
            className="text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 rounded-lg px-3 py-2"
          >
            View Archive
          </a>
        </div>

        <div className="max-w-5xl text-gray-300 leading-7 space-y-4">
          <p>
            Las Vegas independent inventory remains active but uneven, with several operators adding units while others appear to be drawing down aging stock. The surface numbers suggest a healthy market, but the movement underneath is beginning to separate stronger operators from slower ones.
          </p>

          <p>
            Acquisition activity is most visible among dealers expanding SUV and truck inventory, while older luxury units continue to show signs of pricing pressure. The market does not yet point to broad weakness, but it does suggest dealers are becoming more selective about what they carry and how quickly they reposition slow-moving vehicles.
          </p>

          <p>
            The key signal to watch is not total inventory alone, but flow: which dealers are adding, which units are moving into confirmation windows, and where price adjustments are clustering. That pattern will determine whether current activity reflects real retail demand or simply temporary inventory rotation.
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900/80 px-5 py-4 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          {signalPills.map(({ label, direction }) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-full border border-gray-700 bg-gray-950/70 px-4 py-2"
            >
              <span className="text-xs uppercase tracking-widest text-gray-400">{label}</span>
              <span className="text-sm font-bold text-blue-300">{direction}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-6">
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Live Market
            </p>
            <h2 className="text-xl font-bold mt-2">Daily Signals</h2>
          </div>
          <p className="text-sm text-gray-500">Intraday & daily operational activity</p>
        </div>

        <div className="divide-y divide-gray-800">
          {feedSignals.length > 0 ? feedSignals.map((signal) => (
            <div key={signal.id} className="flex items-start justify-between gap-4 py-4">
              <div className="flex items-start gap-4">
                <span className="text-xs text-gray-500 font-mono mt-1 w-16">
                  {formatSignalTime(signal.detected_at)}
                </span>
                <p className="text-gray-300">{signal.interpretation}</p>
              </div>
              <span className="text-xs rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 px-3 py-1 whitespace-nowrap">
                {signal.signal_class} • {signal.severity}
              </span>
            </div>
          )) : [
            ["07:14 AM", "Queen Motorcars added 6 late-model SUVs", "Expansion"],
            ["06:51 AM", "Ariana Motors reduced pricing on 11 luxury units", "Pricing Pressure"],
            ["06:22 AM", "Baja East confirmed 4 inventory exits", "Flow"],
            ["05:58 AM", "Boktors inventory expanded 12 units overnight", "Acquisition"],
            ["05:41 AM", "RevEuro movement slowed below weekly average", "Slowing"],
          ].map(([time, event, tag]) => (
            <div key={event} className="flex items-start justify-between gap-4 py-4">
              <div className="flex items-start gap-4">
                <span className="text-xs text-gray-500 font-mono mt-1 w-16">{time}</span>
                <p className="text-gray-300">{event}</p>
              </div>
              <span className="text-xs rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 px-3 py-1 whitespace-nowrap">
                {tag}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-6">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Market Structure
            </p>
            <h2 className="text-xl font-bold mt-2">Weekly Segment Pressure</h2>
          </div>

          <p className="text-sm text-gray-500">
            Weekly behavioral intelligence
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[
            ["Luxury Sedans", "High", "Price cuts clustering"],
            ["Trucks", "Tight", "Fast inventory rotation"],
            ["Economy Cars", "Stable", "Balanced movement"],
            ["Older EVs", "Weak", "Longer aging cycles"],
            ["SUVs", "Active", "Acquisition pressure rising"],
          ].map(([segment, pressure, note]) => (
            <div
              key={segment}
              className="rounded-xl border border-gray-800 bg-gray-950/60 p-4"
            >
              <p className="text-xs uppercase tracking-widest text-gray-500">
                Segment
              </p>

              <h3 className="text-lg font-bold mt-2 text-white">
                {segment}
              </h3>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-gray-400">Pressure</span>

                <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
                  {pressure}
                </span>
              </div>

              <p className="mt-4 text-sm text-gray-500 leading-relaxed">
                {note}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-6">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Market Structure
            </p>

            <h2 className="text-xl font-bold mt-2">
              Weekly Market Movers
            </h2>
          </div>

          <p className="text-sm text-gray-500">
            Highest behavioral shifts across the current weekly cycle
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            ["Boktors", "High", "Inventory expanding rapidly"],
            ["Ariana", "Moderate", "Balanced flow activity"],
            ["Queen", "Aggressive", "Rapid repositioning"],
            ["RevEuro", "Slow", "Below-market movement"],
            ["Baja East", "Healthy", "Stable retail flow"],
          ].map(([dealer, level, note]) => (
            <div
              key={dealer}
              className="rounded-xl border border-gray-800 bg-gray-950/60 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-white">{dealer}</p>

                <div
                  className={`h-3 w-3 rounded-full ${
                    level === "Aggressive"
                      ? "bg-red-400"
                      : level === "High"
                      ? "bg-orange-400"
                      : level === "Healthy"
                      ? "bg-green-400"
                      : level === "Moderate"
                      ? "bg-blue-400"
                      : "bg-gray-500"
                  }`}
                />
              </div>

              <p className="mt-4 text-sm text-blue-300">
                {level}
              </p>

              <p className="mt-3 text-sm text-gray-500 leading-relaxed">
                {note}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-blue-500/40 bg-gray-900 p-5">
          <p className="text-xs uppercase tracking-widest text-gray-400">The Floor</p>

          <div className="flex items-end justify-between mt-3">
            <h2 className="text-3xl font-bold">2,941</h2>
            <span className="text-sm text-blue-300">+4.2%</span>
          </div>

          <p className="text-lg text-white mt-2 font-medium">
            Active Market Units
          </p>

          <p className="text-gray-500 mt-3 text-sm">
            Inventory currently visible across tracked operators
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/40 bg-gray-900 p-5">
          <p className="text-xs uppercase tracking-widest text-gray-400">The Flow</p>

          <div className="flex items-end justify-between mt-3">
            <h2 className="text-3xl font-bold">418</h2>
            <span className="text-sm text-emerald-300">Live</span>
          </div>

          <p className="text-lg text-white mt-2 font-medium">
            Vehicles In Motion
          </p>

          <p className="text-gray-500 mt-3 text-sm">
            Pending exits, transfers, relists, and confirmation windows
          </p>
        </div>

        <div className="rounded-xl border border-purple-500/40 bg-gray-900 p-5">
          <p className="text-xs uppercase tracking-widest text-gray-400">The Players</p>

          <div className="flex items-end justify-between mt-3">
            <h2 className="text-3xl font-bold">{activeDealerCount ?? 0}</h2>
            <span className="text-sm text-purple-300">{flaggedDealerCount ?? 0} flagged</span>
          </div>

          <p className="text-lg text-white mt-2 font-medium">
            Active Market Operators
          </p>

          <p className="text-gray-500 mt-3 text-sm">
            Dealers showing measurable behavioral movement this cycle
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-6">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Market Flow Matrix
            </p>
            <h2 className="text-xl font-bold mt-2">Competitive Positioning</h2>
          </div>
          <p className="text-sm text-gray-500">
            Inventory growth vs sell-through velocity
          </p>
        </div>

        <div className="relative h-[420px] rounded-xl border border-gray-800 bg-gray-950 overflow-hidden">
          <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            <div className="border-r border-b border-gray-800" />
            <div className="border-b border-gray-800" />
            <div className="border-r border-gray-800" />
            <div />
          </div>

          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-xs uppercase tracking-widest text-gray-500">
            Higher Velocity
          </div>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs uppercase tracking-widest text-gray-500">
            Inventory Contraction ← → Inventory Expansion
          </div>

          {[
            ["Boktors", "Expanding + Fast", "top-[18%] right-[14%]", "emerald"],
            ["Ariana", "Balanced Operator", "top-[32%] right-[36%]", "blue"],
            ["Queen", "Rapid Repositioning", "top-[22%] left-[18%]", "yellow"],
            ["RevEuro", "Weakening Flow", "bottom-[22%] left-[18%]", "red"],
            ["Baja East", "Stable Retail Pace", "bottom-[28%] right-[24%]", "cyan"],
          ].map(([dealer, note, pos, color]) => (
            <div
              key={dealer}
              className={`absolute ${pos} rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 shadow-lg`}
            >
              <div className="font-semibold text-white">{dealer}</div>
              <div className="text-xs text-gray-400 mt-1">{note}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Dealer Positioning
            </p>
            <h2 className="text-xl font-bold mt-2">Operator Posture</h2>
          </div>
          <p className="text-sm text-gray-500">Prototype view • signal logic pending</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 uppercase tracking-wider text-xs">
                <th className="text-left py-3">Dealer</th>
                <th className="text-left py-3">Status</th>
                <th className="text-right py-3">Units</th>
                <th className="text-right py-3">Trend</th>
                <th className="text-right py-3">In Motion</th>
                <th className="text-right py-3">Confirmed</th>
                <th className="text-right py-3">Velocity</th>
                <th className="text-right py-3">Pressure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {[
                ["Boktors", "Expanding", "163", "↗", "38", "47", "Strong", "Rising"],
                ["Ariana Motors", "Active", "162", "→", "31", "47", "Stable", "Moderate"],
                ["Queen Motorcars", "Repositioning", "30", "↘", "14", "27", "Fast", "Elevated"],
                ["RevEuro", "Slowing", "68", "→", "5", "5", "Weak", "Low"],
                ["Baja East", "Stable", "68", "→", "12", "20", "Healthy", "Moderate"],
              ].map(([dealer, status, units, trend, motion, confirmed, velocity, pressure]) => (
                <tr key={dealer} className="text-gray-300">
                  <td className="py-4 font-semibold text-white">{dealer}</td>
                  <td className="py-4">{status}</td>
                  <td className="py-4 text-right">{units}</td>
                  <td className="py-4 text-right text-lg">{trend}</td>
                  <td className="py-4 text-right">{motion}</td>
                  <td className="py-4 text-right">{confirmed}</td>
                  <td className="py-4 text-right">{velocity}</td>
                  <td className="py-4 text-right">{pressure}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 mt-6">
        <div className="flex items-end justify-between mb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500 font-semibold">
              Dealer Directory
            </p>
            <h2 className="text-xl font-bold mt-2">All Tracked Dealers</h2>
          </div>
          <p className="text-sm text-gray-500">
            Full operator universe • click into dealer profiles
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(trackedDealers ?? []).map((dealer) => (
            <a
              key={dealer.id}
              href={`/dashboard/dealer/${dealer.id}`}
              className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 hover:border-blue-500/40 transition-colors"
            >
              <div className="text-white font-medium">{dealer.name}</div>
              <div className="text-xs text-gray-500 mt-1">
                Dealer Intelligence Profile
              </div>
            </a>
          ))}
        </div>
      </section>

      </div>
    </RoleGuard>
  );
}
