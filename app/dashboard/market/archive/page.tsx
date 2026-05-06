const briefs = [
  {
    date: "May 5, 2026",
    region: "Las Vegas Region",
    title: "Inventory activity remains uneven as flow becomes the key signal",
    summary:
      "Las Vegas independent inventory remains active but uneven, with several operators adding units while others appear to be drawing down aging stock. The key signal is not total inventory alone, but flow: which dealers are adding, which units are moving into confirmation windows, and where price adjustments are clustering.",
    signals: ["Inventory active", "Flow uneven", "SUV/truck activity", "Luxury pressure"],
  },
];

export default function MarketBriefArchivePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white px-6 py-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.25em] text-blue-400 font-semibold">
          DealerIQ Intelligence
        </p>
        <h1 className="text-3xl font-bold mt-2">Market Brief Archive</h1>
        <p className="text-gray-400 mt-2">
          A running market record for weekly reports, monthly summaries, and long-term narrative analysis.
        </p>
      </div>

      <div className="space-y-4">
        {briefs.map((brief) => (
          <article
            key={brief.date}
            className="rounded-2xl border border-gray-800 bg-gray-900 p-6"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">
                  {brief.region}
                </p>
                <h2 className="text-xl font-bold mt-2">{brief.title}</h2>
              </div>
              <p className="text-sm text-gray-500 whitespace-nowrap">{brief.date}</p>
            </div>

            <p className="text-gray-300 leading-7 max-w-5xl">{brief.summary}</p>

            <div className="flex flex-wrap gap-2 mt-4">
              {brief.signals.map((signal) => (
                <span
                  key={signal}
                  className="text-xs rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 px-3 py-1"
                >
                  {signal}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
