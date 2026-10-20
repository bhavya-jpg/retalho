// Hero illustration built from real data: a woven swatch whose weft threads leave the cloth and run
// to real collection points inside the real Guimarães boundary, with one real simulated route
// (OSRM street geometry) drawn as a thread. Animates once; static under reduced motion.
import { useEffect, useMemo, useRef, useState } from "react";
import { boundsOf, makeProjection, outerRings, pathD, thin, type LonLat } from "../lib/geo";
import { t } from "../lib/i18n";
import { useMotion, useReveal } from "../lib/motion";
import { decodePolyline } from "../lib/polyline";
import type { Results } from "../types";

const W = 680, H = 520;
const WEAVE = { x0: 18, x1: 212, y0: 128, y1: 392 };
const N = 7;
const WEFT_COLOURS = ["var(--series-a)", "var(--flax)", "var(--series-b)", "var(--forest)", "var(--series-a)", "var(--olive)", "var(--series-b)"];

function pickRoute(r: Results) {
  // Longest truck-day of the first run, mid profile (or the first profile), Scenario A: a real route.
  const profile = r.scenarios.mid ? "mid" : Object.keys(r.scenarios)[0];
  const routes = r.scenarios[profile].A.per_seed[0].weeks[0].routes;
  const route = [...routes].sort((a, b) => b.stop_ids.length - a.stop_ids.length)[0];
  const key = route ? r.route_geometry?.route_keys[route.stop_ids.join("|")] : undefined;
  const g = key ? r.route_geometry?.geometries[key] : undefined;
  let path: LonLat[] | null = null;
  if (g && g.status === "road") {
    try { path = decodePolyline(g.polyline6).map(([lat, lon]) => [lon, lat] as LonLat); } catch { path = null; }
  }
  return { route, path, approximate: !path };
}

