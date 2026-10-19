"""Collection-point coverage: existing points, and the best +N additions (PLAN.md M6).

A resident (demand point, weighted by population) counts as covered when a textile point
lies within coverage_radius_m. Distance is STRAIGHT-LINE (great-circle) distance, a
walking proxy, labelled as such in the output. It is not a walking-route distance.

For each N = 0..Nmax, spopt's Maximal Covering Location Problem (MCLP, solved exactly with
CBC) chooses N candidate sites to add while keeping every existing point
(predefined_facilities_arr). Coverage is then recomputed here, population-weighted.
The optimal sites for N+1 need not include those for N; `nested` says whether they do.

Usage:
    python -m pipeline.coverage [--max-new 15] [--radius 500]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pulp

from pipeline.load import DEFAULT_ASSUMPTIONS, DEFAULT_CLEAN, load_assumptions, load_clean

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "out" / "coverage.json"
EARTH_RADIUS_M = 6_371_008.8


def distance_matrix_m(demand: list[dict], sites: list[dict]) -> np.ndarray:
    """Great-circle distance (m), demand x sites, vectorised."""
    lat1 = np.radians([d["lat"] for d in demand])[:, None]
    lon1 = np.radians([d["lon"] for d in demand])[:, None]
    lat2 = np.radians([s["lat"] for s in sites])[None, :]
    lon2 = np.radians([s["lon"] for s in sites])[None, :]
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(a))


def covered_population(dist: np.ndarray, pop: np.ndarray, open_sites: np.ndarray, radius: float) -> float:
    if not open_sites.any():
        return 0.0
    return float(pop[(dist[:, open_sites] <= radius).any(axis=1)].sum())


def _mclp():
    # Imported lazily: spopt pulls in a large geo stack (several seconds on first import).
    from spopt.locate import MCLP
    return MCLP


def solve_additions(dist: np.ndarray, pop: np.ndarray, existing: np.ndarray, n_new: int, radius: float) -> np.ndarray:
    """Boolean mask of open sites (existing + n_new candidates) from spopt MCLP."""
    MCLP = _mclp()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # spopt warns about unused geo options with cost matrices
        model = MCLP.from_cost_matrix(dist, pop, service_radius=radius,
                                      p_facilities=int(existing.sum()) + n_new,
                                      predefined_facilities_arr=existing, name=f"mclp_{n_new}")
        model = model.solve(pulp.PULP_CBC_CMD(msg=False))
    status = pulp.LpStatus[model.problem.status]
    if status != "Optimal":
        raise RuntimeError(f"MCLP for +{n_new} sites ended with status {status}")
    return np.array([v.value() is not None and v.value() > 0.5 for v in model.fac_vars])


def coverage_analysis(clean: dict, radius: float, max_new: int) -> dict:
    demand = clean["demand_points"]
    existing_pts, candidates = clean["containers"], clean["candidates"]
    sites = existing_pts + candidates
    site_ids = [s["id"] for s in sites]
    pop = np.array([d["population"] for d in demand], dtype=float)
    total = float(pop.sum())
    dist = distance_matrix_m(demand, sites)
    existing = np.array([True] * len(existing_pts) + [False] * len(candidates))
    max_new = min(max_new, len(candidates))

    def share(x: float) -> float:
        return round(x / total, 4) if total else 0.0

    base_pop = covered_population(dist, pop, existing, radius)
    ceiling_pop = covered_population(dist, pop, np.ones(len(sites), dtype=bool), radius)

    _mclp()  # import before timing the solves
    additions, prev_pop, prev_new = [], base_pop, set()
    for n in range(0, max_new + 1):
        t0 = time.perf_counter()
        open_mask = existing.copy() if n == 0 else solve_additions(dist, pop, existing, n, radius)
        elapsed = time.perf_counter() - t0
        if not open_mask[existing].all():
            raise AssertionError(f"+{n}: an existing point was dropped")
        new_ids = [site_ids[i] for i in np.flatnonzero(open_mask & ~existing)]
        if len(new_ids) != n:
            raise AssertionError(f"+{n}: solver opened {len(new_ids)} new sites")
        cov = covered_population(dist, pop, open_mask, radius)
        if cov + 1e-6 < prev_pop:
            raise AssertionError(f"coverage fell from {prev_pop} to {cov} going to +{n} sites")
        additions.append({
            "n_new": n, "site_ids": new_ids, "covered_pop": round(cov), "share": share(cov),
            "marginal_share": share(cov - prev_pop) if n else 0.0,
            "nested": prev_new <= set(new_ids), "solve_s": round(elapsed, 3),
        })
        prev_pop, prev_new = cov, set(new_ids)

    return {
        "label": "Straight-line distance to the nearest textile point (walking proxy)",
        "distance": "straight_line",
        "radius_m": radius,
        "population_total": round(total),
        "data_source_types": sorted({d["source_type"] for d in demand}),
        "existing": {"sites": [s["id"] for s in existing_pts], "covered_pop": round(base_pop), "share": share(base_pop)},
        "all_candidates": {"covered_pop": round(ceiling_pop), "share": share(ceiling_pop)},
        "additions": additions,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Coverage of existing points and the best +N additions (MCLP).")
    ap.add_argument("--max-new", type=int, default=15)
    ap.add_argument("--radius", type=float, default=None, help="override coverage_radius_m (metres)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    logging.getLogger("spopt").setLevel(logging.ERROR)

    a = load_assumptions(DEFAULT_ASSUMPTIONS)
    clean = load_clean(DEFAULT_CLEAN)
    radius = args.radius if args.radius is not None else float(a["coverage_radius_m"]["value"])
    t0 = time.perf_counter()
    cov = coverage_analysis(clean, radius, args.max_new)
    cov["meta"] = {"data_source": clean["manifest"]["source"], "inputs_sha": clean["manifest"]["inputs"]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(cov, indent=1) + "\n", encoding="utf-8")

    src = ", ".join(cov["data_source_types"])
    print(f"Coverage within {radius:.0f} m STRAIGHT-LINE of a textile point; population {cov['population_total']} "
          f"[{src}] ({time.perf_counter() - t0:.1f} s)")
    print(f"  existing {len(cov['existing']['sites'])} points: {cov['existing']['share']:.1%}; "
          f"ceiling with all {len(clean['candidates'])} candidates: {cov['all_candidates']['share']:.1%}")
    for x in cov["additions"][1:]:
        print(f"  +{x['n_new']:<3} {x['share']:.1%}  (+{x['marginal_share']:.1%}){'' if x['nested'] else '  [not nested]'}"
              f"  {x['solve_s']:.2f} s  {', '.join(x['site_ids'])}")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
