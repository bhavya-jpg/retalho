import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Badge, type BadgeKind } from "../components/Badge";
import { MAP_INK, MapLegend, MapView, type PointLayer, type RouteLine } from "../components/MapView";
import { Card, Empty, PairBars, Segmented, StatTile } from "../components/StatTile";
import { breakevenCurve, compareScenarios } from "../lib/cost";
import { routeDrawing } from "../lib/routes";
import { eur, fmt, fmtRange, signedPct } from "../lib/format";
import { plural, t as tx, tOr, tr, td, useLang } from "../lib/i18n";
import { median } from "../lib/stats";
import { useTokens } from "../lib/tokens";
import type { CostParams, Range, Results } from "../types";
import { WeaveGrid } from "../components/Diagrams";
import { collectionWeave, sharedOrder } from "../lib/weave";
import { BenchmarkCard } from "./BenchmarkCard";
import { toPoints } from "./NetworkTab";

type Props = { r: Results; profile: string; setProfile: (p: string) => void; costs: CostParams };

export function profileMeans(r: Results): Record<string, number> {
  const v = r.assumptions.find((a) => a.key === "fill_rate_profiles")?.value as Record<string, { mean: number }> | undefined;
  return Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, x.mean]));
}

/** Points collected in the simulation: existing containers plus any proposed sites (planned network). */
export function collectionPoints(r: Results) {
  const proposed = new Set(r.meta.collection_network?.proposed ?? []);
  const existing = toPoints(r.network.containers);
  const planned = toPoints(r.network.candidates).filter((p) => proposed.has(p.id))
    .map((p) => ({ ...p, label: `${p.label}<br><i>${tx("rt.proposedTag")}</i>` }));
  return [...existing, ...planned];
}

/** Segmented options for the fill profiles: translated name and mean weekly fill. */
export function profileOptions(r: Results, means: Record<string, number>) {
  return Object.keys(r.scenarios).map((p) => ({ value: p, label: tx("profile.option", { name: tOr(`profile.${p}`, p), pct: fmt((means[p] ?? 0) * 100) }) }));
}

export function resultBadges(r: Results): BadgeKind[] {
  const b: BadgeKind[] = ["simulated"];
  if (r.meta.data_source === "synthetic") b.push("synthetic");
  if (r.meta.distance_provider === "approx") b.push("approx");
  return b;
}

export function CollectionTab({ r, profile, setProfile, costs }: Props) {
  const t = useTokens();
  const means = profileMeans(r);
  const { A, B } = r.scenarios[profile];
  const cmp = useMemo(() => compareScenarios(A, B, costs), [A, B, costs]);
  const badges = resultBadges(r);
  const nSeeds = A.per_seed.length;
  const net = r.meta.collection_network;

  const overflowMedian = cmp.extraOverflowDaysB?.median ?? 0;
  const saving = cmp.savingCostPct?.median ?? 0;
  useLang();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-2">{tx("col.avgFill")}</span>
        <Segmented label={tx("profile.label")} value={profile} onChange={setProfile} options={profileOptions(r, means)} />
        <span className="text-xs text-muted">
          {tx("col.figures", { n: nSeeds })}
          {net && <> {tx(plural("col.net", net.existing.length), { n: net.existing.length })}
            {net.n_new > 0 && tx("col.netProposed", { n: net.n_new })}.</>}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SavingTile label={tx("col.tileCost")} r={cmp.savingCostPct} badges={badges} />
        <SavingTile label={tx("col.tileTonne")} r={cmp.savingPerTonnePct} badges={badges} />
        <SavingTile label={tx("col.tileKm")} r={cmp.savingKmPct} badges={badges} />
        <StatTile label={tx("col.tileOverflow")}
                  value={`${overflowMedian > 0 ? "+" : ""}${fmt(overflowMedian)}`}
                  sub={tx("col.over4", { range: fmtRange(cmp.extraOverflowDaysB, (x) => `${x > 0 ? "+" : ""}${fmt(x)}`).range })}
                  badges={badges} />
      </div>

      <Card title={tx("col.reading")}>
        <p className="text-sm text-ink-2">
          {saving > 0 ? tr("col.cheaper", { x: fmt(saving, 1) }) : tr("col.notCheaper")}{" "}
          {overflowMedian > 0 ? tr("col.moreOverflow", { x: fmt(overflowMedian) }) : tx("col.noOverflow")}{" "}
          {tx("col.backlog", { kg: fmt(cmp.extraBacklogKgB?.median ?? 0) })}
        </p>
      </Card>

      <RoutesCard r={r} profile={profile} />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3"><ComparisonTable r={r} profile={profile} cmp={cmp} /></div>
        <div className="lg:col-span-2"><WeeklyChart r={r} profile={profile} /></div>
      </div>

      <BenchmarkCard r={r} profile={profile} costs={costs} />

      <BreakevenCard r={r} profile={profile} costs={costs} means={means} />
      <p className="text-xs text-muted">
        {tr("col.note", { b: (c) => <span className="font-medium" style={{ color: t["ink-2"] }}>{c}</span> })}
      </p>
    </div>
  );
}

