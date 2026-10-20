import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MAP_FOREST, MAP_INK, MapLegend, MapView, type PointLayer } from "../components/MapView";
import { Card, Empty, StatTile } from "../components/StatTile";
import { fmt, pct } from "../lib/format";
import { useTokens } from "../lib/tokens";
import type { Results } from "../types";
import { dataBadges, toPoints, whatIfBadges } from "./NetworkTab";

export function CoverageTab({ r }: { r: Results }) {
  const t = useTokens();
  const cov = r.coverage;
  const maxN = cov.additions.length - 1;
  const [n, setN] = useState(Math.min(5, maxN));
  const step = cov.additions[n];
  const proposed = new Set(step.site_ids);
  const today = [...dataBadges(cov.data_source_types), "straight-line" as const];
  const whatIf = [...whatIfBadges(cov.data_source_types), "straight-line" as const];

  const layers = useMemo<PointLayer[]>(() => {
    const cands = toPoints(r.network.candidates);
    return [
      { name: "Candidate site (not chosen)", points: cands.filter((p) => !proposed.has(p.id)), color: t.candidate, radius: 3.5, hollow: true, key: "candidate" },
      { name: "Existing textile point (kept)", points: toPoints(r.network.containers), color: MAP_INK, radius: 5.5, coverRadiusM: cov.radius_m, key: "existing" },
      { name: `Proposed new point (+${n})`, points: cands.filter((p) => proposed.has(p.id)), color: MAP_FOREST, radius: 6, coverRadiusM: cov.radius_m, key: "proposed" },
    ];
  }, [n, r, t]);

  const yTop = Math.ceil((cov.all_candidates.share * 100) / 10) * 10;
  const chartData = cov.additions.map((a) => ({ n: a.n_new, share: a.share * 100 }));
  const notNested = cov.additions.filter((a) => a.n_new > 0 && !a.nested).map((a) => a.n_new);

  if (maxN < 1) return <Empty>No candidate sites in the data, so there is nothing to add.</Empty>;

  return (
    <div className="flex flex-col gap-4">
      <Card title="How many new points, and where?"
            subtitle={`Existing points are always kept. A resident counts as covered within ${fmt(cov.radius_m)} m (straight line) of a point.`}>
        <label className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
          <span>New points to add</span>
          <input type="range" min={0} max={maxN} value={n} onChange={(e) => setN(Number(e.target.value))}
                 className="w-56 max-w-full" aria-valuetext={`${n} new points`} />
          <span className="tabular w-10 text-lg font-semibold text-ink">+{n}</span>
        </label>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Residents covered" value={pct(step.share)}
                  sub={`${fmt(step.covered_pop)} people; ${n ? `+${fmt((step.share - cov.existing.share) * 100, 1)} pts vs today` : "today"}`}
                  badges={n ? whatIf : today} />
        <StatTile label={n ? `Gain from point #${n}` : "Gain from next point"}
                  value={pct(n ? step.marginal_share : cov.additions[1].marginal_share)}
                  sub="Extra share of residents covered" badges={whatIf} />
        <StatTile label="Today, existing points only" value={pct(cov.existing.share)} sub={`${cov.existing.sites.length} points`} badges={today} />
        <StatTile label="Ceiling: every candidate opened" value={pct(cov.all_candidates.share)}
                  sub={`${r.network.candidates.features.length} candidate sites`} badges={whatIf} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title="Existing and proposed points" subtitle={`Shaded circles show the ${fmt(cov.radius_m)} m catchment of each point.`}>
            <MapView boundary={r.network.boundary} layers={layers} />
            <MapLegend items={[
              { color: t.ink, label: "Existing (kept)" },
              { color: t.accent, label: `Proposed (+${n})` },
              { color: t.candidate, label: "Other candidate sites", hollow: true },
            ]} />
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title="Coverage as points are added" subtitle="Share of residents covered, by number of new points (optimal sites for each count)">
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="n" tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false}
                         label={{ value: "new points", position: "insideBottomRight", offset: -2, fill: t.muted, fontSize: 12 }} />
                  <YAxis tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false} unit="%"
                         domain={[0, yTop]} ticks={Array.from({ length: yTop / 10 + 1 }, (_, i) => i * 10)} />
                  <ReferenceLine y={cov.all_candidates.share * 100} stroke={t.axis}
                                 label={{ value: "every candidate", position: "insideTopLeft", fill: t.muted, fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${fmt(Number(v), 1)}%`, "Residents covered"]} labelFormatter={(l) => `+${l} new points`}
                           contentStyle={{ background: t.surface, border: `1px solid ${t.grid}`, color: t.ink }} />
                  <Line type="monotone" dataKey="share" stroke={t.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <ReferenceDot x={n} y={step.share * 100} r={5} fill={t.accent} stroke={t.surface} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {notNested.length > 0 && (
              <p className="mt-2 text-xs text-ink-2">
                For +{notNested.join(", +")} the optimal set swaps out a site chosen at the previous count, so sites are not
                always added one at a time.
              </p>
            )}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-ink-2">Table view</summary>
              <table className="tabular mt-2 w-full text-left text-xs">
                <thead className="text-muted"><tr><th className="py-1">New</th><th>Covered</th><th>Gain</th><th>Sites</th></tr></thead>
                <tbody>
                  {cov.additions.map((a) => (
                    <tr key={a.n_new} className="border-t border-line">
                      <td className="py-1">+{a.n_new}</td><td>{pct(a.share)}</td><td>{a.n_new ? pct(a.marginal_share) : ""}</td>
                      <td className="text-ink-2">{a.site_ids.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}
