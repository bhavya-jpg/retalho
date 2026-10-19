"""M5 acceptance tests: cost model, paired savings and break-even sweep (PLAN.md §5, M5)."""

import json
from pathlib import Path

import pytest

from pipeline import cost, load, matrix, synthetic

VECTORS = json.loads((Path(__file__).parent / "fixtures" / "cost_vectors.json").read_text())["vectors"]


@pytest.mark.parametrize("v", VECTORS, ids=[v["name"] for v in VECTORS])
def test_cost_matches_hand_computed_vectors(v):
    i = v["input"]
    got = cost.operating_cost(i["km"], i["crew_h"], i["truck_days"], i["kg"], v["params"])
    for k, expected in v["expected"].items():
        if expected is None:
            assert got[k] is None
        else:
            assert got[k] == pytest.approx(expected, abs=1e-9), k


def test_at_least_three_vectors():
    assert len(VECTORS) >= 3


def run(seed, km, crew_h, truck_days, kg, overflow=0, backlog=0.0):
    return {"seed": seed, "inputs": f"x{seed}", "totals": {"km": km, "crew_h": crew_h, "truck_days": truck_days,
            "kg": kg, "overflow_container_days": overflow, "end_backlog_kg": backlog}}


def test_compare_is_paired_and_signed():
    p = {"cost_per_km": 1.0, "crew_cost_per_h": 10.0, "fixed_cost_per_truck_day": 0.0}
    res = {"A": {"per_seed": [run(1, 100, 10, 2, 1000), run(2, 200, 10, 2, 1000)]},
           "B": {"per_seed": [run(1, 50, 5, 1, 500, overflow=3, backlog=400), run(2, 200, 10, 2, 1000)]}}
    c = cost.compare(res, p)
    # seed 1: A 200, B 100 -> 50% saving; seed 2: identical -> 0%
    assert c["saving_cost_pct"] == {"min": 0.0, "median": 25.0, "max": 50.0}
    # per tonne: seed 1 A 200/t, B 200/t -> 0%; B's backlog removes the apparent saving
    assert c["saving_cost_per_tonne_pct"]["max"] == 0.0
    assert c["extra_overflow_days_B"]["max"] == 3 and c["extra_backlog_kg_B"]["max"] == 400


def test_compare_rejects_unpaired_runs():
    res = {"A": {"per_seed": [run(1, 1, 1, 1, 1)]}, "B": {"per_seed": [run(2, 1, 1, 1, 1)]}}
    with pytest.raises(AssertionError):
        cost.compare(res, {"cost_per_km": 1, "crew_cost_per_h": 1, "fixed_cost_per_truck_day": 1})


def test_monotonicity_violation_detected():
    pts = [{"mean_weekly_fill": f, "saving_cost_pct": {"median": s}} for f, s in [(0.2, 40), (0.5, 10), (0.8, 12)]]
    v = cost.monotonicity_violations(pts)
    assert len(v) == 1 and v[0]["from_fill"] == 0.5


def test_default_sweep_has_at_least_six_values():
    assert len(cost.DEFAULT_SWEEP) >= 6 and cost.DEFAULT_SWEEP == sorted(cost.DEFAULT_SWEEP)


def test_breakeven_sweep_structure(tmp_path):
    synthetic.main(["--out", str(tmp_path / "raw" / "synthetic")])
    assert load.main(["--source", "synthetic", "--raw-root", str(tmp_path / "raw"), "--out", str(tmp_path / "clean")]) == 0
    clean = load.load_clean(tmp_path / "clean")
    a = load.load_assumptions()
    m = matrix.get_matrix(matrix.matrix_points(clean), "approx", detour_factor=1.6, speed_kmh=40, cache_dir=tmp_path)
    be = cost.breakeven_sweep(clean, m, a, [0.2, 0.6, 1.0], n_seeds=2)
    assert [p["mean_weekly_fill"] for p in be["points"]] == [0.2, 0.6, 1.0]
    for p in be["points"]:
        assert set(p["saving_cost_pct"]) == {"min", "median", "max"}
        assert len(p["per_seed"]) == 2
        # Physical totals are stored so the frontend can recompute cost from them.
        recomputed = cost.operating_cost(**p["per_seed"][0]["A"], p=be["cost_params"])
        assert recomputed["total"] > 0
    assert be["points"][0]["saving_cost_pct"]["median"] > be["points"][-1]["saving_cost_pct"]["median"]
