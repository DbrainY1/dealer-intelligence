import type { DepartureReport } from "@/lib/estimated-departures";

/**
 * Estimated Departures for dealer-supplied feeds.
 *
 * Deliberately presented apart from verified sales. These dealers produce no
 * canonical `sold` event by design, so nothing here is a sale and nothing here
 * feeds monthly_sales — the wording and the styling both keep that separation
 * visible rather than relying on a footnote.
 */

function fmtRange(start: string, end: string) {
  const m = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  return `${m(start)}–${m(end)}`;
}

export default function EstimatedDeparturesPanel({
  report,
  dealerNames,
  groupLabel,
}: {
  report: DepartureReport;
  dealerNames: Record<number, string>;
  groupLabel: string;
}) {
  const { perDealer, totals, windowStart, windowEnd, confirmationDays } = report;
  if (perDealer.length === 0) return null;

  const range = fmtRange(windowStart, windowEnd);
  const anyUndated = totals.confirmedUndated > 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-white font-semibold">
          Estimated Departures{" "}
          <span className="text-gray-500 font-normal text-sm">({range})</span>
        </h2>
        <span className="text-[11px] uppercase tracking-widest font-mono text-amber-300/80 border border-amber-700/50 rounded px-2 py-0.5">
          Estimate · not verified sales
        </span>
      </div>

      <p className="text-xs text-gray-400">
        {groupLabel} dealers publish their own inventory, so a VIN leaving the feed is not proof of
        a retail sale. DBRAIN issues no canonical sold event for them and this figure does not
        affect <span className="font-mono">monthly_sales</span>. Transfers between feed dealers and
        relists are excluded. A departure is counted only after{" "}
        {confirmationDays * 24} hours of absence backed by {confirmationDays} actual capture days.
      </p>

      {/* Feed failure — the feed produced nothing on the most recent expected day */}
      {report.feedFailures.length > 0 && (
        <div
          role="alert"
          className="bg-red-950 border border-red-700 text-red-200 rounded-lg px-3 py-2 text-xs"
        >
          <span className="font-semibold">Feed failure — no inventory received today</span> for{" "}
          {report.feedFailures.map((id) => dealerNames[id] ?? `Dealer ${id}`).join(", ")}. Today is
          excluded from the evidence window; no departure is inferred from a missing capture.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-300">
          <thead className="text-xs text-gray-400 uppercase bg-gray-800">
            <tr>
              <th className="px-3 py-2">Dealer</th>
              <th className="px-3 py-2 text-right">Estimated departures</th>
              <th className="px-3 py-2 text-right">Dated</th>
              <th className="px-3 py-2 text-right">Date unknown</th>
              <th className="px-3 py-2 text-right">Pending &lt;{confirmationDays * 24}h</th>
              <th className="px-3 py-2 text-right">Transfers excl.</th>
              <th className="px-3 py-2 text-right">Relists excl.</th>
              <th className="px-3 py-2 text-right">Feed days</th>
            </tr>
          </thead>
          <tbody>
            {perDealer.map((d) => (
              <tr key={d.dealerId} className="border-b border-gray-800">
                <td className="px-3 py-2 text-white">{dealerNames[d.dealerId] ?? `Dealer ${d.dealerId}`}</td>
                <td className="px-3 py-2 text-right font-semibold text-amber-300">
                  {d.estimatedDepartures}
                </td>
                <td className="px-3 py-2 text-right">{d.confirmedDated}</td>
                <td className="px-3 py-2 text-right">
                  {d.confirmedUndated > 0 ? (
                    <span className="text-amber-400">{d.confirmedUndated}</span>
                  ) : (
                    0
                  )}
                </td>
                <td className="px-3 py-2 text-right text-gray-500">{d.pendingConfirmation}</td>
                <td className="px-3 py-2 text-right text-gray-500">{d.excludedTransfer}</td>
                <td className="px-3 py-2 text-right text-gray-500">{d.excludedRelist}</td>
                <td className="px-3 py-2 text-right">
                  <span className={d.coverage.complete ? "text-gray-400" : "text-amber-400"}>
                    {d.coverage.presentDays}/{d.coverage.expectedDays}
                  </span>
                </td>
              </tr>
            ))}
            <tr className="bg-gray-800/60 font-semibold">
              <td className="px-3 py-2 text-white">Total</td>
              <td className="px-3 py-2 text-right text-amber-300">{totals.estimatedDepartures}</td>
              <td className="px-3 py-2 text-right">{totals.confirmedDated}</td>
              <td className="px-3 py-2 text-right">{totals.confirmedUndated}</td>
              <td className="px-3 py-2 text-right text-gray-400">{totals.pendingConfirmation}</td>
              <td className="px-3 py-2 text-right text-gray-400">{totals.excludedTransfer}</td>
              <td className="px-3 py-2 text-right text-gray-400">{totals.excludedRelist}</td>
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Coverage disclosure — always shown when any day is missing */}
      {!report.coverageComplete && (
        <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-2 space-y-1">
          <p className="text-xs text-amber-200 font-semibold">
            Incomplete capture coverage — this estimate is a lower bound
          </p>
          <ul className="text-[11px] text-amber-200/80 space-y-0.5">
            {perDealer
              .filter((d) => !d.coverage.complete)
              .map((d) => (
                <li key={d.dealerId}>
                  {dealerNames[d.dealerId] ?? `Dealer ${d.dealerId}`}:{" "}
                  {d.coverage.presentDays} of {d.coverage.expectedDays} days captured
                  {d.coverage.gaps.length > 0 && (
                    <>
                      {" "}
                      · gap
                      {d.coverage.gaps.length > 1 ? "s" : ""}{" "}
                      {d.coverage.gaps
                        .map((g) => (g.days === 1 ? g.start : `${g.start} → ${g.end} (${g.days}d)`))
                        .join(", ")}
                    </>
                  )}
                </li>
              ))}
          </ul>
          <p className="text-[11px] text-amber-200/70">
            A vehicle that both arrived and departed entirely inside a gap left no trace in any
            snapshot and cannot be counted or bounded.
            {anyUndated && (
              <>
                {" "}
                {totals.confirmedUndated} departure
                {totals.confirmedUndated === 1 ? " is" : "s are"} confirmed by sustained
                post-gap absence but cannot be dated, so no departure date is asserted for{" "}
                {totals.confirmedUndated === 1 ? "it" : "them"}.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
