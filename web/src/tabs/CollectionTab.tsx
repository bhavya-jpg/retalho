import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Badge, type BadgeKind } from "../components/Badge";
import { MAP_INK, MapLegend, MapView, type PointLayer, type RouteLine } from "../components/MapView";
import { Card, Empty, Segmented, StatTile } from "../components/StatTile";
import { breakevenCurve, compareScenarios } from "../lib/cost";
import { eur, fmt, fmtRange, signedPct } from "../lib/format";
import { median } from "../lib/stats";
import { useTokens } from "../lib/tokens";
import type { CostParams, Range, Results } from "../types";
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
    .map((p) => ({ ...p, label: `${p.label}<br><i>Proposed site</i>` }));
  return [...existing, ...planned];
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-2">Average weekly fill</span>
        <Segmented label="Fill-rate profile" value={profile} onChange={setProfile}
                   options={Object.keys(r.scenarios).map((p) => ({ value: p, label: `${p} (${fmt((means[p] ?? 0) * 100)}%)` }))} />
        <span className="text-xs text-muted">
          Figures are the median of {nSeeds} simulated runs, with the min–max range below. Same fill draws for A and B.
          {net && <> Network: {net.existing.length} existing point{net.existing.length === 1 ? "" : "s"}
            {net.n_new > 0 && <> + {net.n_new} proposed sites</>}.</>}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SavingTile label="Operating cost, B vs A" r={cmp.savingCostPct} badges={badges} />
        <SavingTile label="Cost per tonne collected, B vs A" r={cmp.savingPerTonnePct} badges={badges} />
        <SavingTile label="Distance driven, B vs A" r={cmp.savingKmPct} badges={badges} />
        <StatTile label="Extra overflow container-days in B"
                  value={`${overflowMedian > 0 ? "+" : ""}${fmt(overflowMedian)}`}
                  sub={fmtRange(cmp.extraOverflowDaysB, (x) => `${x > 0 ? "+" : ""}${fmt(x)}`).range + " over 4 weeks"}
                  badges={badges} />
      </div>

      <Card title="Reading this result">
        <p className="text-sm text-ink-2">
          {saving > 0
            ? <>Demand-based collection (B) is <b className="text-ink">{fmt(saving, 1)}% cheaper</b> than an optimised weekly round (A) in the median run at this fill level. </>
            : <>Demand-based collection (B) is <b className="text-ink">not cheaper</b> than an optimised weekly round (A) at this fill level. </>}
          {overflowMedian > 0
            ? <>But B has <b className="text-ink">more overflow</b> ({fmt(overflowMedian)} extra container-days), so it does not win outright; lowering threshold T trades cost for fewer overflows. </>
            : <>B has no more overflow than A in the median run. </>}
          B also leaves more textile in containers at the end of the four weeks
          ({fmt(cmp.extraBacklogKgB?.median ?? 0)} kg in the median run), which is why the cost-per-tonne saving is the fairer figure.
          Scenario A is an optimised fixed round, not VITRUS's actual operation.
        </p>
      </Card>

      <ComparisonTable r={r} profile={profile} cmp={cmp} />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><RoutesCard r={r} profile={profile} /></div>
        <div className="lg:col-span-2"><WeeklyChart r={r} profile={profile} /></div>
      </div>

      <BreakevenCard r={r} profile={profile} costs={costs} means={means} />
      <p className="text-xs text-muted">
        <span className="font-medium" style={{ color: t["ink-2"] }}>Note:</span> routes were optimised with the default cost
        assumptions. Changing costs on the Assumptions tab recomputes every € figure on the same routes; it does not re-route.
      </p>
    </div>
  );
}

function SavingTile({ label, r, badges }: { label: string; r: Range | null; badges: BadgeKind[] }) {
  const f = fmtRange(r, (x) => signedPct(x));
  const m = r?.median ?? 0;
  return (
    <StatTile label={label} badges={badges}
              value={<span>{r ? (m > 0 ? `${fmt(m, 1)}% lower` : m < 0 ? `${fmt(-m, 1)}% higher` : "no change") : "n/a"}</span>}
              sub={r ? `range ${f.range}` : undefined} />
  );
}

