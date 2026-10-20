import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { MAP_FOREST, MAP_INK, MapLegend, MapView, type PointLayer } from "../components/MapView";
import { Card, Empty, StatTile } from "../components/StatTile";
import { fmt, pct } from "../lib/format";
import { t as tx, useLang } from "../lib/i18n";
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
  const { lang } = useLang();

  const layers = useMemo<PointLayer[]>(() => {
    const cands = toPoints(r.network.candidates);
    return [
      { name: tx("cov.layerCandidate"), points: cands.filter((p) => !proposed.has(p.id)), color: t.candidate, radius: 3.5, hollow: true, key: "candidate" },
      { name: tx("cov.layerExisting"), points: toPoints(r.network.containers), color: MAP_INK, radius: 5.5, coverRadiusM: cov.radius_m, key: "existing" },
      { name: tx("cov.layerProposed", { n }), points: cands.filter((p) => proposed.has(p.id)), color: MAP_FOREST, radius: 6, coverRadiusM: cov.radius_m, key: "proposed" },
    ];
  }, [n, r, t, lang]);

  const yTop = Math.ceil((cov.all_candidates.share * 100) / 10) * 10;
  const chartData = cov.additions.map((a) => ({ n: a.n_new, share: a.share * 100 }));
  const notNested = cov.additions.filter((a) => a.n_new > 0 && !a.nested).map((a) => a.n_new);

  if (maxN < 1) return <Empty>{tx("cov.empty")}</Empty>;

  return (
    <div className="flex flex-col gap-4">
      <Card title={tx("cov.card")} subtitle={tx("cov.cardSub", { r: fmt(cov.radius_m) })}>
        <label className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
          <span>{tx("cov.add")}</span>
          <input type="range" min={0} max={maxN} value={n} onChange={(e) => setN(Number(e.target.value))}
                 className="w-56 max-w-full" aria-valuetext={tx("cov.addValue", { n })} />
          <span className="tabular w-10 text-lg font-semibold text-ink">+{n}</span>
        </label>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={tx("cov.covered")} value={pct(step.share)}
                  sub={tx("cov.coveredSub", { p: fmt(step.covered_pop), delta: n ? tx("cov.vsToday", { x: fmt((step.share - cov.existing.share) * 100, 1) }) : tx("cov.today") })}
                  badges={n ? whatIf : today} />
        <StatTile label={n ? tx("cov.gainN", { n }) : tx("cov.gainNext")}
                  value={pct(n ? step.marginal_share : cov.additions[1].marginal_share)}
                  sub={tx("cov.gainSub")} badges={whatIf} />
        <StatTile label={tx("cov.existingOnly")} value={pct(cov.existing.share)} sub={tx("cov.points", { n: cov.existing.sites.length })} badges={today} />
        <StatTile label={tx("cov.ceiling")} value={pct(cov.all_candidates.share)}
                  sub={tx("cov.candidates", { n: r.network.candidates.features.length })} badges={whatIf} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title={tx("cov.map")} subtitle={tx("cov.mapSub", { r: fmt(cov.radius_m) })}>
            <MapView boundary={r.network.boundary} layers={layers} />
            <MapLegend items={[
              { color: t.ink, label: tx("cov.legendExisting") },
              { color: t.accent, label: tx("cov.legendProposed", { n }) },
              { color: t.candidate, label: tx("cov.legendOther"), hollow: true },
            ]} />
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card title={tx("cov.chart")} subtitle={tx("cov.chartSub")}>
            <div style={{ height: 260 }} dir="ltr">
              <ResponsiveContainer>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
                  <CartesianGrid stroke={t.grid} vertical={false} />
                  <XAxis dataKey="n" tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false}
                         label={{ value: tx("cov.axis"), position: "insideBottomRight", offset: -2, fill: t.muted, fontSize: 12 }} />
                  <YAxis tick={{ fill: t.muted, fontSize: 12 }} stroke={t.axis} tickLine={false} unit="%"
                         domain={[0, yTop]} ticks={Array.from({ length: yTop / 10 + 1 }, (_, i) => i * 10)} />
                  <ReferenceLine y={cov.all_candidates.share * 100} stroke={t.axis}
                                 label={{ value: tx("cov.every"), position: "insideTopLeft", fill: t.muted, fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${fmt(Number(v), 1)}%`, tx("cov.tooltip")]} labelFormatter={(l) => tx("cov.tooltipLabel", { n: String(l) })}
                           contentStyle={{ background: t.surface, border: `1px solid ${t.grid}`, color: t.ink }} />
                  <Line type="monotone" dataKey="share" stroke={t.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <ReferenceDot x={n} y={step.share * 100} r={5} fill={t.accent} stroke={t.surface} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {notNested.length > 0 && (
              <p className="mt-2 text-xs text-ink-2">
                {tx("cov.notNested", { list: notNested.join(", +") })}
              </p>
            )}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-ink-2">{tx("common.tableView")}</summary>
              <table className="tabular mt-2 w-full text-start text-xs">
                <thead className="text-muted"><tr><th className="py-1">{tx("cov.thNew")}</th><th>{tx("cov.thCovered")}</th><th>{tx("cov.thGain")}</th><th>{tx("cov.thSites")}</th></tr></thead>
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
