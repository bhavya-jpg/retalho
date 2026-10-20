// Leaflet used directly (BSD-2), no react-leaflet (PLAN.md §3.2). The base map is optional: if
// tiles fail to load (offline), boundary, points and routes still render on a plain background and
// a note says so. Tiles are desaturated to a warm paper in CSS (index.css); overlays keep full colour.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { useMotion } from "../lib/motion";
import { t } from "../lib/i18n";

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

export function MapView({ boundary, layers, routes = [], height = 440, selectedId, onSelect, drawKey, label, trucks = false }: {
  boundary: GeoJSON.FeatureCollection; layers: PointLayer[]; routes?: RouteLine[]; height?: number;
  selectedId?: string | null; onSelect?: (id: string | null) => void; drawKey?: string; label?: string; trucks?: boolean;
}) {
  const { live } = useMotion();
  const visible = useRef(true);
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
    // No animation: a zoom transition still running when the map is removed (tab or language switch
    // during a resize) ends on a detached pane and throws inside Leaflet.
    const fit = () => m.fitBounds(b.getBounds(), { padding: [14, 14], animate: false });
    fit();
    let userMoved = false;
    m.on("dragstart zoomstart", (e) => { if ((e as L.LeafletEvent & { originalEvent?: Event }).originalEvent) userMoved = true; });
    m.getContainer().addEventListener("pointerdown", () => { userMoved = true; }, { once: true });
    overlay.current = L.layerGroup().addTo(m);
    map.current = m;
    // Refit when the container gets its real size (first layout, window resize) unless the user has moved the map.
    const ro = new ResizeObserver(() => { m.invalidateSize({ animate: false }); if (!userMoved) fit(); });
    ro.observe(el.current);
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; });
    io.observe(el.current);
    return () => { ro.disconnect(); io.disconnect(); m.stop(); m.remove(); map.current = null; };
  }, [boundary]);

  useEffect(() => {
    const group = overlay.current;
    if (!group) return;
    group.clearLayers();
    const animate = drawKey !== undefined && drawKey !== lastDraw.current && live;
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
  }, [layers, routes, selectedId, onSelect, drawKey, live]);

  // A truck marker drives each route in its visiting order: on screen, tab visible, motion allowed only.
  useEffect(() => {
    const group = overlay.current;
    if (!group || !trucks || !live || routes.length === 0) return;
    const movers = routes.filter((r) => r.coords.length > 1).map((r, i) => {
      const k = Math.cos((r.coords[0][0] * Math.PI) / 180);
      const cum = [0];
      for (let j = 1; j < r.coords.length; j++) {
        const [a, b] = [r.coords[j - 1], r.coords[j]];
        cum.push(cum[j - 1] + Math.hypot(b[0] - a[0], (b[1] - a[1]) * k));
      }
      const marker = L.circleMarker(r.coords[0], { radius: 6, color: MAP_RING, weight: 2.5, fillColor: r.color, fillOpacity: 1,
                                                   interactive: false, className: "truck" }).addTo(group);
      return { pts: r.coords, cum, total: cum[cum.length - 1] || 1, marker, offset: i * 0.37 };
    });
    const period = 16000;
    const start = performance.now() + 800; // after the route has drawn
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now < start || !visible.current || document.hidden) return;
      for (const mv of movers) {
        const d = (((now - start) / period + mv.offset) % 1) * mv.total;
        let lo = 0, hi = mv.cum.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (mv.cum[mid] < d) lo = mid; else hi = mid; }
        const seg = mv.cum[hi] - mv.cum[lo] || 1, f = (d - mv.cum[lo]) / seg;
        const [a, b] = [mv.pts[lo], mv.pts[hi]];
        mv.marker.setLatLng([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); movers.forEach((mv) => group.removeLayer(mv.marker)); };
  }, [routes, trucks, live, layers, selectedId]);

  return (
    <div className="relative">
      <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-[var(--r-md)] border border-line"
           role="region" aria-label={label ?? t("map.label")} dir="ltr" />
      {tilesFailed && (
        <div dir="auto" className="absolute left-14 right-2 top-2 z-[1000] w-fit rounded-[var(--r-sm)] bg-warn-bg px-2 py-1 text-xs text-warn-ink">
          {t("map.tilesFailed")}
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