function ComparisonTable({ r, profile, cmp }: { r: Results; profile: string; cmp: ReturnType<typeof compareScenarios> }) {
  const t = useTokens();
  const { A, B } = r.scenarios[profile];
  const rows: { label: string; a: Range | null; b: Range | null; f: (x: number) => string; lowerBetter?: boolean }[] = [
    { label: "Operating cost", a: cmp.costA, b: cmp.costB, f: (x) => eur(x) },
    { label: "Cost per tonne collected", a: cmp.perTonneA, b: cmp.perTonneB, f: (x) => eur(x) },
    { label: "Distance driven (km)", a: A.summary.km, b: B.summary.km, f: (x) => fmt(x) },
    { label: "Crew hours (driving + service)", a: A.summary.crew_h, b: B.summary.crew_h, f: (x) => fmt(x, 1) },
    { label: "Collection stops", a: A.summary.stops, b: B.summary.stops, f: (x) => fmt(x) },
    { label: "Truck-days used", a: A.summary.truck_days, b: B.summary.truck_days, f: (x) => fmt(x) },
    { label: "Textile collected (kg)", a: A.summary.kg, b: B.summary.kg, f: (x) => fmt(x) },
    { label: "Overflow container-days", a: A.summary.overflow_container_days, b: B.summary.overflow_container_days, f: (x) => fmt(x) },
    { label: "Left in containers at week 4 (kg)", a: A.summary.end_backlog_kg, b: B.summary.end_backlog_kg, f: (x) => fmt(x) },
  ];
  return (
    <Card title="Four-week totals" subtitle="Median across runs, with min–max range">
      <div className="overflow-x-auto">
        <table className="tabular w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 font-medium">Metric</th>
              <th className="py-2 font-medium"><Key color={t["series-a"]} />A · fixed weekly</th>
              <th className="py-2 font-medium"><Key color={t["series-b"]} />B · demand-based</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const a = fmtRange(row.a, row.f);
              const b = fmtRange(row.b, row.f);
              return (
                <tr key={row.label} className="border-t border-line align-top">
                  <td className="py-2 pr-3 text-ink-2">{row.label}</td>
                  <td className="py-2 pr-3"><span className="font-medium text-ink">{a.median}</span><div className="text-xs text-muted">{a.range}</div></td>
                  <td className="py-2"><span className="font-medium text-ink">{b.median}</span><div className="text-xs text-muted">{b.range}</div></td>
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
  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-[-1px]" style={{ background: color }} aria-hidden />
);

function WeeklyChart({ r, profile }: { r: Results; profile: string }) {
  const t = useTokens();
  const { A, B } = r.scenarios[profile];
  const data = A.per_seed[0].weeks.map((_, w) => ({
    week: `Week ${w + 1}`,
    A: median(A.per_seed.map((s) => s.weeks[w].km)),
    B: median(B.per_seed.map((s) => s.weeks[w].km)),
  }));
  return (
    <Card title="Distance per week" subtitle="km driven, median across runs">
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
            <CartesianGrid stroke={t.grid} vertical={false} />
            <XAxis dataKey="week" tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false} />
            <YAxis tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false} />
            <Tooltip cursor={{ fill: t["surface-2"] }} formatter={(v, name) => [`${fmt(Number(v), 1)} km`, name === "A" ? "A · fixed" : "B · demand-based"]}
                     contentStyle={{ background: t.surface, border: `1px solid ${t.grid}`, color: t.ink }} />
            <Legend formatter={(v) => <span style={{ color: t["ink-2"] }}>{v === "A" ? "A · fixed weekly" : "B · demand-based"}</span>} />
            <Bar dataKey="A" fill={t["series-a"]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="B" fill={t["series-b"]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-ink-2">Table view</summary>
        <table className="tabular mt-2 w-full text-left text-xs">
          <thead className="text-muted"><tr><th className="py-1">Week</th><th>A (km)</th><th>B (km)</th></tr></thead>
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
  const runs = r.scenarios[profile][scenario].per_seed;
  const [seedIdx, setSeedIdx] = useState(0);
  const run = runs[Math.min(seedIdx, runs.length - 1)];
  const wk = run.weeks[Math.min(week, run.weeks.length) - 1];
  const color = scenario === "A" ? t["series-a"] : t["series-b"];

  const { layers, routes } = useMemo(() => {
    const pts = collectionPoints(r);
    const at = new Map(pts.map((p) => [p.id, [p.lat, p.lon] as [number, number]]));
    const d = r.network.depot;
    const depot: [number, number] = [d.lat, d.lon];
    const served = new Set(wk.routes.flatMap((x) => x.stop_ids));
    const routes: RouteLine[] = wk.routes.map((x, i) => ({
      color, coords: [depot, ...x.stop_ids.map((id) => at.get(id)!), depot],
      label: `Truck-day ${i + 1}: ${x.stop_ids.length} stops, ${fmt(x.km, 1)} km, ${fmt(x.kg)} kg`,
    }));
    const layers: PointLayer[] = [
      { name: "Not collected this week", points: pts.filter((p) => !served.has(p.id)), color: t.candidate, radius: 4, hollow: true },
      { name: "Collected this week", points: pts.filter((p) => served.has(p.id)), color, radius: 5 },
      { name: "Depot", points: [{ id: d.id, lat: d.lat, lon: d.lon, label: `<b>${d.name}</b>` }], color: MAP_INK, radius: 6, square: true },
    ];
    return { layers, routes };
  }, [r, wk, color, t]);

  return (
    <Card title="Collection routes"
          subtitle={<>Scenario {scenario}, week {wk.week}, run {run.seed} of {runs.length}. Lines join stops in visiting order (straight segments, not street geometry).</>}
          actions={
            <div className="flex flex-wrap gap-2">
              <Segmented label="Scenario" value={scenario} onChange={setScenario} options={[{ value: "A", label: "A" }, { value: "B", label: "B" }]} />
              <Segmented label="Week" value={week} onChange={setWeek}
                         options={run.weeks.map((w) => ({ value: w.week, label: `W${w.week}` }))} />
              <select aria-label="Run" value={seedIdx} onChange={(e) => setSeedIdx(Number(e.target.value))}
                      className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink">
                {runs.map((s, i) => <option key={s.seed} value={i}>Run {s.seed}</option>)}
              </select>
            </div>
          }>
      {wk.stops === 0 && (
        <div className="mb-2"><Empty>No collection in week {wk.week} of this run: no container was projected to reach the {fmt(r.meta.threshold_T * 100)}% threshold.</Empty></div>
      )}
      <MapView boundary={r.network.boundary} layers={layers} routes={routes} height={400} />
      <MapLegend items={[
        { color, label: `Route (${scenario})`, line: true },
        { color, label: "Collected this week" },
        { color: t.candidate, label: "Not collected", hollow: true },
        { color: t.ink, label: "Depot", square: true },
      ]} />
      <p className="mt-2 text-sm text-ink-2">
        This week: <b className="text-ink">{wk.stops}</b> stops, <b className="text-ink">{fmt(wk.km, 1)} km</b>,{" "}
        {wk.truck_days} truck-day{wk.truck_days === 1 ? "" : "s"}, {fmt(wk.kg)} kg, {wk.overflow_container_days} overflow container-days.
      </p>
    </Card>
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
  const metric = perTonne ? "cost per tonne" : "operating cost";

  return (
    <Card title="Break-even: when does demand-based collection pay?"
          subtitle={<>B's saving in {metric} vs A, by average weekly fill. Line: median; band: min–max across runs. Above zero, B is cheaper.</>}
          actions={<Segmented label="Saving measure" value={perTonne ? "t" : "c"} onChange={(v) => setPerTonne(v === "t")}
                              options={[{ value: "c", label: "Total cost" }, { value: "t", label: "Per tonne" }]} />}>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 12, right: 16, bottom: 8, left: -8 }}>
            <CartesianGrid stroke={t.grid} vertical={false} />
            <XAxis dataKey="fill" type="number" domain={["dataMin", "dataMax"]} unit="%" tick={{ fill: t.muted, fontSize: 12 }}
                   stroke={t.axis} tickLine={false} ticks={data.map((d) => d.fill)} />
            <YAxis unit="%" tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false}
                   domain={[yMin, yMax]} ticks={yTicks.sort((a, b) => a - b)} />
            <ReferenceLine y={0} stroke={t.axis} strokeWidth={1.5} />
            <ReferenceLine x={current} stroke={t["ink-2"]}
                           label={{ value: `${profile} profile`, position: "insideTopRight", fill: t["ink-2"], fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: t.surface, border: `1px solid ${t.grid}`, color: t.ink }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded border border-line bg-surface p-2 text-xs text-ink">
                    <div className="font-medium">Average weekly fill {fmt(d.fill)}%</div>
                    {d.range && <div>B saves {signedPct(d.range.median)} (range {signedPct(d.range.min)} to {signedPct(d.range.max)})</div>}
                    <div className="text-ink-2">Extra overflow container-days in B: {d.overflow > 0 ? "+" : ""}{fmt(d.overflow)}</div>
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
          Check: the median saving rose with fill {r.breakeven.monotonicity_violations.length} time(s), within run-to-run noise.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {resultBadges(r).map((b) => <Badge key={b} kind={b} />)}
        <span className="text-xs text-muted">
          VITRUS can place its own average fill on this axis; the claim does not depend on knowing it today.
        </span>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-2">Table view</summary>
        <table className="tabular mt-2 w-full text-left text-xs">
          <thead className="text-muted"><tr><th className="py-1">Avg weekly fill</th><th>B saving (median)</th><th>Range</th><th>Extra overflow days</th></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.fill} className="border-t border-line">
              <td className="py-1">{fmt(d.fill)}%</td><td>{d.range ? signedPct(d.range.median) : "n/a"}</td>
              <td>{d.range ? `${signedPct(d.range.min)} to ${signedPct(d.range.max)}` : ""}</td><td>{fmt(d.overflow)}</td>
            </tr>
          ))}</tbody>
        </table>
      </details>
    </Card>
  );
}
