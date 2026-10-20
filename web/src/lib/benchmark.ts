// S2 comparison maths, mirrored from pipeline/benchmark.py. Costs are recomputed from each run's
// physical totals with the current cost assumptions, exactly like every other € figure in the app.
import type { BenchRow, BenchTotals, CostParams, Range } from "../types";
import { operatingCost } from "./cost";
import { range } from "./stats";

/** (baseline - optimised) / baseline x 100. Positive = Retalho better; negative kept; null when undefined. */
export function improvementPercent(baseline: number | null | undefined, optimised: number | null | undefined): number | null {
  if (baseline == null || optimised == null) return null;
  if (!Number.isFinite(baseline) || !Number.isFinite(optimised) || baseline === 0) return null;
  return ((baseline - optimised) / baseline) * 100;
}

const cost = (t: BenchTotals, p: CostParams) => operatingCost(t.km, t.crew_h, t.truck_days, t.kg, p).total;

export type BenchMetric = "km" | "travel_h" | "crew_h" | "truck_days" | "cost" | "overflow_container_days" | "stops";
export type BenchView = {
  runs: number; valid: number; better: number; worse: number; equal: number;
  baseline: Record<BenchMetric, Range | null>; optimised: Record<BenchMetric, Range | null>;
  improvement: Record<"cost" | "km" | "travel_h", Range | null>;
};

export function benchmarkView(rows: BenchRow[], p: CostParams): BenchView {
  const valid = rows.filter((r): r is BenchRow & { baseline: BenchTotals } => r.valid && r.baseline !== null);
  const metric = (side: "baseline" | "optimised", k: BenchMetric) =>
    range(valid.map((r) => (k === "cost" ? cost(r[side], p) : r[side][k])));
  const keys: BenchMetric[] = ["km", "travel_h", "crew_h", "truck_days", "cost", "overflow_container_days", "stops"];
  const costImp = valid.map((r) => improvementPercent(cost(r.baseline, p), cost(r.optimised, p)));
  return {
    runs: rows.length, valid: valid.length,
    better: costImp.filter((x) => x !== null && x > 0).length,
    worse: costImp.filter((x) => x !== null && x < 0).length,
    equal: costImp.filter((x) => x === 0).length,
    baseline: Object.fromEntries(keys.map((k) => [k, metric("baseline", k)])) as BenchView["baseline"],
    optimised: Object.fromEntries(keys.map((k) => [k, metric("optimised", k)])) as BenchView["optimised"],
    improvement: {
      cost: range(costImp),
      km: range(valid.map((r) => improvementPercent(r.baseline.km, r.optimised.km))),
      travel_h: range(valid.map((r) => improvementPercent(r.baseline.travel_h, r.optimised.travel_h))),
    },
  };
}
