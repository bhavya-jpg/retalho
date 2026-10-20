// S2: does Retalho's route optimisation beat a simple nearest-stop ordering on identical inputs?
import { useMemo, useState } from "react";
import { Badge } from "../components/Badge";
import { Card, Empty, Segmented } from "../components/StatTile";
import { benchmarkView, type BenchMetric } from "../lib/benchmark";
import { eur, fmt, fmtRange, signedPct } from "../lib/format";
import { useTokens } from "../lib/tokens";
import type { CostParams, Range, Results } from "../types";
import { resultBadges } from "./CollectionTab";

const ROWS: { key: BenchMetric; label: string; f: (x: number) => string; imp?: "km" | "travel_h" | "cost"; same?: boolean }[] = [
  { key: "km", label: "Distance driven (km, road)", f: (x) => fmt(x, 1), imp: "km" },
  { key: "travel_h", label: "Driving time (h)", f: (x) => fmt(x, 1), imp: "travel_h" },
  { key: "crew_h", label: "Crew hours, driving + service (h)", f: (x) => fmt(x, 1) },
  { key: "truck_days", label: "Truck-days used", f: (x) => fmt(x) },
  { key: "cost", label: "Operating cost", f: (x) => eur(x), imp: "cost" },
  { key: "stops", label: "Collection stops", f: (x) => fmt(x), same: true },
  { key: "overflow_container_days", label: "Overflow container-days", f: (x) => fmt(x), same: true },
];

function Imp({ r }: { r: Range | null }) {
  if (!r) return <span className="text-muted">unavailable</span>;
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

  if (!b || !block || !view) {
    return (
      <Card title="Optimisation value: Retalho routes vs a nearest-stop baseline">
        <Empty>The benchmark was not computed for these results. Run <code>make benchmark</code> (or <code>make all</code>).</Empty>
      </Card>
    );
  }
  const imp = view.improvement.cost;
  const changed = (["cost_per_km", "crew_cost_per_h", "fixed_cost_per_truck_day"] as const).some((k) => costs[k] !== b.cost_params[k]);
  const fleet = b.fleet;

  return (
    <Card
      title="Optimisation value: Retalho routes vs a nearest-stop baseline"
      subtitle="Same weekly stops, loads, fleet, road distances and cost assumptions. Only the visiting order and the split into truck-days differ."
      actions={<Segmented label="Scenario" value={policy} onChange={setPolicy}
                          options={[{ value: "A", label: "A · fixed" }, { value: "B", label: "B · demand-based" }]} />}>
      <p className="mb-3 text-sm text-ink-2">
        {imp === null ? <>The cost comparison is unavailable for these inputs.</>
          : imp.median > 0 ? <>Retalho&apos;s optimised routes cost <b className="text-ink">{fmt(imp.median, 1)}% less</b> than nearest-stop routes in the median run </>
          : imp.median < 0 ? <>Retalho&apos;s optimised routes cost <b className="text-critical">{fmt(-imp.median, 1)}% more</b> than nearest-stop routes in the median run </>
          : <>Retalho&apos;s optimised routes cost <b className="text-ink">the same</b> as nearest-stop routes in the median run </>}
        {imp !== null && <>(lower in {view.better}, higher in {view.worse}, equal in {view.equal} of {view.valid} runs).</>}
        {view.valid < view.runs && <> In {view.runs - view.valid} run(s) the baseline could not fit every stop into the
          available truck-days; those runs are excluded.</>}
      </p>
      <div className="overflow-x-auto">
        <table className="tabular w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 font-medium">Four-week total</th>
              <th className="py-2 font-medium"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-[-1px]" style={{ background: t.candidate }} />Nearest-stop baseline</th>
              <th className="py-2 font-medium"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-[-1px]" style={{ background: policy === "A" ? t["series-a"] : t["series-b"] }} />Retalho optimised</th>
              <th className="py-2 font-medium">Improvement (paired)</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const bl = fmtRange(view.baseline[row.key], row.f);
              const op = fmtRange(view.optimised[row.key], row.f);
              return (
                <tr key={row.key} className="border-t border-line align-top">
                  <td className="py-2 pr-3 text-ink-2">{row.label}</td>
                  <td className="py-2 pr-3"><span className="font-medium text-ink">{bl.median}</span><span className="block text-xs text-muted">{bl.range}</span></td>
                  <td className="py-2 pr-3"><span className="font-medium text-ink">{op.median}</span><span className="block text-xs text-muted">{op.range}</span></td>
                  <td className="py-2">{row.imp ? <Imp r={view.improvement[row.imp]} />
                    : row.same ? <span className="text-xs text-muted">identical by design</span> : <span className="text-xs text-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {resultBadges(r).map((x) => <Badge key={x} kind={x} />)}
        {changed && <span className="text-xs text-ink-2">Costs use your slider values, not the file values.</span>}
      </div>
      <details className="mt-3 text-sm text-ink-2">
        <summary className="cursor-pointer">How this is computed</summary>
        <div className="mt-2 flex flex-col gap-2 text-xs leading-relaxed">
          <p><b className="text-ink">Nearest-stop baseline.</b> For each truck-day in turn, start at the depot and repeatedly drive to
            the nearest unvisited stop by road distance (ties broken by stop id) that still fits the remaining capacity and leaves
            time to return within the shift; then return to the depot. It is a simple, reproducible baseline, not necessarily the
            best possible alternative.</p>
          <p><b className="text-ink">Retalho optimised.</b> The routes in every other figure on this tab: VROOM minimising
            €/km × distance + €/h × driving time + € per truck-day used, under the same capacity and shift limits.</p>
          <p><b className="text-ink">Identical inputs.</b> The four weeks are replayed with the baseline as the router, so the containers
            emptied each week, their kilograms and overflow are the same (checked in the pipeline). Fleet: {fleet.vehicles} truck-days
            per week, {fmt(fleet.capacity_kg)} kg each, {fmt(fleet.shift_h)} h shift, {fmt(fleet.service_min_per_stop)} min per stop,
            truck speed {fmt(fleet.speed_factor * 100)}% of free-flow car speed. Distances: {r.meta.distance_label}.</p>
          <p><b className="text-ink">Costs (assumptions).</b> {eur(costs.cost_per_km, 2)}/km, {eur(costs.crew_cost_per_h)}/crew-hour,
            {" "}{eur(costs.fixed_cost_per_truck_day)} per truck-day used; operating cost = km + crew hours (driving + service) + truck-days.
            Improvement = (baseline − optimised) ÷ baseline, per run, then median and range; negative means the baseline was
            cheaper; unavailable when the baseline is zero.</p>
        </div>
      </details>
    </Card>
  );
}
