"use client";

import { useEffect, useRef, useState } from "react";

export interface DealerMapData {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  dealerGroupId: number | null;
  address: string | null;
  website: string | null;
  inStock: number;
  mtdSold: number;
  avgListPrice: number | null;
  daysOfSupply: number | null;
  newListings7d: number;
}

// Group → label/color, derived from public.dealers.dealer_group_id.
// 1 = Baja Auto Group (blue), 3 = Ariana Auto Group (purple), else Competitor
// (amber). Colors match the previous hardcoded GROUP_COLORS exactly — no pin
// color drift for the DB-visible dealers.
const COMPETITOR_COLOR = "#f59e0b";
function groupInfo(groupId: number | null): { label: string; color: string } {
  if (groupId === 1) return { label: "Baja Auto Group", color: "#3b82f6" };
  if (groupId === 3) return { label: "Ariana Auto Group", color: "#8b5cf6" };
  return { label: "Competitor", color: COMPETITOR_COLOR };
}

// Inline SVG icons — no external dependency
function IcoBox() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
      <path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>
    </svg>
  );
}
function IcoTrend() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22,7 13.5,15.5 8.5,10.5 2,17"/>
      <polyline points="16,7 22,7 22,13"/>
    </svg>
  );
}
function IcoTag() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/>
      <path d="M7 7h.01"/>
    </svg>
  );
}
function IcoTarget() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  );
}
function IcoActivity() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  );
}
function IcoSparkle() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    </svg>
  );
}

const LAYER_CONFIG = [
  { id: "inventory",   label: "Inventory Density", Icon: IcoBox,      color: "#f59e0b" },
  { id: "velocity",    label: "Sales Velocity",    Icon: IcoTrend,    color: "#10b981" },
  { id: "price",       label: "Price Positioning", Icon: IcoTag,      color: "#f59e0b" },
  { id: "coverage",    label: "Market Coverage",   Icon: IcoTarget,   color: "#3b82f6" },
  { id: "supply",      label: "Supply Pressure",   Icon: IcoActivity, color: "#8b5cf6" },
  { id: "newListings", label: "New Listings",      Icon: IcoSparkle,  color: "#10b981" },
] as const;

type LayerId = (typeof LAYER_CONFIG)[number]["id"];

const LAYER_LEGENDS: Record<LayerId, { title: string; items: { color: string; label: string }[] }> = {
  inventory: {
    title: "Inventory Density",
    items: [
      { color: "#3b82f6", label: "Baja Auto Group" },
      { color: "#8b5cf6", label: "Ariana Auto Group" },
      { color: "#f59e0b", label: "Competitors" },
    ],
  },
  velocity: {
    title: "Sales Velocity (MTD)",
    items: [
      { color: "#10b981", label: "Above market average" },
      { color: "#ef4444", label: "Below market average" },
    ],
  },
  price: {
    title: "Price Positioning (PPI)",
    items: [
      { color: "#10b981", label: "Below market  PPI < 95" },
      { color: "#e5e7eb", label: "Market aligned  95–110" },
      { color: "#ef4444", label: "Above market  PPI > 110" },
    ],
  },
  coverage: {
    title: "Market Coverage",
    items: [
      { color: "#3b82f6", label: "Baja stores — 2 / 5 / 10 km" },
    ],
  },
  supply: {
    title: "Supply Pressure (DOS)",
    items: [
      { color: "#3b82f6", label: "< 30 days — lean" },
      { color: "#10b981", label: "30–60 days — healthy" },
      { color: "#f59e0b", label: "61–90 days — heavy" },
      { color: "#ef4444", label: "90+ days — overstocked" },
      { color: "#6b7280", label: "No velocity data" },
    ],
  },
  newListings: {
    title: "New Listings (7 days)",
    items: [
      { color: "#10b981", label: "New inventory added" },
    ],
  },
};

interface Props {
  dealerData: DealerMapData[];
  /** Cutoff-aware wording for the sales-velocity legend title, e.g.
   *  "Sales Velocity (Since Jul 11)". Falls back to the static "(MTD)". */
  velocityTitle?: string;
}

