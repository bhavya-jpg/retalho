// Original diagrams in the Retalho textile language. Data-driven where the data exists (WeaveGrid);
// otherwise explicitly conceptual and labelled as such.
import { t, tr } from "../lib/i18n";
import { useMotion, useReveal } from "../lib/motion";
import type { Weave } from "../lib/weave";

/** The collection weave: rows are containers, columns are weeks; a weft float is a collection. */
export function WeaveGrid({ weave, order, colour, label, compact = false, highlightWeek, highlightId, playhead = false, onRowHover }: {
  weave: Weave; order: string[]; colour: string; label: string; compact?: boolean; highlightWeek?: number; highlightId?: string | null;
  playhead?: boolean; onRowHover?: (id: string | null) => void;
}) {
  const { ref, cls } = useReveal<SVGSVGElement>(0.15);
  const { live } = useMotion();
  const rowH = compact ? 9 : 12, colW = compact ? 38 : 52, padL = compact ? 4 : 54, padT = 20;
  const rows = order.map((id) => weave.ids.indexOf(id));
  const w = padL + weave.weeks.length * colW + 4;
  const h = padT + rows.length * rowH + 4;
  return (
    <figure className="m-0">
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} className={`h-auto w-full ${cls}`} role="img"
           aria-label={t("weave.aria", { label, c: weave.collections, n: weave.ids.length, w: weave.weeks.length })}>
        {highlightWeek !== undefined && weave.weeks.indexOf(highlightWeek) >= 0 && (
          <rect x={padL + weave.weeks.indexOf(highlightWeek) * colW} y={padT - 4} width={colW} height={h - padT} rx="4"
                fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="1" />
        )}
        {highlightId && order.indexOf(highlightId) >= 0 && (
          <rect x={padL - 2} y={padT + order.indexOf(highlightId) * rowH} width={weave.weeks.length * colW + 4} height={rowH} rx="3"
                fill="none" stroke="var(--ink)" strokeWidth="1.2" />
        )}
        {/* playhead: steps week by week, so the calendar reads as time passing */}
        {playhead && live && (
          <rect y={padT - 4} width={colW} height={h - padT} rx="4" fill="var(--ink)" fillOpacity="0.05" stroke="var(--ink)"
                strokeOpacity="0.35" strokeWidth="1" x={padL} aria-hidden>
            <animate attributeName="x" dur={`${weave.weeks.length * 1.6}s`} begin="1.2s" repeatCount="indefinite" calcMode="discrete"
                     values={weave.weeks.map((_, c) => padL + c * colW).join(";")} />
          </rect>
        )}
        {weave.weeks.map((wk, c) => (
          <text key={wk} x={padL + c * colW + colW / 2} y={12} textAnchor="middle" fontSize="10" fill="var(--muted)"
                fontFamily="var(--font-mono)">{t("common.weekShort", { n: wk })}</text>
        ))}
        {/* warp: the bare threads */}
        {weave.weeks.map((_, c) => [0.25, 0.5, 0.75].map((f) => (
          <line key={`${c}-${f}`} x1={padL + c * colW + colW * f} y1={padT - 2} x2={padL + c * colW + colW * f} y2={h - 4}
                stroke="var(--flax)" strokeWidth="1.4" />
        )))}
        {rows.map((ri, r) => (
          <g key={order[r]} onMouseEnter={onRowHover ? () => onRowHover(order[r]) : undefined}
             onMouseLeave={onRowHover ? () => onRowHover(null) : undefined}>
            {onRowHover && <rect x={0} y={padT + r * rowH} width={w} height={rowH} fill="transparent" />}
            {!compact && (
              <text x={padL - 6} y={padT + r * rowH + rowH * 0.72} textAnchor="end" fontSize="8.5" fill="var(--muted)" fontFamily="var(--font-mono)">
                {order[r].replace(/^OSM-/, "").slice(-8)}
              </text>
            )}
            {weave.cells[ri].map((on, c) => on && (
              <rect key={c} x={padL + c * colW + 3} y={padT + r * rowH + 1.5} width={colW - 6} height={rowH - 3} rx={(rowH - 3) / 2}
                    fill={colour} className="pop" style={{ ["--pop-delay" as string]: `${c * 120 + r * 12}ms` }}>
                <title>{t("weave.cell", { id: order[r], w: weave.weeks[c] })}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex items-baseline justify-between gap-3 text-xs text-ink-2">
        <span>{label}</span>
        <span className="mono tabular text-ink">{t("weave.collections", { c: weave.collections })}</span>
      </figcaption>
    </figure>
  );
}

/** Conceptual journey of a textile, with the part Retalho plans marked. Not a data view. */
export function JourneyDiagram() {
  const { ref, cls } = useReveal<HTMLOListElement>(0.2);
  const steps = ([1, 2, 3, 4, 5] as const).map((n) => ({
    t: t(`journey.${n}`), d: t(`journey.${n}.d`), ours: n === 2 || n === 3,
  }));
  return (
    <div>
      <ol ref={ref} className={`grid grid-cols-1 gap-3 sm:grid-cols-5 sm:gap-0 ${cls}`} aria-label={t("journey.aria")}>
        {steps.map((s, i) => (
          <li key={s.t} className="reveal relative sm:pe-4" style={{ ["--reveal-delay" as string]: `${i * 90}ms` }}>
            <div className="flex items-center gap-2">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] mono ${s.ours
                ? "border-transparent bg-accent text-on-accent" : "border-line-strong text-muted"}`}>{i + 1}</span>
              {i < steps.length - 1 && <span className="hidden h-px flex-1 bg-[var(--border-strong)] sm:block" aria-hidden />}
            </div>
            <p className={`mt-3 font-medium ${s.ours ? "text-ink" : "text-ink-2"}`}>{s.t}</p>
            <p className="mt-1 text-sm text-muted">{s.d}</p>
          </li>
        ))}
      </ol>
      <div className="mt-5 grid grid-cols-1 gap-3 text-xs sm:grid-cols-5">
        <span className="hidden sm:block" />
        <span className="seam col-span-1 rounded-[var(--r-sm)] px-3 py-2 text-ink-2 sm:col-span-2">
          {tr("journey.ours")}
        </span>
        <span className="text-muted sm:col-span-2">{t("journey.others")}</span>
      </div>
    </div>
  );
}

/** Real pipeline stages, from inputs to this page. */
export function PipelineDiagram() {
  const { live } = useMotion();
  const cols = [
    { h: t("pipe.inputs"), items: [t("pipe.roads"), t("pipe.points"), t("pipe.census"), "assumptions.yaml"] },
    { h: t("pipe.pipeline"), items: [t("pipe.distances"), t("pipe.coverage"), t("pipe.sim"), t("pipe.bench"), t("pipe.geometry")] },
    { h: t("pipe.static"), items: ["results-<source>.json", t("pipe.checked")] },
    { h: t("pipe.app"), items: [t("pipe.views"), t("pipe.euro")] },
  ];
  const { ref, cls } = useReveal<HTMLDivElement>(0.2);
  return (
    <div ref={ref} className={`grid grid-cols-1 gap-4 md:grid-cols-4 md:gap-0 ${cls}`} role="group" aria-label={t("pipe.aria")}>
      {cols.map((c, i) => (
        <div key={c.h} className="reveal relative md:pe-6" style={{ ["--reveal-delay" as string]: `${i * 110}ms` }}>
          <p className="eyebrow">{String(i + 1).padStart(2, "0")} · {c.h}</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {c.items.map((x) => (
              <li key={x} className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-1.5 text-[13px] text-ink">{x}</li>
            ))}
          </ul>
          {i < cols.length - 1 && (
            <svg className="absolute end-0 top-9 hidden h-5 w-7 md:block rtl:-scale-x-100" viewBox="0 0 24 16" aria-hidden overflow="visible">
              <path d="M2 8 C 8 2, 14 14, 20 8" fill="none" stroke="var(--terracotta)" strokeWidth="1.6" className="thread-draw" pathLength={1} />
              <path d="M17 5l4 3-4 3" fill="none" stroke="var(--terracotta)" strokeWidth="1.6" />
              {live && [0, 0.8].map((d) => (
                <circle key={d} r="2.2" fill="var(--ink)">
                  <animateMotion dur="1.6s" begin={`${i * 0.35 + d}s`} repeatCount="indefinite" path="M2 8 C 8 2, 14 14, 20 8" />
                </circle>
              ))}
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

/** Concept: identical stops and limits, two visiting orders. Labelled as an illustration. */
export function OrderDiagram() {
  const pts: [number, number][] = [[40, 90], [92, 40], [150, 70], [118, 128], [190, 30], [236, 104], [200, 150]];
  const depot: [number, number] = [20, 150];
  const nn = [depot, pts[0], pts[3], pts[2], pts[1], pts[4], pts[5], pts[6], depot];
  const opt = [depot, pts[0], pts[1], pts[4], pts[2], pts[5], pts[6], pts[3], depot];
  const d = (seq: [number, number][]) => seq.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
  const { ref, cls } = useReveal<SVGSVGElement>(0.2);
  const panel = (seq: [number, number][], colour: string, title: string, dx: number) => (
    <g transform={`translate(${dx} 0)`}>
      <text x="0" y="14" fontSize="11" fontFamily="var(--font-mono)" fill="var(--muted)">{title}</text>
      <path d={d(seq)} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" className="thread-draw" pathLength={1} />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="5" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.6" />)}
      <rect x={depot[0] - 6} y={depot[1] - 6} width="12" height="12" rx="2" fill="var(--ink)" />
    </g>
  );
  return (
    <figure className="m-0">
      <svg ref={ref} viewBox="0 0 540 170" className={`h-auto w-full ${cls}`} role="img"
           aria-label={t("order.aria")}>
        {panel(nn, "var(--baseline)", t("order.nearest"), 0)}
        {panel(opt, "var(--accent)", t("order.optimised"), 280)}
      </svg>
      <figcaption className="mt-2 text-xs text-muted">{t("order.caption")}</figcaption>
    </figure>
  );
}
