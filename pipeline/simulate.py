"""Four-week collection simulator: Scenario A (fixed) vs Scenario B (demand-based). PLAN.md M4.

Model (identical for both scenarios; every figure it produces is SIMULATED):
  * Each container c has an average weekly fill rate r_c (share of capacity), drawn once
    per (seed, profile) from a gamma distribution with the profile's mean and spread.
  * In week t it fills by r_c x w_ct, where w_ct is a gamma factor with mean 1 and
    CV fill_weekly_cv, spread evenly over the 7 days of the week.
  * Starting fill: U(0, 1) x r_c, i.e. somewhere in a weekly cycle.
  * Collection happens at the start of each week. A truck-day route empties a container
    completely, including any overflow (side bags). One VRP per week, with
    trucks x collection_days_per_week vehicles (one per truck-day).
  * Overflow container-day: a day that ends with a container above 100% capacity.

Policies:
  A  fixed          every container, every week.
  B  demand-based   container c is emptied in week t only if fill_ct + r_c >= T, i.e. its
                    projected fill would reach threshold T before the next weekly run. The
                    planner knows r_c but not this week's random factor.

Fair-comparison rules, enforced in code: same distance matrix, fleet, depot, starting fills
and fill draws for A and B (checked by fingerprint), and zero unassigned stops (solve_day
raises otherwise). Kilograms still in containers at the end of the horizon are reported
for both, so B cannot look cheaper just by postponing collection past week 4.

Usage:
    python -m pipeline.simulate [--profiles low mid high] [--seeds 10] [--out out/simulation.json]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from pipeline.load import DEFAULT_ASSUMPTIONS, DEFAULT_CLEAN, load_assumptions, load_clean
from pipeline.matrix import get_matrix, matrix_points
from pipeline.solve import Fleet, InfeasibleError, solve_day

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "out" / "simulation.json"
DAYS = 7
SUMMARY_KEYS = ["km", "travel_h", "service_h", "crew_h", "kg", "stops", "truck_days",
                "overflow_container_days", "end_backlog_kg"]


def _gamma(rng: np.random.Generator, mean: float, sd: float, size) -> np.ndarray:
    if sd <= 0:
        return np.full(size, float(mean))
    shape = (mean / sd) ** 2
    return rng.gamma(shape, sd ** 2 / mean, size=size)


def draw_fill(n_containers: int, profile: dict, weekly_cv: float, weeks: int, seed: int, profile_name: str) -> dict:
    """All randomness for one (seed, profile). Both scenarios receive exactly these arrays."""
    rng = np.random.default_rng([seed, zlib.crc32(profile_name.encode())])
    base = np.maximum(_gamma(rng, profile["mean"], profile["spread"], n_containers), 0.01)
    weekly = _gamma(rng, 1.0, weekly_cv, (weeks, n_containers))
    initial = rng.uniform(0, 1, n_containers) * base
    return {"base": base, "weekly": weekly, "initial": initial}


def fingerprint(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.tobytes() if isinstance(p, np.ndarray) else json.dumps(p, sort_keys=True, default=str).encode())
    return h.hexdigest()[:16]


def run_scenario(policy: str, draws: dict, containers: list[dict], m: dict, fleet: Fleet, threshold: float,
                 solver=solve_day) -> dict:
    """`solver` routes each week's stops; the S2 benchmark passes the nearest-stop baseline here.
    Which containers are emptied never depends on the solver, so every solver sees identical weeks."""
    ids = [c["id"] for c in containers]
    cap = np.array([c["capacity_kg"] for c in containers], dtype=float)
    base, weekly = draws["base"], draws["weekly"]
    fill = draws["initial"].copy()
    weeks_out = []
    for t in range(weekly.shape[0]):
        if policy == "A":
            collect = np.ones(len(ids), dtype=bool)
        elif policy == "B":
            collect = fill + base >= threshold
        else:
            raise ValueError(f"unknown policy {policy!r}")

        stop_ids = [ids[i] for i in np.flatnonzero(collect)]
        kg = {ids[i]: float(fill[i] * cap[i]) for i in np.flatnonzero(collect)}
        plan = solver(m, stop_ids, kg, fleet)  # raises InfeasibleError if any stop is left out
        fill[collect] = 0.0

        overflow_days = 0
        daily = base * weekly[t] / DAYS
        for _ in range(DAYS):
            fill += daily
            overflow_days += int(np.count_nonzero(fill > 1.0))

        weeks_out.append({
            "week": t + 1, "stops": plan["stops"], "km": plan["km"], "travel_h": plan["travel_h"],
            "service_h": plan["service_h"], "crew_h": round(plan["travel_h"] + plan["service_h"], 3),
            "kg": round(plan["kg"], 1), "truck_days": plan["vehicles_used"],
            "overflow_container_days": overflow_days,
            "routes": [{"truck": r["truck"], "stop_ids": r["stop_ids"], "km": r["km"],
                        "travel_h": r["travel_h"], "kg": r["kg"]} for r in plan["routes"]],
        })

    totals = {k: round(sum(w[k] for w in weeks_out), 3) for k in SUMMARY_KEYS if k != "end_backlog_kg"}
    totals["end_backlog_kg"] = round(float((fill * cap).sum()), 1)

    # Mass balance: what was in the containers at the start plus what was generated
    # must equal what was collected plus what is still there at the end.
    start_kg = float((draws["initial"] * cap).sum())
    generated_kg = float((base * weekly * cap).sum())
    collected_kg = sum(r["kg"] for w in weeks_out for r in w["routes"])
    if abs(start_kg + generated_kg - collected_kg - totals["end_backlog_kg"]) > 1.0 + 1e-6 * generated_kg:
        raise AssertionError(f"mass balance failed for policy {policy}: start {start_kg:.1f} + generated "
                             f"{generated_kg:.1f} != collected {collected_kg:.1f} + backlog {totals['end_backlog_kg']}")
    totals["generated_kg"] = round(generated_kg, 1)
    return {"weeks": weeks_out, "totals": totals}


DEFAULT_COVERAGE = ROOT / "out" / "coverage.json"


def collection_network(clean: dict, a: dict, coverage: dict | None) -> tuple[list[dict], dict]:
    """Containers to collect: the existing points plus the first collection_network_new_points
    sites proposed by the coverage optimisation (out/coverage.json, which must match these inputs)."""
    n_new = int(a["collection_network_new_points"]["value"])
    existing = clean["containers"]
    info = {"existing": [c["id"] for c in existing], "proposed": [], "n_new": 0}
    if n_new <= 0:
        return existing, info
    if coverage is None:
        raise ValueError("collection_network_new_points > 0 needs out/coverage.json; run `make coverage` first")
    if coverage.get("meta", {}).get("inputs_sha") != clean["manifest"]["inputs"]:
        raise ValueError("out/coverage.json was built from different input data; run `make coverage` first")
    by_n = {x["n_new"]: x for x in coverage["additions"]}
    if n_new not in by_n:
        raise ValueError(f"coverage has no +{n_new} solution (max +{max(by_n)}); raise coverage --max-new")
    cands = {c["id"]: c for c in clean["candidates"]}
    capacity = a["container_capacity_kg"]["value"]
    proposed = [{**cands[i], "kind": "proposed", "capacity_kg": capacity} for i in by_n[n_new]["site_ids"]]
    info.update(proposed=[p["id"] for p in proposed], n_new=n_new)
    return existing + proposed, info


def load_coverage(path: Path = DEFAULT_COVERAGE) -> dict | None:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _summary(per_seed: list[dict]) -> dict:
    out = {}
    for k in SUMMARY_KEYS:
        vals = [s["totals"][k] for s in per_seed]
        out[k] = {"min": round(min(vals), 3), "median": round(statistics.median(vals), 3), "max": round(max(vals), 3)}
    return out


def simulate(clean: dict, m: dict, a: dict, profiles: list[str] | None = None, n_seeds: int | None = None,
             progress=None, containers: list[dict] | None = None, network: dict | None = None) -> dict:
    v = {k: e["value"] for k, e in a.items()}
    all_profiles = v["fill_rate_profiles"]
    profiles = profiles or list(all_profiles)
    seeds = list(range(1, (n_seeds or int(v["seeds"])) + 1))
    weeks = int(v["horizon_weeks"])
    threshold = float(v["threshold_T"])
    containers = clean["containers"] if containers is None else containers
    network = network or {"existing": [c["id"] for c in containers], "proposed": [], "n_new": 0}
    fleet = Fleet.from_assumptions(a, vehicles=int(v["trucks"]) * int(v["collection_days_per_week"]))

    scenarios = {}
    for profile in profiles:
        res = {"A": {"per_seed": []}, "B": {"per_seed": []}}
        for seed in seeds:
            draws = draw_fill(len(containers), all_profiles[profile], float(v["fill_weekly_cv"]), weeks, seed, profile)
            inputs = {}
            for policy in ("A", "B"):
                # Fair-comparison rule: identical inputs for both policies.
                inputs[policy] = fingerprint(m["key"], fleet.__dict__, draws["base"], draws["weekly"], draws["initial"],
                                             [c["id"] for c in containers])
                run = run_scenario(policy, draws, containers, m, fleet, threshold)
                res[policy]["per_seed"].append({"seed": seed, "inputs": inputs[policy], **run})
            assert inputs["A"] == inputs["B"], "A and B received different inputs"
            if progress:
                progress(profile, seed)
        for policy in ("A", "B"):
            res[policy]["summary"] = _summary(res[policy]["per_seed"])
        scenarios[profile] = res

    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "label": "SIMULATED under the assumptions listed; not measured operations",
            "distance_provider": m["provider"], "distance_label": m["label"], "matrix_key": m["key"],
            "data_source": clean["manifest"]["source"], "seeds": seeds, "horizon_weeks": weeks,
            "threshold_T": threshold, "fleet": fleet.__dict__, "containers": len(containers),
            "assumptions_sha": fingerprint(a), "collection_network": network,
        },
        "scenarios": scenarios,
    }


def _fmt(s: dict, k: str, digits: int = 0) -> str:
    x = s[k]
    return f"{x['median']:.{digits}f} ({x['min']:.{digits}f}-{x['max']:.{digits}f})"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Simulate four weeks of Scenario A vs B.")
    ap.add_argument("--profiles", nargs="*", default=None)
    ap.add_argument("--seeds", type=int, default=None)
    ap.add_argument("--provider", choices=["auto", "osrm", "approx"], default="auto")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    a = load_assumptions(DEFAULT_ASSUMPTIONS)
    clean = load_clean(DEFAULT_CLEAN)
    m = get_matrix(matrix_points(clean), args.provider, detour_factor=a["detour_factor"]["value"],
                   speed_kmh=a["fallback_speed_kmh"]["value"])
    try:
        containers, network = collection_network(clean, a, load_coverage())
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    t0 = time.perf_counter()
    try:
        res = simulate(clean, m, a, args.profiles, args.seeds, containers=containers, network=network,
                       progress=lambda p, s: print(f"  {p} seed {s} done ({time.perf_counter() - t0:.1f} s)", file=sys.stderr))
    except InfeasibleError as e:
        print(f"ERROR: the fleet cannot serve every container in some week ({e})\nRaise trucks, truck_capacity_kg or "
              "collection_days_per_week, or lower collection_network_new_points, in config/assumptions.yaml.",
              file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(res, separators=(",", ":")) + "\n", encoding="utf-8")

    meta = res["meta"]
    print(f"SIMULATED {meta['horizon_weeks']} weeks x {len(meta['seeds'])} seeds, {meta['containers']} containers "
          f"({len(network['existing'])} existing + {network['n_new']} proposed) "
          f"[data: {meta['data_source']}, distances: {meta['distance_provider']}, T={meta['threshold_T']}] "
          f"in {time.perf_counter() - t0:.1f} s")
    print("Totals over the horizon, median (min-max) across seeds:")
    print(f"{'profile':<8}{'':3}{'km':>20}{'crew h':>18}{'stops':>16}{'truck-days':>14}{'overflow days':>16}{'backlog kg':>20}")
    for profile, res_p in res["scenarios"].items():
        for policy in ("A", "B"):
            s = res_p[policy]["summary"]
            print(f"{profile:<8}{policy:<3}{_fmt(s, 'km'):>20}{_fmt(s, 'crew_h', 1):>18}{_fmt(s, 'stops'):>16}"
                  f"{_fmt(s, 'truck_days'):>14}{_fmt(s, 'overflow_container_days'):>16}{_fmt(s, 'end_backlog_kg'):>20}")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
