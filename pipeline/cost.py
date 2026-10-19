"""Operating-cost model and break-even sweep (PLAN.md M5).

    total     = km x cost_per_km + crew_h x crew_cost_per_h + truck_days x fixed_cost_per_truck_day
    per_tonne = total / (kg / 1000)                  (None when nothing was collected)

crew_h is driving plus service time. The web app reimplements operating_cost() with the
same operation order; both must reproduce tests/fixtures/cost_vectors.json.

Savings of B vs A are computed per seed (both use the same fill draws) and reported as
min / median / max across seeds. A positive saving means B is cheaper.

The break-even sweep re-runs the simulator over a range of mean weekly fill rates
(spread scaled to keep the mid profile's spread/mean ratio) and records B's saving at each.

Usage:
    python -m pipeline.cost [--sim out/simulation.json] [--sweep 0.2 0.35 ...] [--seeds 10]
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

from pipeline.load import DEFAULT_ASSUMPTIONS, DEFAULT_CLEAN, load_assumptions, load_clean
from pipeline.matrix import get_matrix, matrix_points
from pipeline.simulate import DEFAULT_OUT as DEFAULT_SIM
from pipeline.simulate import collection_network, fingerprint, load_coverage, simulate
from pipeline.solve import InfeasibleError

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BREAKEVEN = ROOT / "out" / "breakeven.json"
DEFAULT_SWEEP = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1.1]
COST_KEYS = ("cost_per_km", "crew_cost_per_h", "fixed_cost_per_truck_day")


def cost_params(a: dict) -> dict:
    return {k: a[k]["value"] for k in COST_KEYS}


def operating_cost(km: float, crew_h: float, truck_days: float, kg: float, p: dict) -> dict:
    km_cost = km * p["cost_per_km"]
    crew_cost = crew_h * p["crew_cost_per_h"]
    fixed_cost = truck_days * p["fixed_cost_per_truck_day"]
    total = km_cost + crew_cost + fixed_cost
    return {"km_cost": km_cost, "crew_cost": crew_cost, "fixed_cost": fixed_cost, "total": total,
            "per_tonne": total / (kg / 1000) if kg > 0 else None}


def run_cost(totals: dict, p: dict) -> dict:
    return operating_cost(totals["km"], totals["crew_h"], totals["truck_days"], totals["kg"], p)


def _pct_saving(a: float, b: float) -> float | None:
    return None if a == 0 else (a - b) / a * 100


def _range(vals: list[float | None]) -> dict | None:
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"min": round(min(vals), 2), "median": round(statistics.median(vals), 2), "max": round(max(vals), 2)}


def compare(profile_result: dict, p: dict) -> dict:
    """Paired (same seed) comparison of B against A for one profile."""
    rows = []
    for ra, rb in zip(profile_result["A"]["per_seed"], profile_result["B"]["per_seed"]):
        assert ra["seed"] == rb["seed"] and ra["inputs"] == rb["inputs"], "unpaired runs"
        ca, cb = run_cost(ra["totals"], p), run_cost(rb["totals"], p)
        rows.append({
            "cost_A": ca["total"], "cost_B": cb["total"],
            "per_tonne_A": ca["per_tonne"], "per_tonne_B": cb["per_tonne"],
            "saving_km_pct": _pct_saving(ra["totals"]["km"], rb["totals"]["km"]),
            "saving_cost_pct": _pct_saving(ca["total"], cb["total"]),
            "saving_cost_per_tonne_pct": (None if ca["per_tonne"] is None or cb["per_tonne"] is None
                                          else _pct_saving(ca["per_tonne"], cb["per_tonne"])),
            "extra_overflow_days_B": rb["totals"]["overflow_container_days"] - ra["totals"]["overflow_container_days"],
            "extra_backlog_kg_B": rb["totals"]["end_backlog_kg"] - ra["totals"]["end_backlog_kg"],
        })
    return {k: _range([r[k] for r in rows]) for k in rows[0]}


def breakeven_sweep(clean: dict, m: dict, a: dict, fills: list[float], n_seeds: int | None = None,
                    progress=None, containers: list[dict] | None = None) -> dict:
    profiles = a["fill_rate_profiles"]["value"]
    cv = profiles["mid"]["spread"] / profiles["mid"]["mean"]
    sweep_profiles = {f"fill_{f:.2f}": {"mean": f, "spread": round(f * cv, 4)} for f in fills}
    a_sweep = {**a, "fill_rate_profiles": {**a["fill_rate_profiles"], "value": sweep_profiles}}
    p = cost_params(a)
    points = []
    for name, prof in sweep_profiles.items():
        res = simulate(clean, m, a_sweep, profiles=[name], n_seeds=n_seeds, containers=containers)["scenarios"][name]
        cmp = compare(res, p)
        points.append({
            "mean_weekly_fill": prof["mean"], "spread": prof["spread"],
            "saving_km_pct": cmp["saving_km_pct"], "saving_cost_pct": cmp["saving_cost_pct"],
            "saving_cost_per_tonne_pct": cmp["saving_cost_per_tonne_pct"],
            "extra_overflow_days_B": cmp["extra_overflow_days_B"], "extra_backlog_kg_B": cmp["extra_backlog_kg_B"],
            # Physical totals per seed, so the web app can recompute costs when sliders move.
            "per_seed": [{"seed": ra["seed"],
                          "A": {k: ra["totals"][k] for k in ("km", "crew_h", "truck_days", "kg")},
                          "B": {k: rb["totals"][k] for k in ("km", "crew_h", "truck_days", "kg")}}
                         for ra, rb in zip(res["A"]["per_seed"], res["B"]["per_seed"])],
        })
        if progress:
            progress(prof["mean"])
    return {"points": points, "monotonicity_violations": monotonicity_violations(points),
            "spread_over_mean": round(cv, 4), "cost_params": p}


def monotonicity_violations(points: list[dict], key: str = "saving_cost_pct") -> list[dict]:
    """B's median saving should not increase as mean fill rises. Each increase is reported."""
    out = []
    for prev, cur in zip(points, points[1:]):
        if prev[key] and cur[key] and cur[key]["median"] > prev[key]["median"]:
            out.append({"from_fill": prev["mean_weekly_fill"], "to_fill": cur["mean_weekly_fill"],
                        "median_before": prev[key]["median"], "median_after": cur[key]["median"]})
    return out


