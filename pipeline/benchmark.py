"""Optimisation-value benchmark: Retalho's VROOM routes vs a nearest-stop baseline (PLAN.md S2).

Baseline ("nearest stop"), deterministic:
    For each truck-day in turn, start at the depot and repeatedly drive to the nearest unvisited
    stop (by matrix road distance; ties broken by stop id) that still fits the truck's remaining
    capacity and leaves time to return to the depot within the shift. When no stop fits, return
    to the depot and start the next truck-day. Stops left after the last truck-day are unserved.

Equivalence with the optimised strategy, by construction:
    * Same weekly collection decisions: the four-week simulator is replayed with the baseline as its
      routing solver (simulate.run_scenario(..., solver=...)). Which containers are emptied never depends
      on routing, so stops, kilograms and overflow are identical; this is asserted per week.
    * Same distance matrix, truck speed factor, capacity (loads rounded up to whole kg, as for VROOM),
      shift, service time, truck-days per week, and route metrics (solve._route_metrics).
    * Same cost model (cost.operating_cost: km, crew hours and truck-days used, with the assumptions).

improvement_percent = (baseline - optimised) / baseline x 100. Positive: Retalho is better. Negative
values are kept as they are. A zero, missing or non-finite baseline gives None ("unavailable").

Usage:
    python -m pipeline.benchmark [--sim out/simulation.json] [--out out/benchmark.json]
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import time
from pathlib import Path

from pipeline.cost import COST_KEYS, operating_cost
from pipeline.load import DEFAULT_ASSUMPTIONS, DEFAULT_CLEAN, load_assumptions, load_clean
from pipeline.matrix import get_matrix, matrix_points
from pipeline.simulate import DEFAULT_OUT as DEFAULT_SIM
from pipeline.simulate import collection_network, draw_fill, fingerprint, load_coverage, run_scenario
from pipeline.solve import Fleet, InfeasibleError, _route_metrics, _truck_seconds

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "out" / "benchmark.json"
METRICS = ("km", "travel_h", "crew_h", "truck_days", "kg", "stops", "overflow_container_days")


def nearest_stop_day(m: dict, stop_ids: list[str], kg_by_id: dict[str, float], fleet: Fleet, *,
                     depot_id: str | None = None) -> dict:
    """Same inputs and output shape as solve.solve_day, routed greedily by nearest stop."""
    index = {pid: i for i, pid in enumerate(m["ids"])}
    if depot_id is None:
        depot_id = m["ids"][m["roles"].index("depot")]
    depot = index[depot_id]
    missing = [s for s in stop_ids if s not in index]
    if missing or len(set(stop_ids)) != len(stop_ids):
        raise ValueError(f"bad stops: missing {missing[:5]} or duplicates")

    cap = math.floor(fleet.capacity_kg)
    load_of = {s: math.ceil(kg_by_id[s]) for s in stop_ids}          # identical rounding to solve_day
    shift_s = round(fleet.shift_h * 3600)
    service_s = round(fleet.service_min_per_stop * 60)
    remaining = sorted(stop_ids)                                      # deterministic tie-breaking by id
    routes = []
    for truck in range(1, fleet.vehicles + 1):
        if not remaining:
            break
        pos, load, t, stops = depot, 0, 0, []
        while True:
            best = None
            for s in remaining:
                i = index[s]
                arrive = t + _truck_seconds(m, pos, i, fleet.speed_factor)
                back = arrive + service_s + _truck_seconds(m, i, depot, fleet.speed_factor)
                if load + load_of[s] <= cap and back <= shift_s:
                    d = m["distances_m"][pos][i]
                    if best is None or d < best[0]:
                        best = (d, s, arrive + service_s)
            if best is None:
                break
            _, s, t = best
            pos, load = index[s], load + load_of[s]
            stops.append(s)
            remaining.remove(s)
        if stops:
            routes.append(_route_metrics(m, depot, stops, kg_by_id, fleet, truck=truck))
    if remaining:
        raise InfeasibleError({s: "nearest-stop baseline could not fit this stop in the available truck-days"
                               for s in remaining})
    plan = {"provider": m["provider"], "routes": routes, "unassigned": {}}
    for key in ("km", "travel_h", "service_h", "duration_h", "kg"):
        plan[key] = round(sum(r[key] for r in routes), 3)
    plan["stops"] = sum(len(r["stop_ids"]) for r in routes)
    plan["vehicles_used"] = len(routes)
    return plan


def improvement_percent(baseline: float | None, optimised: float | None) -> float | None:
    """(baseline - optimised) / baseline x 100; None when it cannot be computed. Never clamped."""
    if baseline is None or optimised is None:
        return None
    if not (math.isfinite(baseline) and math.isfinite(optimised)) or baseline == 0:
        return None
    return (baseline - optimised) / baseline * 100


def _cost(totals: dict, params: dict) -> float | None:
    if any(params.get(k) is None for k in COST_KEYS):
        return None
    return operating_cost(totals["km"], totals["crew_h"], totals["truck_days"], totals["kg"], params)["total"]


def _range(vals: list[float | None]) -> dict | None:
    v = [x for x in vals if x is not None]
    if not v:
        return None
    return {"min": round(min(v), 2), "median": round(statistics.median(v), 2), "max": round(max(v), 2)}


def compare_run(optimised_run: dict, baseline_run: dict | None, params: dict) -> dict:
    """One seed: optimised vs baseline four-week totals. baseline_run None = baseline infeasible."""
    o = {k: optimised_run["totals"][k] for k in METRICS}
    row = {"seed": optimised_run["seed"], "optimised": o, "valid": baseline_run is not None}
    if baseline_run is None:
        row.update(baseline=None, cost_optimised=_cost(o, params), cost_baseline=None,
                   improvement_cost_pct=None, improvement_km_pct=None, improvement_travel_pct=None)
        return row
    b = {k: baseline_run["totals"][k] for k in METRICS}
    co, cb = _cost(o, params), _cost(b, params)
    row.update(baseline=b, cost_optimised=co, cost_baseline=cb,
               improvement_cost_pct=improvement_percent(cb, co),
               improvement_km_pct=improvement_percent(b["km"], o["km"]),
               improvement_travel_pct=improvement_percent(b["travel_h"], o["travel_h"]))
    return row


def run_benchmark(clean: dict, m: dict, a: dict, sim: dict, containers: list[dict]) -> dict:
    v = {k: e["value"] for k, e in a.items()}
    params = {k: v[k] for k in COST_KEYS}
    fleet = Fleet.from_assumptions(a, vehicles=int(v["trucks"]) * int(v["collection_days_per_week"]))
    profiles = v["fill_rate_profiles"]
    threshold = float(v["threshold_T"])
    weeks = int(v["horizon_weeks"])

    out = {}
    for profile, res in sim["scenarios"].items():
        out[profile] = {}
        for policy in ("A", "B"):
            rows, unserved = [], 0
            for opt in res[policy]["per_seed"]:
                draws = draw_fill(len(containers), profiles[profile], float(v["fill_weekly_cv"]), weeks,
                                  opt["seed"], profile)
                if fingerprint(m["key"], fleet.__dict__, draws["base"], draws["weekly"], draws["initial"],
                               [c["id"] for c in containers]) != opt["inputs"]:
                    raise AssertionError(f"{profile}/{policy} seed {opt['seed']}: inputs differ from the simulation")
                try:
                    base = run_scenario(policy, draws, containers, m, fleet, threshold, solver=nearest_stop_day)
                    base = {"seed": opt["seed"], **base}
                except InfeasibleError as e:
                    base, unserved = None, unserved + len(e.unassigned)
                if base is not None:
                    for wo, wb in zip(opt["weeks"], base["weeks"]):
                        so = sorted(s for r in wo["routes"] for s in r["stop_ids"])
                        sb = sorted(s for r in wb["routes"] for s in r["stop_ids"])
                        if so != sb or wo["overflow_container_days"] != wb["overflow_container_days"]:
                            raise AssertionError(f"{profile}/{policy} seed {opt['seed']} week {wo['week']}: "
                                                 "baseline and optimised served different stops")
                rows.append(compare_run(opt, base, params))
            valid = [r for r in rows if r["valid"]]
            imp = [r["improvement_cost_pct"] for r in valid]
            out[profile][policy] = {
                "per_seed": rows,
                "summary": {
                    "runs": len(rows), "valid_runs": len(valid), "baseline_unserved_stops": unserved,
                    "improvement_cost_pct": _range(imp),
                    "improvement_km_pct": _range([r["improvement_km_pct"] for r in valid]),
                    "improvement_travel_pct": _range([r["improvement_travel_pct"] for r in valid]),
                    "runs_better": sum(1 for x in imp if x is not None and x > 0),
                    "runs_worse": sum(1 for x in imp if x is not None and x < 0),
                    "runs_equal": sum(1 for x in imp if x is not None and x == 0),
                    "baseline": {k: _range([r["baseline"][k] for r in valid]) for k in METRICS},
                    "optimised": {k: _range([r["optimised"][k] for r in valid]) for k in METRICS},
                },
            }
    return {"label": "SIMULATED comparison on identical inputs; nearest-stop is a simple baseline, not the best alternative",
            "baseline": "nearest_stop", "optimised": "vroom", "cost_params": params,
            "fleet": fleet.__dict__, "scenarios": out}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Benchmark Retalho's routes against a nearest-stop baseline.")
    ap.add_argument("--sim", type=Path, default=DEFAULT_SIM)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--provider", choices=["auto", "osrm", "approx"], default="auto")
    args = ap.parse_args(argv)
    if not args.sim.exists():
        print(f"ERROR: {args.sim} not found; run `make simulate` first.", file=sys.stderr)
        return 1
    a = load_assumptions(DEFAULT_ASSUMPTIONS)
    clean = load_clean(DEFAULT_CLEAN)
    sim = json.loads(args.sim.read_text(encoding="utf-8"))
    if sim["meta"].get("assumptions_sha") != fingerprint(a):
        print("ERROR: out/simulation.json was built with different assumptions; run `make simulate`.", file=sys.stderr)
        return 1
    m = get_matrix(matrix_points(clean), sim["meta"]["distance_provider"], detour_factor=a["detour_factor"]["value"],
                   speed_kmh=a["fallback_speed_kmh"]["value"])
    containers, _ = collection_network(clean, a, load_coverage())
    t0 = time.perf_counter()
    res = run_benchmark(clean, m, a, sim, containers)
    res["meta"] = {"assumptions_sha": fingerprint(a), "matrix_key": m["key"], "simulation_generated_at": sim["meta"]["generated_at"]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(res, separators=(",", ":")) + "\n", encoding="utf-8")

    print(f"SIMULATED optimisation-value benchmark ({time.perf_counter() - t0:.1f} s): Retalho (VROOM) vs nearest-stop "
          f"baseline on identical weekly stops [data: {clean['manifest']['source']}, distances: {m['provider']}]")
    print("  improvement = (baseline - optimised) / baseline; positive = Retalho better; median (min to max) over runs")
    for profile, pol in res["scenarios"].items():
        for policy, r in pol.items():
            s = r["summary"]
            f = lambda x: "n/a" if x is None else f"{x['median']:+.1f}% ({x['min']:+.1f} to {x['max']:+.1f})"
            print(f"  {profile:<5}{policy}  cost {f(s['improvement_cost_pct'])}  km {f(s['improvement_km_pct'])}  "
                  f"better/worse/equal {s['runs_better']}/{s['runs_worse']}/{s['runs_equal']}  "
                  f"valid {s['valid_runs']}/{s['runs']}")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
