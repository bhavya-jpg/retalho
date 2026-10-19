import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Results } from "../types";
import { breakevenCurve, compareScenarios, operatingCost } from "./cost";
import { median, range } from "./stats";

const root = new URL("../../../", import.meta.url);
const vectors = JSON.parse(readFileSync(new URL("tests/fixtures/cost_vectors.json", root), "utf-8")).vectors;

describe("operatingCost matches the shared test vectors (Python parity)", () => {
  it.each(vectors)("$name", (v: any) => {
    const got = operatingCost(v.input.km, v.input.crew_h, v.input.truck_days, v.input.kg, v.params);
    for (const [k, expected] of Object.entries(v.expected)) {
      const value = got[k as keyof typeof got];
      if (expected === null) expect(value).toBeNull();
      else expect(Math.abs((value as number) - (expected as number))).toBeLessThan(1e-9);
    }
  });
});

describe("stats", () => {
  it("median follows Python statistics.median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("range skips nulls", () => {
    expect(range([null, 5, 1])).toEqual({ min: 1, median: 3, max: 5 });
    expect(range([null])).toBeNull();
  });
});

// Parity on the real pipeline output: the browser's savings must equal what Python computed.
const resultsPath = new URL("web/public/results.json", root);
describe.runIf(existsSync(resultsPath))("parity with pipeline results.json", () => {
  const results: Results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf-8")) : null;

  it("break-even curve recomputed in TS equals the Python sweep (default costs)", () => {
    const curve = breakevenCurve(results.breakeven.points, results.breakeven.cost_params, false);
    curve.forEach((c, i) => {
      const py = results.breakeven.points[i].saving_cost_pct!;
      // Python stores these rounded to 2 decimals.
      for (const k of ["min", "median", "max"] as const) expect(Math.abs(c.saving![k] - py[k])).toBeLessThan(0.006);
    });
  });

  it("scenario comparison runs on every profile and is paired", () => {
    for (const { A, B } of Object.values(results.scenarios)) {
      const c = compareScenarios(A, B, results.breakeven.cost_params);
      expect(c.savingCostPct).not.toBeNull();
      expect(c.costA!.min).toBeGreaterThan(0);
    }
  });
});
