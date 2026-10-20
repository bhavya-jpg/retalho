import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BenchRow, BenchTotals, Results } from "../types";
import { benchmarkView, improvementPercent } from "./benchmark";

const P = { cost_per_km: 1, crew_cost_per_h: 10, fixed_cost_per_truck_day: 0 };
const T = (km: number, crew_h = 5): BenchTotals =>
  ({ km, travel_h: crew_h / 2, crew_h, truck_days: 2, kg: 1000, stops: 9, overflow_container_days: 3 });
const row = (seed: number, opt: BenchTotals, base: BenchTotals | null): BenchRow =>
  ({ seed, valid: base !== null, optimised: opt, baseline: base, improvement_cost_pct: null });

describe("improvementPercent", () => {
  it.each([
    [100, 80, 20], [100, 100, 0], [100, 110, -10],
  ])("baseline %d, optimised %d -> %d%%", (b, o, e) => expect(improvementPercent(b, o)).toBeCloseTo(e));
  it.each([[0, 0], [0, 5], [null, 5], [100, null], [NaN, 1], [Infinity, 1]])(
    "is unavailable (null), never Infinity or NaN, for baseline %s optimised %s",
    (b, o) => expect(improvementPercent(b as number, o as number)).toBeNull(),
  );
});

describe("benchmarkView", () => {
  it("handles better, worse and identical runs without clamping", () => {
    // costs: baseline 150 vs optimised 130 (better); 150 vs 170 (worse); 150 vs 150 (equal)
    const v = benchmarkView([row(1, T(80), T(100)), row(2, T(120), T(100)), row(3, T(100), T(100))], P);
    expect([v.better, v.worse, v.equal]).toEqual([1, 1, 1]);
    expect(v.improvement.cost!.min).toBeCloseTo(-13.333, 2);
    expect(v.improvement.cost!.max).toBeCloseTo(13.333, 2);
    expect(v.improvement.cost!.median).toBe(0);
  });
  it("excludes invalid baseline runs and reports them", () => {
    const v = benchmarkView([row(1, T(80), T(100)), row(2, T(80), null)], P);
    expect(v.runs).toBe(2);
    expect(v.valid).toBe(1);
  });
  it("gives unavailable improvement when every baseline cost is zero", () => {
    const zero: BenchTotals = { km: 0, travel_h: 0, crew_h: 0, truck_days: 0, kg: 0, stops: 0, overflow_container_days: 0 };
    expect(benchmarkView([row(1, zero, zero)], P).improvement.cost).toBeNull();
  });
  it("recomputes costs when the cost assumptions change", () => {
    const rows = [row(1, T(80, 5), T(100, 5))];
    const kmOnly = benchmarkView(rows, { cost_per_km: 1, crew_cost_per_h: 0, fixed_cost_per_truck_day: 0 });
    expect(kmOnly.improvement.cost!.median).toBeCloseTo(20);
    const hoursOnly = benchmarkView(rows, { cost_per_km: 0, crew_cost_per_h: 10, fixed_cost_per_truck_day: 0 });
    expect(hoursOnly.improvement.cost!.median).toBe(0);
  });
});

const resultsPath = new URL("../../public/results.json", import.meta.url);
describe.runIf(existsSync(resultsPath))("parity with pipeline benchmark", () => {
  it("TS cost improvement equals Python's for every run (default costs)", () => {
    const r: Results = JSON.parse(readFileSync(resultsPath, "utf-8"));
    const b = r.optimisation_benchmark;
    if (!b) return;
    for (const pol of Object.values(b.scenarios)) for (const s of Object.values(pol)) for (const x of s.per_seed) {
      if (!x.valid || !x.baseline) continue;
      const ts = benchmarkView([x], b.cost_params).improvement.cost!.median;
      expect(Math.abs(ts - (x.improvement_cost_pct as number))).toBeLessThan(1e-9);
    }
  });
});
