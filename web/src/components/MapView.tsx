// Leaflet used directly (BSD-2), no react-leaflet (PLAN.md §3.2). The base map is
// optional: if tiles fail to load (offline), boundary, points and routes still render
// on a plain background and a note says so.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

export type MapPoint = { id: string; lat: number; lon: number; label: string };
export type PointLayer = {
  name: string; points: MapPoint[]; color: string; radius: number;
  hollow?: boolean; square?: boolean; coverRadiusM?: number;
};
export type RouteLine = { coords: [number, number][]; color: string; label: string; dashed?: boolean };

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// The map is always a light "paper" (the OSM tiles are light in both themes), so map ink
// is fixed rather than themed: dark ink and white marker rings stay legible on it.
export const MAP_INK = "#1f1f1e";
const MAP_BOUNDARY = "#52514e";
const MAP_RING = "#ffffff";

export function MapView({ boundary, layers, routes = [], height = 440 }: {
  boundary: GeoJSON.FeatureCollection; layers: PointLayer[]; routes?: RouteLine[]; height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomSnap: 0.25, scrollWheelZoom: false });
    const tiles = L.tileLayer(TILE_URL, {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    });
    let errors = 0;
    tiles.on("tileerror", () => { if (++errors >= 3) setTilesFailed(true); });
    tiles.on("tileload", () => { errors = 0; setTilesFailed(false); });
    tiles.addTo(m);
    const b = L.geoJSON(boundary, { style: { color: MAP_BOUNDARY, weight: 2, opacity: 0.9, fill: false, interactive: false } }).addTo(m);
    const fit = () => m.fitBounds(b.getBounds(), { padding: [12, 12] });
    fit();
    let userMoved = false;
    m.on("dragstart zoomstart", (e) => { if ((e as L.LeafletEvent & { originalEvent?: Event }).originalEvent) userMoved = true; });
    m.getContainer().addEventListener("pointerdown", () => { userMoved = true; }, { once: true });
    overlay.current = L.layerGroup().addTo(m);
    map.current = m;
    // Refit when the container gets its real size (first layout, window resize) unless the user has moved the map.
    const ro = new ResizeObserver(() => { m.invalidateSize(); if (!userMoved) fit(); });
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, [boundary]);

  useEffect(() => {
    const group = overlay.current;
    if (!group) return;
    group.clearLayers();
    const ring = MAP_RING;
    for (const r of routes) {
      // Dashed = approximate straight segments (no street geometry available for this route).
      L.polyline(r.coords, { color: r.color, weight: r.dashed ? 2 : 3, opacity: 0.85, lineJoin: "round",
                             dashArray: r.dashed ? "6 6" : undefined })
        .bindTooltip(r.label, { sticky: true }).addTo(group);
    }
    for (const layer of layers) {
      for (const p of layer.points) {
        if (layer.coverRadiusM) {
          L.circle([p.lat, p.lon], { radius: layer.coverRadiusM, color: layer.color, weight: 0.5, opacity: 0.4,
                                     fillColor: layer.color, fillOpacity: 0.12, interactive: false }).addTo(group);
        }
        const marker = layer.square
          ? L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", iconSize: [14, 14],
              html: `<div style="width:14px;height:14px;background:${layer.color};border:2px solid ${ring};border-radius:2px"></div>` }) })
          : L.circleMarker([p.lat, p.lon], {
              radius: layer.radius, color: layer.hollow ? layer.color : ring, weight: 2,
              fillColor: layer.color, fillOpacity: layer.hollow ? 0.15 : 1,
            });
        marker.bindTooltip(`${p.label}<br><span style="opacity:.7">${layer.name}</span>`).addTo(group);
      }
    }
  }, [layers, routes]);

  return (
    <div className="relative">
      <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-md border border-line"
           role="region" aria-label="Map" />
      {tilesFailed && (
        <div className="absolute left-14 right-2 top-2 z-[1000] w-fit rounded bg-warn-bg px-2 py-1 text-xs text-warn-ink">
          Base map unavailable (offline?). Points and boundary are still exact.
        </div>
      )}
    </div>
  );
}

export function MapLegend({ items }: { items: { color: string; label: string; hollow?: boolean; square?: boolean; line?: boolean; dashed?: boolean }[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.line ? (
            <span className="inline-block h-0 w-4" style={{ borderTop: `${i.dashed ? 2 : 3}px ${i.dashed ? "dashed" : "solid"} ${i.color}` }} />
          ) : (
            <span
              className={`inline-block h-2.5 w-2.5 ${i.square ? "rounded-[2px]" : "rounded-full"}`}
              style={i.hollow ? { border: `2px solid ${i.color}` } : { background: i.color }}
            />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}
