// S2: does Retalho's route optimisation beat a simple nearest-stop ordering on identical inputs?
import { useMemo, useState } from "react";
import { Badge } from "../components/Badge";
import { Card, Empty, PairBars, Segmented } from "../components/StatTile";
import { benchmarkView, type BenchMetric } from "../lib/benchmark";
import { eur, fmt, fmtRange, signedPct } from "../lib/format";
import { t as tx, td, tr, useLang, type Key } from "../lib/i18n";
import { useTokens } from "../lib/tokens";
import type { CostParams, Range, Results } from "../types";
import { resultBadges } from "./CollectionTab";

const ROWS: { key: BenchMetric; label: Key; f: (x: number) => string; imp?: "km" | "travel_h" | "cost"; same?: boolean }[] = [
  { key: "km", label: "bm.rowKm", f: (x) => fmt(x, 1), imp: "km" },
  { key: "travel_h", label: "bm.rowTravel", f: (x) => fmt(x, 1), imp: "travel_h" },
  { key: "crew_h", label: "bm.rowCrew", f: (x) => fmt(x, 1) },
  { key: "truck_days", label: "row.truckDays", f: (x) => fmt(x) },
  { key: "cost", label: "row.cost", f: (x) => eur(x), imp: "cost" },
  { key: "stops", label: "row.stops", f: (x) => fmt(x), same: true },
  { key: "overflow_container_days", label: "row.overflow", f: (x) => fmt(x), same: true },
];

function Imp({ r }: { r: Range | null }) {
  if (!r) return <span className="text-muted">{tx("bm.unavailableCell")}</span>;
  const f = fmtRange(r, (x) => signedPct(x));
  return (
    <span>
      <span className={`font-medium ${r.median < 0 ? "text-critical" : "text-ink"}`}>{f.median}</span>
      <span className="block text-xs text-muted">{f.range}</span>
    </span>
  );
}

export function BenchmarkCard({ r, profile, costs }: { r: Results; profile: string; costs: CostParams }) {
  const t = useTokens();
  const [policy, setPolicy] = useState<"A" | "B">("A");
  const b = r.optimisation_benchmark;
  const block = b?.scenarios[profile]?.[policy];
  const view = useMemo(() => (block ? benchmarkView(block.per_seed, costs) : null), [block, costs]);
  useLang();

  if (!b || !block || !view) {
    return (
      <Card title={tx("bm.title")}>
        <Empty>{tr("bm.missing", { code: (c) => <code>{c}</code> })}</Empty>
      </Card>
    );
  }
  const imp = view.improvement.cost;
  const changed = (["cost_per_km", "crew_cost_per_h", "fixed_cost_per_truck_day"] as const).some((k) => costs[k] !== b.cost_params[k]);
  const fleet = b.fleet;

  return (
    <Card
      title={tx("bm.title")}
      subtitle={tx("bm.sub")}
      actions={<Segmented label={tx("common.scenario")} value={policy} onChange={setPolicy}
                          options={[{ value: "A", label: tx("common.aFixed") }, { value: "B", label: tx("common.bDemand") }]} />}>
      <p className="mb-3 text-sm text-ink-2">
        {imp === null ? tx("bm.unavailable")
          : imp.median > 0 ? tr("bm.less", { x: fmt(imp.median, 1) })
          : imp.median < 0 ? tr("bm.more", { x: fmt(-imp.median, 1), b: (c) => <b className="text-critical">{c}</b> })
          : tr("bm.same")}
        {imp !== null && <> {tx("bm.counts", { better: view.better, worse: view.worse, equal: view.equal, valid: view.valid })}</>}
        {view.valid < view.runs && <> {tx("bm.excluded", { n: view.runs - view.valid })}</>}
        {" "}<span className="text-muted">{tx("bm.disclaimer")}</span>
      </p>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-start text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 font-medium">{tx("bm.thTotal")}</th>
              <th className="py-2 font-medium"><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-full align-[-1px]" style={{ background: t.baseline }} />{tx("bm.thBaseline")}</th>
              <th className="py-2 font-medium"><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-full align-[-1px]" style={{ background: policy === "A" ? t["series-a"] : t["series-b"] }} />{tx("bm.thOptimised")}</th>
              <th className="w-[16%] py-2 font-medium"><span className="sr-only">{tx("common.comparisonBars")}</span></th>
              <th className="py-2 font-medium">{tx("bm.thImprovement")}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const bl = fmtRange(view.baseline[row.key], row.f);
              const op = fmtRange(view.optimised[row.key], row.f);
              return (
                <tr key={row.key} className="border-t border-line align-top">
                  <td className="py-2 pe-3 text-ink-2">{tx(row.label)}</td>
                  <td className="py-2 pe-3"><span className="font-medium text-ink">{bl.median}</span><span className="block text-xs text-muted">{bl.range}</span></td>
                  <td className="py-2 pe-3"><span className="font-medium text-ink">{op.median}</span><span className="block text-xs text-muted">{op.range}</span></td>
                  <td className="py-3 pe-3">{row.same ? null : <PairBars a={view.baseline[row.key]?.median} b={view.optimised[row.key]?.median}
                    colourA={t.baseline} colourB={policy === "A" ? t["series-a"] : t["series-b"]} />}</td>
                  <td className="py-2">{row.imp ? <Imp r={view.improvement[row.imp]} />
                    : row.same ? <span className="text-xs text-muted">{tx("bm.identical")}</span> : <span className="text-xs text-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {resultBadges(r).map((x) => <Badge key={x} kind={x} />)}
        {changed && <span className="text-xs text-ink-2">{tx("bm.sliders")}</span>}
      </div>
      <details className="mt-3 text-sm text-ink-2">
        <summary className="cursor-pointer">{tx("bm.how")}</summary>
        <div className="mt-2 flex flex-col gap-2 text-xs leading-relaxed">
          <p>{tr("bm.howBaseline")}</p>
          <p>{tr("bm.howOptimised")}</p>
          <p>{tr("bm.howInputs", { vehicles: fleet.vehicles, cap: fmt(fleet.capacity_kg), shift: fmt(fleet.shift_h),
            service: fmt(fleet.service_min_per_stop), speed: fmt(fleet.speed_factor * 100), dist: td(r.meta.distance_label) })}</p>
          <p>{tr("bm.howCosts", { km: eur(costs.cost_per_km, 2), crew: eur(costs.crew_cost_per_h), fixed: eur(costs.fixed_cost_per_truck_day) })}</p>
        </div>
      </details>
    </Card>
  );
}