export function HeroWeave({ r }: { r: Results | null }) {
  const { ref, cls } = useReveal<SVGSVGElement>(0.1);
  const { live } = useMotion();
  // Pointer depth: the cloth and the city drift a few pixels apart (fine pointers only, never under reduced motion).
  const [tilt, setTilt] = useState<[number, number]>([0, 0]);
  const frame = useRef(0);
  useEffect(() => {
    if (!live || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) { setTilt([0, 0]); return; }
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const b = ref.current?.getBoundingClientRect();
        if (!b) return;
        const x = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / (b.width / 2)));
        const y = Math.max(-1, Math.min(1, (e.clientY - (b.top + b.height / 2)) / (b.height / 2)));
        setTilt([x, y]);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => { window.removeEventListener("pointermove", onMove); cancelAnimationFrame(frame.current); };
  }, [live, ref]);
  const clothShift = { transform: `translate(${-tilt[0] * 7}px, ${-tilt[1] * 5}px)` };
  const cityShift = { transform: `translate(${tilt[0] * 9}px, ${tilt[1] * 6}px)` };
  const model = useMemo(() => {
    if (!r) return null;
    const rings = outerRings(r.network.boundary).map((ring) => thin(ring, 420));
    const proj = makeProjection(boundsOf(rings.flat()), W - 250, H - 30, 6);
    const P = (p: LonLat): [number, number] => { const [x, y] = proj(p); return [x + 244, y + 15]; };
    const pt = (f: { geometry: { coordinates: [number, number] } }) => P(f.geometry.coordinates as LonLat);
    const proposed = new Set(r.meta.collection_network?.proposed ?? []);
    const network = [
      ...r.network.containers.features.map((f) => ({ id: f.properties.id, xy: pt(f) })),
      ...r.network.candidates.features.filter((f) => proposed.has(f.properties.id)).map((f) => ({ id: f.properties.id, xy: pt(f) })),
    ];
    const others = r.network.candidates.features.filter((f) => !proposed.has(f.properties.id)).map(pt);
    const depot = P([r.network.depot.lon, r.network.depot.lat]);
    const { route, path, approximate } = pickRoute(r);
    const order = new Map((route?.stop_ids ?? []).map((id, i) => [id, i]));
    const routeD = path ? pathD(thin(path, 900).map(P)) : route
      ? pathD([depot, ...route.stop_ids.map((id) => network.find((n) => n.id === id)?.xy ?? depot), depot]) : "";
    // weft threads leave the weave and run to the first N collection points (sorted west to east)
    const targets = [...network].sort((a, b) => a.xy[1] - b.xy[1]).filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / N)) === 0).slice(0, N);
    return { rings: rings.map((ring) => pathD(ring.map(P), true)), network, others, depot, routeD, approximate, order, targets,
             stops: route?.stop_ids.length ?? 0 };
  }, [r]);

  const gx = (i: number) => WEAVE.x0 + 14 + (i * (WEAVE.x1 - WEAVE.x0 - 28)) / (N - 1);
  const gy = (j: number) => WEAVE.y0 + 14 + (j * (WEAVE.y1 - WEAVE.y0 - 28)) / (N - 1);
  const label = model
    ? t(model.approximate ? "land.heroAriaApprox" : "land.heroAria", { n: model.network.length })
    : t("land.heroAriaPlain");

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={`h-auto w-full ${cls}`} role="img" aria-label={label}>
      <g className="parallax" style={clothShift}>
      {/* the cloth */}
      <g className="pop" style={{ ["--pop-delay" as string]: "0ms" }}>
        <rect x={WEAVE.x0} y={WEAVE.y0} width={WEAVE.x1 - WEAVE.x0} height={WEAVE.y1 - WEAVE.y0} rx="6" fill="var(--surface)" stroke="var(--border)" />
      </g>
      {Array.from({ length: N }, (_, i) => (
        <line key={`w${i}`} x1={gx(i)} y1={WEAVE.y0 + 6} x2={gx(i)} y2={WEAVE.y1 - 6} stroke="var(--flax)" strokeWidth="9" strokeLinecap="round"
              className="thread-draw" pathLength={1} style={{ ["--draw-delay" as string]: `${i * 40}ms` }} />
      ))}
      {Array.from({ length: N }, (_, j) => (
        <g key={`f${j}`}>
          {/* weft passes over the warp on alternate crossings: draw it, then re-draw warp floats on top */}
          <line x1={WEAVE.x0 + 6} y1={gy(j)} x2={WEAVE.x1} y2={gy(j)} stroke="var(--surface)" strokeWidth="12" strokeLinecap="round"
                className="thread-draw" pathLength={1} style={{ ["--draw-delay" as string]: `${180 + j * 50}ms` }} />
          <line x1={WEAVE.x0 + 6} y1={gy(j)} x2={WEAVE.x1} y2={gy(j)} stroke={WEFT_COLOURS[j]} strokeWidth="9" strokeLinecap="round"
                className="thread-draw" pathLength={1} style={{ ["--draw-delay" as string]: `${180 + j * 50}ms` }} />
          {Array.from({ length: N }, (_, i) => (i + j) % 2 === 0 && (
            <g key={i} className="pop" style={{ ["--pop-delay" as string]: `${520 + j * 30}ms` }}>
              <line x1={gx(i)} y1={gy(j) - 9} x2={gx(i)} y2={gy(j) + 9} stroke="var(--surface)" strokeWidth="12" />
              <line x1={gx(i)} y1={gy(j) - 10} x2={gx(i)} y2={gy(j) + 10} stroke="var(--flax)" strokeWidth="9" />
            </g>
          ))}
        </g>
      ))}
      {/* the shuttle: a glint passes along each weft thread in turn */}
      {live && Array.from({ length: N }, (_, j) => (
        <rect key={`s${j}`} className="loop shuttle" x={WEAVE.x0 + 4} y={gy(j) - 2.5} width="26" height="5" rx="2.5"
              fill="var(--surface)" opacity="0"
              style={{ ["--shuttle-delay" as string]: `${2.2 + j * 0.5}s`, ["--travel" as string]: `${WEAVE.x1 - WEAVE.x0 - 34}px` }} />
      ))}
      </g>

      {model && (
        <g className="parallax" style={cityShift}>
          {/* the city */}
          {model.rings.map((d, i) => (
            <path key={i} d={d} fill="var(--surface)" fillOpacity="0.55" stroke="var(--ink-2)" strokeOpacity="0.5" strokeWidth="1.2"
                  className="thread-draw" pathLength={1} style={{ ["--draw-delay" as string]: "200ms" }} />
          ))}
          {model.others.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2" fill="var(--candidate)" opacity="0.55" className="pop" style={{ ["--pop-delay" as string]: "700ms" }} />
          ))}
          {/* weft threads unravel towards collection points */}
          {model.targets.map((t, j) => {
            const [x, y] = t.xy;
            return (
              <path key={t.id} d={`M${WEAVE.x1} ${gy(j)} C ${WEAVE.x1 + 70} ${gy(j)}, ${x - 90} ${y}, ${x} ${y}`} fill="none"
                    stroke={WEFT_COLOURS[j]} strokeWidth="2" strokeOpacity="0.8" strokeLinecap="round" className="thread-draw" pathLength={1}
                    style={{ ["--draw-delay" as string]: `${650 + j * 70}ms` }} />
            );
          })}
          {/* one real simulated route, as a thread with a light casing */}
          <path d={model.routeD} fill="none" stroke="var(--surface)" strokeWidth="6" strokeLinejoin="round" strokeLinecap="round"
                className="thread-draw" pathLength={1} style={{ ["--draw-delay" as string]: "1000ms" }} />
          <path id="hero-route" d={model.routeD} fill="none" stroke="var(--series-a)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={model.approximate ? "6 6" : undefined}
                className={model.approximate ? "" : "thread-draw"} pathLength={model.approximate ? undefined : 1}
                style={{ ["--draw-delay" as string]: "1000ms", transitionDuration: "1600ms" }} />
          {model.network.map((n) => {
            const k = model.order.get(n.id);
            const delay = k === undefined ? 900 : 1100 + (k / Math.max(1, model.stops)) * 1500;
            return (
              <circle key={n.id} cx={n.xy[0]} cy={n.xy[1]} r={k === undefined ? 3.6 : 4.6} fill={k === undefined ? "var(--ink)" : "var(--series-a)"}
                      stroke="var(--surface)" strokeWidth="2" className="pop" style={{ ["--pop-delay" as string]: `${delay}ms` }} />
            );
          })}
          <g className="pop" style={{ ["--pop-delay" as string]: "1000ms" }}>
            <rect x={model.depot[0] - 6} y={model.depot[1] - 6} width="12" height="12" rx="2" fill="var(--ink)" stroke="var(--surface)" strokeWidth="2" />
          </g>
          {/* the collection truck drives the real route, once the threads have finished drawing */}
          {live && model.routeD && (
            <g aria-hidden>
              {[{ r: 11, o: 0.16 }, { r: 5, o: 1 }].map(({ r: rad, o }) => (
                <circle key={rad} r={rad} fill="var(--terracotta)" stroke={o === 1 ? "var(--surface)" : "none"} strokeWidth="2" opacity="0">
                  <set attributeName="opacity" to={String(o)} begin="2.9s" fill="freeze" />
                  <animateMotion dur="11s" begin="2.9s" repeatCount="indefinite" rotate="auto" keyTimes="0;1" keyPoints="0;1" calcMode="linear">
                    <mpath href="#hero-route" />
                  </animateMotion>
                </circle>
              ))}
            </g>
          )}
        </g>
      )}
    </svg>
  );
}
