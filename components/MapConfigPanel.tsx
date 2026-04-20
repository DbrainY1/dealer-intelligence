"use client";

import { useState } from "react";

interface MapConfigRow {
  id: number;
  layer: string;
  label: string;
  description: string;
  value: number;
  min: number;
  max: number;
  updated_at: string;
}

interface Props {
  config: MapConfigRow[];
}

const LAYER_META: Record<string, { display: string; textColor: string; borderColor: string; accentColor: string }> = {
  inventory_density: { display: "Inventory Density",  textColor: "text-blue-400",    borderColor: "border-blue-800",    accentColor: "#3b82f6" },
  sales_velocity:    { display: "Sales Velocity",     textColor: "text-green-400",   borderColor: "border-green-800",   accentColor: "#10b981" },
  price_positioning: { display: "Price Positioning",  textColor: "text-amber-400",   borderColor: "border-amber-800",   accentColor: "#f59e0b" },
  market_coverage:   { display: "Market Coverage",    textColor: "text-blue-400",    borderColor: "border-blue-800",    accentColor: "#3b82f6" },
  supply_pressure:   { display: "Supply Pressure",    textColor: "text-orange-400",  borderColor: "border-orange-800",  accentColor: "#f97316" },
  new_listings:      { display: "New Listings",       textColor: "text-emerald-400", borderColor: "border-emerald-800", accentColor: "#10b981" },
};

function formatLayerName(layer: string): string {
  return LAYER_META[layer]?.display ?? layer.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isOpacityParam(row: MapConfigRow): boolean {
  return row.label.toLowerCase().includes("opacity") || (row.max <= 1 && row.min >= 0);
}

function LayerCard({ layer, rows }: { layer: string; rows: MapConfigRow[] }) {
  const meta = LAYER_META[layer] ?? { display: layer, textColor: "text-gray-300", borderColor: "border-gray-700", accentColor: "#9ca3af" };
  const [open, setOpen]     = useState(false);
  const [values, setValues] = useState<Record<number, number>>(
    Object.fromEntries(rows.map((r) => [r.id, r.value]))
  );
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  function handleChange(id: number, raw: string) {
    const num = parseFloat(raw);
    if (!isNaN(num)) setValues((prev) => ({ ...prev, [id]: num }));
  }

  async function handleSave() {
    setStatus("saving");
    setErrMsg("");
    try {
      const res = await fetch("/api/map-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: rows.map((r) => ({ id: r.id, value: values[r.id] ?? r.value })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (e: any) {
      setErrMsg(e.message ?? "Unexpected error");
      setStatus("error");
    }
  }

  return (
    <div className={`border rounded-xl overflow-hidden ${meta.borderColor} bg-gray-900`}>
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/40 transition-colors"
      >
        <span className={`text-sm font-semibold ${meta.textColor}`}>{formatLayerName(layer)}</span>
        <span className="text-gray-500 text-xs font-mono">
          {rows.length} param{rows.length !== 1 ? "s" : ""}&nbsp;
          <span className="ml-1">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {/* Body */}
      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-gray-800">
          <div className="space-y-4 pt-4">
            {rows.map((row) => {
              const step = isOpacityParam(row) ? 0.01 : 1;
              return (
                <div key={row.id} className="flex items-start justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{row.label}</p>
                    {row.description && (
                      <p className="text-gray-500 text-xs mt-0.5 leading-relaxed">{row.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right space-y-1">
                    <input
                      type="number"
                      value={values[row.id] ?? row.value}
                      step={step}
                      min={row.min}
                      max={row.max}
                      onChange={(e) => handleChange(row.id, e.target.value)}
                      className="w-28 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm text-right font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                    />
                    <p className="text-gray-600 text-xs font-mono">
                      Range: {row.min} — {row.max}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-xs">
              {status === "ok"    && <span className="text-emerald-400">Changes saved — live on next map load</span>}
              {status === "error" && <span className="text-red-400">{errMsg}</span>}
            </div>
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              {status === "saving" ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MapConfigPanel({ config }: Props) {
  // Group rows by layer, preserving the order from LAYER_META
  const grouped = new Map<string, MapConfigRow[]>();
  for (const row of config) {
    if (!grouped.has(row.layer)) grouped.set(row.layer, []);
    grouped.get(row.layer)!.push(row);
  }

  if (grouped.size === 0) {
    return (
      <p className="text-gray-600 text-sm text-center py-8">
        No map configuration parameters found. Populate the <span className="font-mono">map_config</span> table to begin.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([layer, rows]) => (
        <LayerCard key={layer} layer={layer} rows={rows} />
      ))}
    </div>
  );
}