def _r(x: dict | None, unit: str = "%") -> str:
    return "n/a" if x is None else f"{x['median']:+.1f}{unit} ({x['min']:+.1f} to {x['max']:+.1f})"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Cost comparison of A vs B and the break-even sweep.")
    ap.add_argument("--sim", type=Path, default=DEFAULT_SIM)
    ap.add_argument("--sweep", type=float, nargs="*", default=DEFAULT_SWEEP)
    ap.add_argument("--seeds", type=int, default=None)
    ap.add_argument("--provider", choices=["auto", "osrm", "approx"], default="auto")
    ap.add_argument("--out", type=Path, default=DEFAULT_BREAKEVEN)
    args = ap.parse_args(argv)

    a = load_assumptions(DEFAULT_ASSUMPTIONS)
    p = cost_params(a)
    if not args.sim.exists():
        print(f"ERROR: {args.sim} not found; run `make simulate` first.", file=sys.stderr)
        return 1
    sim = json.loads(args.sim.read_text(encoding="utf-8"))
    print(f"SIMULATED cost comparison, B vs A (positive = B cheaper); median (min to max) across "
          f"{len(sim['meta']['seeds'])} seeds [distances: {sim['meta']['distance_provider']}, "
          f"data: {sim['meta']['data_source']}]")
    print(f"  cost parameters (all assumptions): {p}")
    for profile, res in sim["scenarios"].items():
        c = compare(res, p)
        print(f"  {profile:<5} cost {_r(c['saving_cost_pct'])}  per tonne {_r(c['saving_cost_per_tonne_pct'])}  "
              f"km {_r(c['saving_km_pct'])}  extra overflow days {_r(c['extra_overflow_days_B'], '')}  "
              f"extra backlog {_r(c['extra_backlog_kg_B'], ' kg')}")

    clean = load_clean(DEFAULT_CLEAN)
    m = get_matrix(matrix_points(clean), args.provider, detour_factor=a["detour_factor"]["value"],
                   speed_kmh=a["fallback_speed_kmh"]["value"])
    containers, network = collection_network(clean, a, load_coverage())
    if [c["id"] for c in containers] != sim["meta"]["collection_network"]["existing"] + sim["meta"]["collection_network"]["proposed"]:
        print("ERROR: out/simulation.json used a different collection network; run `make simulate`.", file=sys.stderr)
        return 1
    t0 = time.perf_counter()
    try:
        be = breakeven_sweep(clean, m, a, args.sweep, args.seeds, containers=containers,
                             progress=lambda f: print(f"  sweep fill {f:.2f} done ({time.perf_counter() - t0:.0f} s)",
                                                      file=sys.stderr))
    except InfeasibleError as e:
        print(f"ERROR: at some sweep fill level the fleet cannot serve every container ({e})\nRaise the fleet in "
              "config/assumptions.yaml or drop the highest --sweep values.", file=sys.stderr)
        return 1
    be["meta"] = {"label": "SIMULATED", "distance_provider": m["provider"], "matrix_key": m["key"],
                  "data_source": clean["manifest"]["source"], "assumptions_sha": fingerprint(a),
                  "seeds": sim["meta"]["seeds"] if args.seeds is None else list(range(1, args.seeds + 1))}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(be, separators=(",", ":")) + "\n", encoding="utf-8")

    print(f"Break-even sweep ({time.perf_counter() - t0:.0f} s), B's saving vs mean weekly fill:")
    for pt in be["points"]:
        print(f"  fill {pt['mean_weekly_fill']:.2f}: cost {_r(pt['saving_cost_pct'])}  "
              f"per tonne {_r(pt['saving_cost_per_tonne_pct'])}  extra overflow days {_r(pt['extra_overflow_days_B'], '')}")
    if be["monotonicity_violations"]:
        print(f"  WARNING: median saving rose with fill {len(be['monotonicity_violations'])} time(s): "
              f"{be['monotonicity_violations']}")
    else:
        print("  monotonicity check: median saving never rises as fill rises (OK)")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
