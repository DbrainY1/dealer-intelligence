"use client";

import { useEffect, useRef } from "react";

interface Dealer {
  name: string;
  lat: number;
  lng: number;
  tracked: boolean;
  group?: string;
  address: string;
  website?: string;
}

const DEALERS: Dealer[] = [
  // Baja Auto Group — tracked (own)
  { name: "Baja East", lat: 36.1701, lng: -115.1088, tracked: true, group: "Baja Auto Group", address: "3333 E Fremont St, Las Vegas, NV 89104", website: "https://www.bajaautos.com" },
  { name: "Baja West", lat: 36.1647, lng: -115.1970, tracked: true, group: "Baja Auto Group", address: "824 S Decatur Blvd, Las Vegas, NV 89107", website: "https://www.bajaautos.com" },
  { name: "Newport Motors", lat: 36.1448, lng: -115.1222, tracked: true, group: "Baja Auto Group", address: "2711 E Sahara Ave, Las Vegas, NV 89104", website: "https://www.bajaautos.com" },

  // Ariana Auto Group — tracked (competitor)
  { name: "Ariana Motors", lat: 36.1763, lng: -115.0792, tracked: true, group: "Ariana Auto Group", address: "1120 N Nellis Blvd, Las Vegas, NV 89110", website: "https://www.arianamotorslv.com" },
  { name: "Ariana Motors Nellis", lat: 36.1680, lng: -115.0801, tracked: true, group: "Ariana Auto Group", address: "1120 N Nellis Blvd, Las Vegas, NV 89110", website: "https://www.arianamotorsnellis.com" },
  { name: "One Motors LV", lat: 36.1056, lng: -115.0642, tracked: true, group: "Ariana Auto Group", address: "3535 Boulder Hwy, Las Vegas, NV 89121", website: "https://www.onemotorslv.com" },

  // Tracked competitors
  { name: "Boktors", lat: 36.0991, lng: -115.1341, tracked: true, address: "1610 E Tropicana Ave, Las Vegas, NV 89119", website: "https://www.boktors.com" },
  { name: "Globul Enterprises", lat: 36.1046, lng: -115.1864, tracked: true, address: "3720 S Valley View Blvd, Las Vegas, NV 89103", website: "https://www.globulenterprises.com" },
  { name: "Platinum Cars LV", lat: 36.0998, lng: -115.0703, tracked: true, address: "3497 Boulder Hwy, Las Vegas, NV 89121", website: "https://www.platinumcarslv.com" },
  { name: "Queen Motorcars", lat: 36.1567, lng: -115.1148, tracked: true, address: "2925 E Fremont St, Las Vegas, NV 89104", website: "https://www.queenmotorcars.com" },
  { name: "Auto Vision LV", lat: 36.1542, lng: -115.1178, tracked: true, address: "3020 E Fremont St, Las Vegas, NV 89104", website: "https://www.autovisionlv.com" },
  { name: "Charlie Cheap Car", lat: 36.1479, lng: -115.2198, tracked: true, address: "5015 W Sahara Ave #127, Las Vegas, NV 89146", website: "https://www.charliecheapcar.com" },
];

export default function LocationsMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined" || mapInstance.current) return;

    import("leaflet").then((L) => {
      // Fix default icon paths for Next.js
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      if (!mapRef.current) return;

      const map = L.map(mapRef.current, {
        center: [36.13, -115.13],
        zoom: 12,
        zoomControl: true,
      });

      mapInstance.current = map;

      // Dark tile layer consistent with dashboard
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      // Group colors
      const groupColors: Record<string, string> = {
        "Baja Auto Group": "#3b82f6",
        "Ariana Auto Group": "#8b5cf6",
        "default": "#f59e0b",
      };

      DEALERS.forEach((dealer) => {
        const color = groupColors[dealer.group ?? ""] ?? groupColors["default"];

        const icon = dealer.tracked
          ? L.divIcon({
              className: "",
              html: `
                <div style="
                  background: ${color};
                  border: 2px solid white;
                  border-radius: 50%;
                  width: 14px;
                  height: 14px;
                  box-shadow: 0 0 0 3px ${color}55;
                "></div>
              `,
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            })
          : L.divIcon({
              className: "",
              html: `<div style="background:#6b7280;border-radius:50%;width:8px;height:8px;border:1px solid #9ca3af;"></div>`,
              iconSize: [8, 8],
              iconAnchor: [4, 4],
            });

        const groupLabel = dealer.group ? `<div style="color:#9ca3af;font-size:11px;margin-bottom:2px;">${dealer.group}</div>` : "";
        const websiteLink = dealer.website
          ? `<a href="${dealer.website}" target="_blank" style="color:#60a5fa;font-size:11px;">Visit website →</a>`
          : "";

        const popup = L.popup({ className: "dealer-popup" }).setContent(`
          <div style="font-family:system-ui,sans-serif;min-width:180px;">
            ${groupLabel}
            <div style="color:white;font-weight:700;font-size:14px;margin-bottom:4px;">${dealer.name}</div>
            <div style="color:#d1d5db;font-size:12px;margin-bottom:6px;">${dealer.address}</div>
            ${dealer.tracked ? `<div style="display:inline-block;background:${color}22;border:1px solid ${color};color:${color};font-size:10px;padding:1px 6px;border-radius:999px;margin-bottom:6px;">Tracked</div>` : ""}
            ${websiteLink}
          </div>
        `);

        L.marker([dealer.lat, dealer.lng], { icon })
          .bindPopup(popup)
          .addTo(map);
      });
    });

    // Inject popup styles
    const style = document.createElement("style");
    style.textContent = `
      .dealer-popup .leaflet-popup-content-wrapper {
        background: #111827;
        border: 1px solid #374151;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        color: white;
      }
      .dealer-popup .leaflet-popup-tip {
        background: #111827;
      }
      .dealer-popup .leaflet-popup-close-button {
        color: #9ca3af;
      }
    `;
    document.head.appendChild(style);

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-400">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-white"></div>
          <span>Baja Auto Group</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-purple-500 border-2 border-white"></div>
          <span>Ariana Auto Group</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-white"></div>
          <span>Tracked Competitor</span>
        </div>
      </div>

      {/* Map */}
      <div
        ref={mapRef}
        className="w-full rounded-lg border border-gray-800 overflow-hidden"
        style={{ height: "calc(100vh - 220px)", minHeight: "500px" }}
      />
    </div>
  );
}
