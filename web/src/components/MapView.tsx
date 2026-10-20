// Leaflet used directly (BSD-2), no react-leaflet (PLAN.md §3.2). The base map is optional: if
// tiles fail to load (offline), boundary, points and routes still render on a plain background and
// a note says so. Tiles are desaturated to a warm paper in CSS (index.css); overlays keep full colour.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/motion";

export type MapPoint = { id: string; lat: number; lon: number; label: string };
export type PointLayer = {
  name: string; points: MapPoint[]; color: string; radius: number;
  hollow?: boolean; square?: boolean; coverRadiusM?: number; key?: string; selectable?: boolean;
};
export type RouteLine = { coords: [number, number][]; color: string; label: string; dashed?: boolean };

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// The map is always a light paper, so map ink is fixed rather than themed.
export const MAP_INK = "#22241f";
export const MAP_FOREST = "#355447";
const MAP_BOUNDARY = "#4a4a42";
const MAP_RING = "#faf8f2";

export function MapView({ boundary, layers, routes = [], height = 440, selectedId, onSelect, drawKey, label = "Map" }: {
  boundary: GeoJSON.FeatureCollection; layers: PointLayer[]; routes?: RouteLine[]; height?: number;
  selectedId?: string | null; onSelect?: (id: string | null) => void; drawKey?: string; label?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const lastDraw = useRef<string | undefined>(undefined);
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
    const b = L.geoJSON(boundary, { style: { color: MAP_BOUNDARY, weight: 1.8, opacity: 0.85, fill: false, interactive: false } }).addTo(m);
    const fit = () => m.fitBounds(b.getBounds(), { padding: [14, 14] });
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
    const animate = drawKey !== undefined && drawKey !== lastDraw.current && !prefersReducedMotion();
    lastDraw.current = drawKey;
    for (const r of routes) {
      // A light casing under each route keeps it legible on the map, like a thread on cloth.
      L.polyline(r.coords, { color: MAP_RING, weight: r.dashed ? 4 : 6, opacity: 0.9, lineJoin: "round", interactive: false }).addTo(group);
      // Dashed = approximate straight segments (no street geometry). Never animated, so dashes keep that one meaning.
      const line = L.polyline(r.coords, { color: r.color, weight: r.dashed ? 2 : 3, opacity: 0.95, lineJoin: "round",
                                          dashArray: r.dashed ? "6 6" : undefined, className: r.dashed ? "rt-approx" : "rt-street" })
        .bindTooltip(r.label, { sticky: true }).addTo(group);
      const path = (line as unknown as { _path?: SVGPathElement })._path;
      if (animate && !r.dashed && path) {
        const len = path.getTotalLength();
        path.style.strokeDasharray = `${len}`;
        path.style.strokeDashoffset = `${len}`;
        path.getBoundingClientRect();
        path.style.transition = "stroke-dashoffset 700ms cubic-bezier(0.65, 0, 0.35, 1)";
        path.style.strokeDashoffset = "0";
        path.addEventListener("transitionend", () => { path.style.strokeDasharray = ""; path.style.transition = ""; }, { once: true });
      }
    }
    for (const layer of layers) {
      for (const p of layer.points) {
        const selected = selectedId === p.id;
        if (layer.coverRadiusM) {
          L.circle([p.lat, p.lon], { radius: layer.coverRadiusM, color: layer.color, weight: 0.6, opacity: 0.45,
                                     fillColor: layer.color, fillOpacity: 0.1, interactive: false }).addTo(group);
        }
        if (selected) {
          L.circleMarker([p.lat, p.lon], { radius: layer.radius + 9, color: layer.color, weight: 1.5, opacity: 0.9,
                                           fillColor: layer.color, fillOpacity: 0.16, interactive: false, className: "pt-halo" }).addTo(group);
        }
        const marker = layer.square
          ? L.marker([p.lat, p.lon], { title: layer.name, alt: layer.name, keyboard: false, icon: L.divIcon({ className: "", iconSize: [16, 16],
              html: `<div style="width:16px;height:16px;background:${layer.color};border:2px solid ${MAP_RING};border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,.25)"></div>` }) })
          : L.circleMarker([p.lat, p.lon], {
              radius: selected ? layer.radius + 2 : layer.radius, color: layer.hollow ? layer.color : MAP_RING, weight: layer.hollow ? 1.6 : 2,
              fillColor: layer.color, fillOpacity: layer.hollow ? 0.12 : 1, className: layer.key ? `pt-${layer.key}` : undefined,
            });
        marker.bindTooltip(`${p.label}<div class="tt-id" style="margin-top:4px">${layer.name}</div>`, { direction: "top", offset: [0, -6] });
        if (onSelect && layer.selectable) marker.on("click", () => onSelect(selected ? null : p.id));
        marker.addTo(group);
      }
    }
  }, [layers, routes, selectedId, onSelect, drawKey]);

  return (
    <div className="relative">
      <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-[var(--r-md)] border border-line"
           role="region" aria-label={label} />
      {tilesFailed && (
        <div className="absolute left-14 right-2 top-2 z-[1000] w-fit rounded-[var(--r-sm)] bg-warn-bg px-2 py-1 text-xs text-warn-ink">
          Base map unavailable (offline?). Points and boundary are still exact.
        </div>
      )}
    </div>
  );
}

export function MapLegend({ items }: { items: { color: string; label: string; hollow?: boolean; square?: boolean; line?: boolean; dashed?: boolean }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          {i.line ? (
            <span className="inline-block h-0 w-5" style={{ borderTop: `${i.dashed ? 2 : 3}px ${i.dashed ? "dashed" : "solid"} ${i.color}` }} />
          ) : (
            <span className={`inline-block h-2.5 w-2.5 ${i.square ? "rounded-[2px]" : "rounded-full"}`}
                  style={i.hollow ? { border: `1.6px solid ${i.color}` } : { background: i.color }} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}