export default function LocationsMap({ dealerData, velocityTitle }: Props) {
  const mapRef          = useRef<HTMLDivElement>(null);
  const mapInstance     = useRef<any>(null);
  const layerGroupsRef  = useRef<Record<string, any>>({});
  const dealerDataRef   = useRef(dealerData);
  const [activeLayers, setActiveLayers] = useState<Set<LayerId>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || mapInstance.current) return;

    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!mapRef.current) return;

      const map = L.map(mapRef.current, { center: [36.13, -115.13], zoom: 12.5, zoomControl: true });
      mapInstance.current = map;

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      // DB-driven markers. Each row carries its own coordinates, group, and
      // metrics — all built per dealer_id in page.tsx — so metrics attach to
      // pins by id (no name join). All rows here already passed the visibility
      // gate and the finite-coordinate filter on the server.
      const data        = dealerDataRef.current;
      const allMtd      = data.filter((d) => d.mtdSold > 0).map((d) => d.mtdSold);
      const mktAvgMtd   = allMtd.length > 0 ? allMtd.reduce((a, b) => a + b, 0) / allMtd.length : 0;
      const allPrices   = data.filter((d) => d.avgListPrice != null).map((d) => d.avgListPrice as number);
      const mktAvgPrice = allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : 0;

      function popupHtml(dealer: DealerMapData, color: string) {
        // Preserve prior behavior: only grouped dealers (Baja/Ariana) show a
        // group label; competitors show none.
        const info      = groupInfo(dealer.dealerGroupId);
        const grouped   = dealer.dealerGroupId === 1 || dealer.dealerGroupId === 3;
        const group     = grouped ? `<div style="color:#9ca3af;font-size:11px;margin-bottom:2px;">${info.label}</div>` : "";
        const address   = dealer.address ? `<div style="color:#d1d5db;font-size:12px;margin-bottom:6px;">${dealer.address}</div>` : "";
        const website   = dealer.website ? `<a href="${dealer.website}" target="_blank" style="color:#60a5fa;font-size:11px;">Visit website →</a>` : "";
        return `<div style="font-family:system-ui,sans-serif;min-width:180px;">
          ${group}
          <div style="color:white;font-weight:700;font-size:14px;margin-bottom:4px;">${dealer.name}</div>
          ${address}
          <div style="display:inline-block;background:${color}22;border:1px solid ${color};color:${color};font-size:10px;padding:1px 6px;border-radius:999px;margin-bottom:6px;">Tracked</div>
          ${website}
        </div>`;
      }

      // ── Base pins ──────────────────────────────────────────────────────────
      data.forEach((dealer) => {
        const color = groupInfo(dealer.dealerGroupId).color;
        const icon  = L.divIcon({
          className: "",
          html: `<div style="background:${color};border:2px solid white;border-radius:50%;width:14px;height:14px;box-shadow:0 0 0 3px ${color}55;"></div>`,
          iconSize: [14, 14], iconAnchor: [7, 7],
        });
        L.marker([dealer.latitude, dealer.longitude], { icon })
          .bindPopup(L.popup({ className: "dealer-popup" }).setContent(popupHtml(dealer, color)))
          .addTo(map);
      });

      // ── Layer 1 · Inventory Density ────────────────────────────────────────
      const inventoryGroup = L.layerGroup();
      data.forEach((dealer) => {
        const stock  = dealer.inStock ?? 0;
        if (stock === 0) return;
        const color  = groupInfo(dealer.dealerGroupId).color;
        L.circle([dealer.latitude, dealer.longitude], {
          radius: stock * 10, color, fillColor: color,
          fillOpacity: 0.12, opacity: 0.3, weight: 1,
        })
          .bindPopup(L.popup({ className: "dealer-popup" }).setContent(popupHtml(dealer, color)))
          .addTo(inventoryGroup);
      });
      layerGroupsRef.current.inventory = inventoryGroup;

      // ── Layer 2 · Sales Velocity ───────────────────────────────────────────
      const velocityGroup = L.layerGroup();
      data.forEach((dealer) => {
        const mtd     = dealer.mtdSold ?? 0;
        const color   = mtd > 0 && mtd >= mktAvgMtd ? "#10b981" : "#ef4444";
        const size    = Math.max(22, Math.min(80, mtd * 4 + 18));
        const icon    = L.divIcon({
          className: "",
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${color};background:${color}18;animation:velocityPulse 2s ease-in-out infinite;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"></div>`,
          iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        });
        L.marker([dealer.latitude, dealer.longitude], { icon, interactive: false, zIndexOffset: -200 }).addTo(velocityGroup);
      });
      layerGroupsRef.current.velocity = velocityGroup;

      // ── Layer 3 · Price Positioning ────────────────────────────────────────
      const priceGroup = L.layerGroup();
      data.forEach((dealer) => {
        const avg   = dealer.avgListPrice;
        let color   = "#6b7280";
        if (avg && mktAvgPrice > 0) {
          const ppi = (avg / mktAvgPrice) * 100;
          color     = ppi < 95 ? "#10b981" : ppi > 110 ? "#ef4444" : "#e5e7eb";
        }
        L.circleMarker([dealer.latitude, dealer.longitude], {
          radius: 7, color: "#1f2937", fillColor: color,
          fillOpacity: 0.95, opacity: 1, weight: 1.5, interactive: false,
        }).addTo(priceGroup);
      });
      layerGroupsRef.current.price = priceGroup;

      // ── Layer 4 · Market Coverage ──────────────────────────────────────────
      const coverageGroup = L.layerGroup();
      data.filter((d) => d.dealerGroupId === 1).forEach((dealer) => {
        [
          { radius: 2000,  fillOpacity: 0.06  },
          { radius: 5000,  fillOpacity: 0.04  },
          { radius: 10000, fillOpacity: 0.025 },
        ].forEach(({ radius, fillOpacity }) => {
          L.circle([dealer.latitude, dealer.longitude], {
            radius, color: "#3b82f6", fillColor: "#3b82f6",
            fillOpacity, opacity: 0.18, weight: 1, interactive: false,
          }).addTo(coverageGroup);
        });
      });
      layerGroupsRef.current.coverage = coverageGroup;

      // ── Layer 5 · Supply Pressure ──────────────────────────────────────────
      const supplyGroup = L.layerGroup();
      data.forEach((dealer) => {
        const dos = dealer.daysOfSupply ?? null;
        const mtd = dealer.mtdSold ?? 0;
        let color = "#6b7280";
        if (mtd > 0 && dos != null)
          color = dos < 30 ? "#3b82f6" : dos <= 60 ? "#10b981" : dos <= 90 ? "#f59e0b" : "#ef4444";
        L.circleMarker([dealer.latitude, dealer.longitude], {
          radius: 14, color, fillColor: color,
          fillOpacity: 0.18, opacity: 0.65, weight: 2, interactive: false,
        }).addTo(supplyGroup);
      });
      layerGroupsRef.current.supply = supplyGroup;

      // ── Layer 6 · New Listings ─────────────────────────────────────────────
      const newListingsGroup = L.layerGroup();
      data.forEach((dealer) => {
        const newCount = dealer.newListings7d ?? 0;
        if (newCount === 0) return;
        const size     = Math.max(20, Math.min(56, newCount * 3 + 14));
        const icon     = L.divIcon({
          className: "",
          html: `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2px solid #10b981;background:#10b98112;animation:newListingsPulse 1.8s ease-out infinite;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"></div>`,
          iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        });
        L.marker([dealer.latitude, dealer.longitude], { icon, interactive: false, zIndexOffset: -150 }).addTo(newListingsGroup);
      });
      layerGroupsRef.current.newListings = newListingsGroup;

      // ── CSS ────────────────────────────────────────────────────────────────
      const style = document.createElement("style");
      style.textContent = `
        .dealer-popup .leaflet-popup-content-wrapper {
          background:#111827;border:1px solid #374151;border-radius:8px;
          box-shadow:0 4px 20px rgba(0,0,0,.5);color:white;
        }
        .dealer-popup .leaflet-popup-tip { background:#111827; }
        .dealer-popup .leaflet-popup-close-button { color:#9ca3af; }
        @keyframes velocityPulse {
          0%,100% { opacity:.65; transform:translate(-50%,-50%) scale(.92); }
          50%      { opacity:.25; transform:translate(-50%,-50%) scale(1.12); }
        }
        @keyframes newListingsPulse {
          0%   { opacity:.85; transform:translate(-50%,-50%) scale(.7); }
          100% { opacity:0;   transform:translate(-50%,-50%) scale(2); }
        }
      `;
      document.head.appendChild(style);
    });

    return () => {
      if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }
    };
  }, []);

  function toggleLayer(id: LayerId) {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        layerGroupsRef.current[id]?.remove();
      } else {
        next.add(id);
        if (mapInstance.current) layerGroupsRef.current[id]?.addTo(mapInstance.current);
      }
      return next;
    });
  }

  return (
    <div className="space-y-3">

      {/* ── Intelligence Panel ───────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-6">
        <span className="text-gray-500 text-xs font-mono uppercase tracking-widest shrink-0">
          Map Intelligence
        </span>
        <div className="flex flex-wrap gap-2 flex-1">
          {LAYER_CONFIG.map(({ id, label, Icon, color }) => {
            const active = activeLayers.has(id);
            return (
              <button
                key={id}
                onClick={() => toggleLayer(id)}
                style={active ? { boxShadow: `0 0 12px ${color}55`, borderColor: `${color}80`, color: "white" } : {}}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${
                  active
                    ? "bg-gray-800 border-gray-600"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                }`}
              >
                <Icon />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Group legend ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white" />
          <span>Baja Auto Group</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-purple-500 border-2 border-white" />
          <span>Ariana Auto Group</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-white" />
          <span>Tracked Competitor</span>
        </div>
      </div>

      {/* ── Map + legend overlay ─────────────────────────────────────────── */}
      <div style={{ position: "relative" }}>
        <div
          ref={mapRef}
          className="w-full rounded-lg border border-gray-800 overflow-hidden"
          style={{ height: "calc(100vh - 300px)", minHeight: "500px" }}
        />

        {/* Layer legend — fades in when any layer is active */}
        <div
          style={{
            position: "absolute",
            bottom: "24px",
            right: "12px",
            zIndex: 1000,
            opacity: activeLayers.size > 0 ? 1 : 0,
            pointerEvents: activeLayers.size > 0 ? "auto" : "none",
            transition: "opacity 0.3s ease",
          }}
          className="bg-gray-900 bg-opacity-95 border border-gray-700 rounded-lg p-3 space-y-3 min-w-[200px]"
        >
          {LAYER_CONFIG.filter((l) => activeLayers.has(l.id)).map(({ id, color }) => {
            const legend = LAYER_LEGENDS[id];
            const title = id === "velocity" && velocityTitle ? velocityTitle : legend.title;
            return (
              <div key={id}>
                <div className="text-xs font-mono uppercase tracking-wide mb-1.5" style={{ color }}>
                  {title}
                </div>
                <div className="space-y-1">
                  {legend.items.map((item) => (
                    <div key={item.label} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />
                      <span className="text-gray-300 text-xs">{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