function SavingTile({ label, r, badges }: { label: string; r: Range | null; badges: BadgeKind[] }) {
  const f = fmtRange(r, (x) => signedPct(x));
  const m = r?.median ?? 0;
  return (
    <StatTile label={label} badges={badges}
              value={<span>{r ? (m > 0 ? tx("col.lower", { x: fmt(m, 1) }) : m < 0 ? tx("col.higher", { x: fmt(-m, 1) }) : tx("col.noChange")) : tx("common.na")}</span>}
              sub={r ? tx("col.rangeSub", { r: f.range }) : undefined} />
  );
}

function ComparisonTable({ r, profile, cmp }: { r: Results; profile: string; cmp: ReturnType<typeof compareScenarios> }) {
  const t = useTokens();
  const { A, B } = r.scenarios[profile];
  const rows: { label: string; a: Range | null; b: Range | null; f: (x: number) => string; lowerBetter?: boolean }[] = [
    { label: tx("row.cost"), a: cmp.costA, b: cmp.costB, f: (x) => eur(x) },
    { label: tx("row.tonne"), a: cmp.perTonneA, b: cmp.perTonneB, f: (x) => eur(x) },
    { label: tx("row.km"), a: A.summary.km, b: B.summary.km, f: (x) => fmt(x) },
    { label: tx("row.crew"), a: A.summary.crew_h, b: B.summary.crew_h, f: (x) => fmt(x, 1) },
    { label: tx("row.stops"), a: A.summary.stops, b: B.summary.stops, f: (x) => fmt(x) },
    { label: tx("row.truckDays"), a: A.summary.truck_days, b: B.summary.truck_days, f: (x) => fmt(x) },
    { label: tx("row.kg"), a: A.summary.kg, b: B.summary.kg, f: (x) => fmt(x) },
    { label: tx("row.overflow"), a: A.summary.overflow_container_days, b: B.summary.overflow_container_days, f: (x) => fmt(x) },
    { label: tx("row.backlog"), a: A.summary.end_backlog_kg, b: B.summary.end_backlog_kg, f: (x) => fmt(x) },
  ];
  return (
    <Card title={tx("col.totals")} subtitle={tx("col.totalsSub")}>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-start text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 font-medium">{tx("col.metric")}</th>
              <th className="py-2 font-medium"><Key color={t["series-a"]} />{tx("common.aFixedWeekly")}</th>
              <th className="py-2 font-medium"><Key color={t["series-b"]} />{tx("common.bDemand")}</th>
              <th className="w-[22%] py-2 font-medium"><span className="sr-only">{tx("common.comparisonBars")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const a = fmtRange(row.a, row.f);
              const b = fmtRange(row.b, row.f);
              return (
                <tr key={row.label} className="border-t border-line align-top">
                  <td className="py-2 pe-3 text-ink-2">{row.label}</td>
                  <td className="py-2 pe-3"><span className="font-medium text-ink">{a.median}</span><div className="text-xs text-muted">{a.range}</div></td>
                  <td className="py-2 pe-3"><span className="font-medium text-ink">{b.median}</span><div className="text-xs text-muted">{b.range}</div></td>
                  <td className="py-3"><PairBars a={row.a?.median} b={row.b?.median} colourA={t["series-a"]} colourB={t["series-b"]} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const Key = ({ color }: { color: string }) => (
  <span className="me-1.5 inline-block h-2.5 w-2.5 rounded-full align-[-1px]" style={{ background: color }} aria-hidden />
);

function WeeklyChart({ r, profile }: { r: Results; profile: string }) {
  const t = useTokens();
  const { A, B } = r.scenarios[profile];
  const data = A.per_seed[0].weeks.map((_, w) => ({
    week: tx("common.week", { n: w + 1 }),
    A: median(A.per_seed.map((s) => s.weeks[w].km)),
    B: median(B.per_seed.map((s) => s.weeks[w].km)),
  }));
  return (
    <Card title={tx("col.weekly")} subtitle={tx("col.weeklySub")}>
      <div style={{ height: 300 }} dir="ltr">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
            <CartesianGrid stroke={t.grid} vertical={false} />
            <XAxis dataKey="week" tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false} />
            <YAxis tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false} />
            <Tooltip cursor={{ fill: t["surface-2"] }} formatter={(v, name) => [tx("common.km", { x: fmt(Number(v), 1) }), name === "A" ? tx("common.aFixed") : tx("common.bDemand")]}
                     contentStyle={{ background: t.surface, border: `1px solid ${t.grid}`, color: t.ink }} />
            <Legend formatter={(v) => <span style={{ color: t["ink-2"] }}>{v === "A" ? tx("common.aFixedWeekly") : tx("common.bDemand")}</span>} />
            <Bar dataKey="A" fill={t["series-a"]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="B" fill={t["series-b"]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-ink-2">{tx("common.tableView")}</summary>
        <table className="tabular mt-2 w-full text-start text-xs">
          <thead className="text-muted"><tr><th className="py-1">{tx("col.weekTh")}</th><th>A (km)</th><th>B (km)</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.week} className="border-t border-line"><td className="py-1">{d.week}</td><td>{fmt(d.A, 1)}</td><td>{fmt(d.B, 1)}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </Card>
  );
}

function RoutesCard({ r, profile }: { r: Results; profile: string }) {
  const t = useTokens();
  const [scenario, setScenario] = useState<"A" | "B">("A");
  const [week, setWeek] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const runs = r.scenarios[profile][scenario].per_seed;
  const [seedIdx, setSeedIdx] = useState(0);
  const run = runs[Math.min(seedIdx, runs.length - 1)];
  const wk = run.weeks[Math.min(week, run.weeks.length) - 1];
  const color = scenario === "A" ? t["series-a"] : t["series-b"];
  const { lang } = useLang();
  const pts = useMemo(() => collectionPoints(r), [r, lang]);
  const ids = useMemo(() => pts.map((p) => p.id), [pts]);
  const props = useMemo(() => new Map([...r.network.containers.features, ...r.network.candidates.features]
    .map((f) => [f.properties.id, f.properties])), [r]);
  const proposed = useMemo(() => new Set(r.meta.collection_network?.proposed ?? []), [r]);

  const weave = useMemo(() => { try { return collectionWeave(run, ids); } catch { return null; } }, [run, ids]);
  const order = useMemo(() => (weave ? sharedOrder(weave) : ids), [weave, ids]);

  // Where is each stop this week: truck-day and position (from the simulated route).
  const position = useMemo(() => {
    const m = new Map<string, { truck: number; pos: number; of: number }>();
    wk.routes.forEach((x, i) => x.stop_ids.forEach((id, k) => m.set(id, { truck: i + 1, pos: k + 1, of: x.stop_ids.length })));
    return m;
  }, [wk]);

  const tooltip = (id: string) => {
    const p = props.get(id);
    const where = position.get(id);
    const weeks = run.weeks.filter((w) => w.routes.some((x) => x.stop_ids.includes(id))).map((w) => tx("common.weekShort", { n: w.week }));
    return `<div class="tt-id">${id}</div><b>${td(p?.name ?? id)}</b>${proposed.has(id) ? ` · <i>${tx("rt.proposedSite")}</i>` : ""}` +
      `<br>${p?.site_type ? td(p.site_type) : tx("rt.tipType")} · ${tx("rt.tipCapacity", { c: p?.capacity_kg ? `${fmt(p.capacity_kg)} kg` : tx("rt.tipDefault") })}` +
      `<br>${where ? tx("rt.tipWhere", { t: where.truck, p: where.pos, o: where.of }) : tx("rt.tipNot")}` +
      `<br>${tx("rt.tipRun", { s: run.seed, weeks: weeks.length ? weeks.join(" · ") : tx("rt.tipNone") })}`;
  };

  const { layers, routes, approx } = useMemo(() => {
    const at = new Map(pts.map((p) => [p.id, [p.lat, p.lon] as [number, number]]));
    const d = r.network.depot;
    const depot: [number, number] = [d.lat, d.lon];
    const served = new Set(wk.routes.flatMap((x) => x.stop_ids));
    const approx: string[] = [];
    const routes: RouteLine[] = wk.routes.map((x, i) => {
      const drawing = routeDrawing(x.stop_ids, at, depot, r.route_geometry ?? null);
      if (drawing.approximate) approx.push(drawing.reason ?? "no road geometry");
      return {
        color, coords: drawing.coords, dashed: drawing.approximate,
        label: tx("rt.routeLabel", { i: i + 1, n: x.stop_ids.length, km: fmt(x.km, 1), kg: fmt(x.kg) }) +
          (drawing.approximate ? `<br><i>${tx("rt.routeApprox")}</i>` : ""),
      };
    });
    const withLabel = (list: typeof pts) => list.map((p) => ({ ...p, label: tooltip(p.id) }));
    const layers: PointLayer[] = [
      { name: tx("rt.layerNot"), points: withLabel(pts.filter((p) => !served.has(p.id))), color: t.candidate, radius: 4.5, hollow: true, key: "idle", selectable: true },
      { name: tx("rt.layerCollected"), points: withLabel(pts.filter((p) => served.has(p.id))), color, radius: 5.5, key: "served", selectable: true },
      { name: tx("rt.layerDepot"), points: [{ id: d.id, lat: d.lat, lon: d.lon, label: `<b>${td(d.name)}</b>` }], color: MAP_INK, radius: 6, square: true },
    ];
    return { layers, routes, approx };
  }, [r, wk, color, t, pts, position, run, lang]);

  const sel = selected ? { id: selected, p: props.get(selected), where: position.get(selected),
    weeks: run.weeks.filter((w) => w.routes.some((x) => x.stop_ids.includes(selected))).map((w) => w.week) } : null;

  return (
    <section className="panel overflow-hidden" aria-labelledby="routes-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="eyebrow">{tx("rt.eyebrow", { s: run.seed, n: runs.length })}</p>
          <h2 id="routes-title" className="mt-1 text-lg font-semibold text-ink">{tx("rt.title")}</h2>
          <p className="mt-0.5 text-sm text-ink-2">{tx("rt.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented label={tx("common.scenario")} value={scenario} onChange={setScenario} options={[{ value: "A", label: "A" }, { value: "B", label: "B" }]} />
          <Segmented label={tx("rt.week")} value={week} onChange={setWeek} options={run.weeks.map((w) => ({ value: w.week, label: tx("common.weekShort", { n: w.week }) }))} />
          <select aria-label={tx("rt.run")} value={seedIdx} onChange={(e) => setSeedIdx(Number(e.target.value))}
                  className="h-9 rounded-[var(--r-pill)] border border-line-strong bg-surface px-3 text-sm text-ink transition-colors duration-[var(--dur-1)] hover:border-ink">
            {runs.map((s, i) => <option key={s.seed} value={i}>{tx("rt.runN", { n: s.seed })}</option>)}
          </select>
        </div>
      </div>
      <div className="grid lg:grid-cols-[1.7fr_1fr]">
        <div className="p-4 sm:p-5">
          {wk.stops === 0 && (
            <div className="mb-3"><Empty>{tx("rt.empty", { w: wk.week, t: fmt(r.meta.threshold_T * 100) })}</Empty></div>
          )}
          <MapView boundary={r.network.boundary} layers={layers} routes={routes} height={440} selectedId={selected} onSelect={setSelected}
                   drawKey={`${scenario}-${week}-${run.seed}`} label={tx("rt.mapAria", { w: wk.week, s: scenario })} trucks />
          <MapLegend items={[
            { color, label: tx("rt.legendRoute", { s: scenario }), line: true },
            ...(approx.length ? [{ color, label: tx("rt.legendApprox"), line: true, dashed: true }] : []),
            { color, label: tx("rt.legendCollected") },
            { color: t.candidate, label: tx("rt.legendNot"), hollow: true },
            { color: t.ink, label: tx("rt.legendDepot"), square: true },
          ]} />
          <div className="mt-2">
            <span className="text-xs text-muted">{tx("rt.marker")}</span>
          </div>
          <p className="mt-2 text-xs text-muted">
            {wk.routes.length === 0 ? null : approx.length === 0
              ? tx("rt.street")
              : tx(plural("rt.approx", wk.routes.length), { a: approx.length, n: wk.routes.length, why: [...new Set(approx)].join("; ") })}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {tr(plural("rt.summary", wk.truck_days), { stops: wk.stops, km: fmt(wk.km, 1), td: wk.truck_days, kg: fmt(wk.kg), o: wk.overflow_container_days })}
          </p>
        </div>
        <aside className="flex flex-col gap-5 border-t border-line bg-surface-2/40 p-4 sm:p-5 lg:border-s lg:border-t-0" aria-label={tx("rt.aside")}>
          <div>
            <p className="eyebrow">{tx("rt.calendar", { s: scenario })}</p>
            <p className="mt-1 text-xs text-ink-2">{tx("rt.calendarSub")}</p>
            <div className="mt-3">
              {weave ? <WeaveGrid weave={weave} order={order} colour={color} label={tx("rt.weaveLabel", { s: scenario, r: run.seed })}
                                  compact highlightWeek={wk.week} highlightId={selected} />
                : <Empty>{tx("rt.calendarNone")}</Empty>}
            </div>
          </div>
          <div aria-live="polite">
            <p className="eyebrow">{tx("rt.selected")}</p>
            {sel ? (
              <div className="seam mt-2 rounded-[var(--r-sm)] bg-surface p-3 text-sm">
                <p className="mono text-[11px] text-muted">{sel.id}</p>
                <p className="font-medium text-ink">{td(sel.p?.name ?? sel.id)}{proposed.has(sel.id) && <span className="ms-1 text-xs text-ink-2">· {tx("rt.proposedSite")}</span>}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                  <dt className="text-muted">{tx("rt.type")}</dt><dd className="text-ink">{sel.p?.site_type ? td(sel.p.site_type) : tx("rt.notRecorded")}</dd>
                  <dt className="text-muted">{tx("rt.capacity")}</dt><dd className="text-ink tabular">{sel.p?.capacity_kg ? `${fmt(sel.p.capacity_kg)} kg` : tx("rt.kgAssumed", { kg: fmt(Number(r.assumptions.find((a) => a.key === "container_capacity_kg")?.value ?? 0)) })}</dd>
                  <dt className="text-muted">{tx("rt.thisWeek")}</dt><dd className="text-ink">{sel.where ? tx("rt.position", { t: sel.where.truck, p: sel.where.pos, o: sel.where.of }) : tx("rt.notCollected")}</dd>
                  <dt className="text-muted">{tx("rt.weeksCollected")}</dt><dd className="text-ink">{sel.weeks.length ? sel.weeks.map((w) => tx("common.weekShort", { n: w })).join(" · ") : tx("rt.noneInRun")}</dd>
                  <dt className="text-muted">{tx("rt.fill")}</dt><dd className="text-ink-2">{tx("rt.fillNote")}</dd>
                </dl>
                <button type="button" className="mt-2 text-xs text-ink-2 underline" onClick={() => setSelected(null)}>{tx("rt.clear")}</button>
              </div>
            ) : <p className="mt-2 text-sm text-ink-2">{tx("rt.pick")}</p>}
          </div>
          <div>
            <p className="eyebrow">{tx("rt.truckDays")}</p>
            {wk.routes.length === 0 ? <p className="mt-2 text-sm text-ink-2">{tx("rt.none")}</p> : (
              <ol className="mt-2 flex flex-col gap-3">
                {wk.routes.map((x, i) => (
                  <li key={i}>
                    <p className="text-[13px] text-ink"><b>{tx("rt.truckDay", { i: i + 1 })}</b> <span className="text-ink-2">{tx("rt.truckDayInfo", { n: x.stop_ids.length, km: fmt(x.km, 1), kg: fmt(x.kg) })}</span></p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {x.stop_ids.map((id, k) => (
                        <button key={id} type="button" onClick={() => setSelected(selected === id ? null : id)} aria-pressed={selected === id}
                                title={td(props.get(id)?.name ?? id)}
                                className={`mono rounded-[var(--r-xs)] border px-1.5 py-0.5 text-[10.5px] transition-colors duration-[var(--dur-1)] ${
                                  selected === id ? "border-ink bg-ink text-page" : "border-line bg-surface text-ink-2 hover:border-ink hover:text-ink"}`}>
                          {k + 1}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function BreakevenCard({ r, profile, costs, means }: { r: Results; profile: string; costs: CostParams; means: Record<string, number> }) {
  const t = useTokens();
  const [perTonne, setPerTonne] = useState(false);
  const curve = useMemo(() => breakevenCurve(r.breakeven.points, costs, perTonne), [r, costs, perTonne]);
  const data = curve.map((c) => ({
    fill: Math.round(c.fill * 100), median: c.saving?.median ?? null,
    band: c.saving ? [c.saving.min, c.saving.max] : null, overflow: c.extraOverflow?.median ?? 0, range: c.saving,
  }));
  const yMin = Math.floor(Math.min(0, ...data.map((d) => (d.band ? d.band[0] : 0))) / 10) * 10;
  const yMax = Math.ceil(Math.max(0, ...data.map((d) => (d.band ? d.band[1] : 0))) / 10) * 10;
  const yStep = yMax - yMin > 60 ? 20 : 10;
  const yTicks = Array.from({ length: Math.floor((yMax - yMin) / yStep) + 1 }, (_, i) => yMin + i * yStep);
  if (!yTicks.includes(0)) yTicks.push(0);
  const current = (means[profile] ?? 0) * 100;

  return (
    <Card title={tx("be.title")}
          subtitle={tx(perTonne ? "be.subTonne" : "be.subCost")}
          actions={<Segmented label={tx("be.measure")} value={perTonne ? "t" : "c"} onChange={(v) => setPerTonne(v === "t")}
                              options={[{ value: "c", label: tx("be.total") }, { value: "t", label: tx("be.perTonne") }]} />}>
      <div style={{ height: 300 }} dir="ltr">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: -8 }}>
            <CartesianGrid stroke={t.grid} vertical={false} />
            <XAxis dataKey="fill" type="number" domain={["dataMin", "dataMax"]} unit="%" tick={{ fill: t.muted, fontSize: 12 }}
                   stroke={t.axis} tickLine={false} ticks={data.map((d) => d.fill)} />
            <YAxis unit="%" tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false}
                   domain={[yMin, yMax]} ticks={yTicks.sort((a, b) => a - b)} />
            <ReferenceLine y={0} stroke={t.axis} strokeWidth={1.5} />
            <ReferenceLine x={current} stroke={t["ink-2"]}
                           label={{ value: tx("be.profile", { p: tOr(`profile.${profile}`, profile) }), position: "insideTopRight", fill: t["ink-2"], fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: t.surface, border: `1px solid ${t.grid}`, color: t.ink }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded border border-line bg-surface p-2 text-xs text-ink">
                    <div className="font-medium">{tx("be.tipFill", { x: fmt(d.fill) })}</div>
                    {d.range && <div>{tx("be.tipSaves", { m: signedPct(d.range.median), min: signedPct(d.range.min), max: signedPct(d.range.max) })}</div>}
                    <div className="text-ink-2">{tx("be.tipOverflow", { x: `${d.overflow > 0 ? "+" : ""}${fmt(d.overflow)}` })}</div>
                  </div>
                );
              }} />
            <Area dataKey="band" stroke="none" fill={t["series-b"]} fillOpacity={0.12} isAnimationActive={false} />
            <Line dataKey="median" stroke={t["series-b"]} strokeWidth={2} dot={{ r: 4, fill: t["series-b"], stroke: t.surface, strokeWidth: 2 }}
                  isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {r.breakeven.monotonicity_violations.length > 0 && (
        <p className="mt-1 text-xs text-ink-2">
          {tx("be.check", { n: r.breakeven.monotonicity_violations.length })}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {resultBadges(r).map((b) => <Badge key={b} kind={b} />)}
        <span className="text-xs text-muted">
          {tx("be.vitrus")}
        </span>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-2">{tx("common.tableView")}</summary>
        <table className="tabular mt-2 w-full text-start text-xs">
          <thead className="text-muted"><tr><th className="py-1">{tx("be.thFill")}</th><th>{tx("be.thSaving")}</th><th>{tx("be.thRange")}</th><th>{tx("be.thOverflow")}</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.fill} className="border-t border-line">
              <td className="py-1">{fmt(d.fill)}%</td><td>{d.range ? signedPct(d.range.median) : tx("common.na")}</td>
              <td>{d.range ? tx("common.range", { min: signedPct(d.range.min), max: signedPct(d.range.max) }) : ""}</td><td>{fmt(d.overflow)}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>
    </Card>
  );
}
