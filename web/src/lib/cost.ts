// Cost model, mirrored from pipeline/cost.py. Same formula and operation order, so both
// produce identical doubles; both must pass tests/fixtures/cost_vectors.json.
import type { BreakevenPoint, CostParams, Physical, Range, Scenario } from "../types";
import { range } from "./stats";

export type Cost = { km_cost: number; crew_cost: number; fixed_cost: number; total: number; per_tonne: number | null };

export function operatingCost(km: number, crewH: number, truckDays: number, kg: number, p: CostParams): Cost {
  const km_cost = km * p.cost_per_km;
  const crew_cost = crewH * p.crew_cost_per_h;
  const fixed_cost = truckDays * p.fixed_cost_per_truck_day;
  const total = km_cost + crew_cost + fixed_cost;
  return { km_cost, crew_cost, fixed_cost, total, per_tonne: kg > 0 ? total / (kg / 1000) : null };
}

const physicalCost = (x: Physical, p: CostParams) => operatingCost(x.km, x.crew_h, x.truck_days, x.kg, p);
const pctSaving = (a: number, b: number) => (a === 0 ? null : ((a - b) / a) * 100);

export type Comparison = {
  costA: Range | null; costB: Range | null;
  perTonneA: Range | null; perTonneB: Range | null;
  savingCostPct: Range | null; savingPerTonnePct: Range | null; savingKmPct: Range | null;
  extraOverflowDaysB: Range | null; extraBacklogKgB: Range | null;
};

/** Paired (same seed) comparison of B against A, as pipeline/cost.py compare(). Positive = B cheaper. */
export function compareScenarios(A: Scenario, B: Scenario, p: CostParams): Comparison {
  const rows = A.per_seed.map((ra, i) => {
    const rb = B.per_seed[i];
    if (rb.seed !== ra.seed || rb.inputs !== ra.inputs) throw new Error("A and B runs are not paired");
    const ca = physicalCost(ra.totals, p);
    const cb = physicalCost(rb.totals, p);
    return {
      costA: ca.total, costB: cb.total, perTonneA: ca.per_tonne, perTonneB: cb.per_tonne,
      savingCostPct: pctSaving(ca.total, cb.total),
      savingPerTonnePct: ca.per_tonne === null || cb.per_tonne === null ? null : pctSaving(ca.per_tonne, cb.per_tonne),
      savingKmPct: pctSaving(ra.totals.km, rb.totals.km),
      extraOverflowDaysB: rb.totals.overflow_container_days - ra.totals.overflow_container_days,
      extraBacklogKgB: rb.totals.end_backlog_kg - ra.totals.end_backlog_kg,
    };
  });
  const pick = (k: keyof (typeof rows)[number]) => range(rows.map((r) => r[k]));
  return {
    costA: pick("costA"), costB: pick("costB"), perTonneA: pick("perTonneA"), perTonneB: pick("perTonneB"),
    savingCostPct: pick("savingCostPct"), savingPerTonnePct: pick("savingPerTonnePct"),
    savingKmPct: pick("savingKmPct"), extraOverflowDaysB: pick("extraOverflowDaysB"),
    extraBacklogKgB: pick("extraBacklogKgB"),
  };
}

/** Break-even curve recomputed for the current cost sliders from the stored physical totals. */
export function breakevenCurve(points: BreakevenPoint[], p: CostParams, perTonne: boolean) {
  return points.map((pt) => {
    const savings = pt.per_seed.map(({ A, B }) => {
      const a = physicalCost(A, p);
      const b = physicalCost(B, p);
      if (perTonne) return a.per_tonne === null || b.per_tonne === null ? null : pctSaving(a.per_tonne, b.per_tonne);
      return pctSaving(a.total, b.total);
    });
    return { fill: pt.mean_weekly_fill, saving: range(savings), extraOverflow: pt.extra_overflow_days_B };
  });
}
