"""S2 tests: nearest-stop baseline, improvement maths, equivalence with the optimised runs."""

import copy
import math

import pytest

from pipeline import benchmark, cost, export, load, matrix, simulate, synthetic
from pipeline.solve import Fleet, InfeasibleError, solve_day

from test_solve import KG, fleet, line_matrix, random_matrix


# ---------------------------------------------------------------- improvement maths

@pytest.mark.parametrize("baseline,optimised,expected", [
    (100, 80, 20.0),        # optimised better
    (100, 100, 0.0),        # identical
    (100, 110, -10.0),      # optimised worse: negative, never clamped
    (0, 0, None),           # zero baseline: unavailable, not inf/NaN
    (0, 5, None),
    (None, 5, None),        # missing data
    (100, None, None),
    (float("nan"), 5, None),
    (float("inf"), 5, None),
])
def test_improvement_percent(baseline, optimised, expected):
    got = benchmark.improvement_percent(baseline, optimised)
    assert got == (pytest.approx(expected) if expected is not None else None)


# ---------------------------------------------------------------- baseline solver

def test_baseline_is_deterministic_with_id_tie_break():
    # A and B are both 1 km from the depot in opposite directions: tie broken by id -> A first.
    d = [[0, 1000, 1000], [1000, 0, 2000], [1000, 2000, 0]]
    m = {"provider": "test", "ids": ["DEPOT", "B", "A"], "roles": ["depot", "container", "container"],
         "distances_m": d, "durations_s": [[v * 0.06 for v in row] for row in d]}
    plans = [benchmark.nearest_stop_day(m, ["B", "A"], {"A": 1, "B": 1}, fleet()) for _ in range(3)]
    assert all(p["routes"][0]["stop_ids"] == ["A", "B"] for p in plans)


def test_baseline_respects_capacity():
    kg = {"A": 600, "B": 600}
    two = benchmark.nearest_stop_day(line_matrix(), ["A", "B"], kg, fleet(vehicles=2))
    assert [r["stop_ids"] for r in two["routes"]] == [["A"], ["B"]] and all(r["kg"] <= 1000 for r in two["routes"])
    with pytest.raises(InfeasibleError, match="nearest-stop baseline could not fit"):
        benchmark.nearest_stop_day(line_matrix(), ["A", "B"], kg, fleet(vehicles=1))


def test_baseline_uses_same_rounding_as_optimiser():
    # 500.2 + 499.9 kg: rounded up per stop to 501 + 500 = 1001 > 1000, exactly as solve_day packs it.
    kg = {"A": 500.2, "B": 499.9}
    with pytest.raises(InfeasibleError):
        solve_day(line_matrix(), ["A", "B"], kg, fleet())
    with pytest.raises(InfeasibleError):
        benchmark.nearest_stop_day(line_matrix(), ["A", "B"], kg, fleet())


def test_baseline_respects_shift():
    # Each stop 4 km out (4 min) + 5 min service + 4 min back: two stops do not fit a 15-minute shift.
    m = line_matrix()
    plan = benchmark.nearest_stop_day(m, ["D", "C"], {"C": 1, "D": 1}, fleet(vehicles=2, shift_h=0.25))
    assert all(r["duration_h"] <= 0.25 for r in plan["routes"]) and plan["stops"] == 2


def test_identical_routes_give_zero_improvement():
    # On a straight road the nearest-stop order is optimal, so both strategies agree exactly.
    o = solve_day(line_matrix(), list(KG), KG, fleet())
    b = benchmark.nearest_stop_day(line_matrix(), list(KG), KG, fleet())
    assert b["km"] == o["km"] == 8.0
    assert benchmark.improvement_percent(b["km"], o["km"]) == 0.0


def test_optimised_beats_baseline_on_scattered_stops():
    m = random_matrix(30, seed=5)
    stops = m["ids"][1:]
    kg = {s: 50 for s in stops}
    o = solve_day(m, stops, kg, fleet(vehicles=3, capacity_kg=2500))
    b = benchmark.nearest_stop_day(m, stops, kg, fleet(vehicles=3, capacity_kg=2500))
    assert sorted(s for r in b["routes"] for s in r["stop_ids"]) == sorted(stops)
    assert o["km"] < b["km"]
    assert benchmark.improvement_percent(b["km"], o["km"]) > 0


def test_worse_optimised_result_is_reported_negative():
    row = benchmark.compare_run(
        {"seed": 1, "totals": {"km": 110, "travel_h": 3, "crew_h": 5, "truck_days": 2, "kg": 1000, "stops": 9,
                               "overflow_container_days": 0}},
        {"seed": 1, "totals": {"km": 100, "travel_h": 3, "crew_h": 5, "truck_days": 2, "kg": 1000, "stops": 9,
                               "overflow_container_days": 0}},
        {"cost_per_km": 1.0, "crew_cost_per_h": 0.0, "fixed_cost_per_truck_day": 0.0})
    assert row["improvement_cost_pct"] == pytest.approx(-10.0) and row["improvement_km_pct"] == pytest.approx(-10.0)


def test_missing_cost_data_makes_cost_unavailable_but_keeps_km():
    t = {"km": 100, "travel_h": 3, "crew_h": 5, "truck_days": 2, "kg": 1000, "stops": 9, "overflow_container_days": 0}
    row = benchmark.compare_run({"seed": 1, "totals": {**t, "km": 90}}, {"seed": 1, "totals": t},
                                {"cost_per_km": None, "crew_cost_per_h": 30, "fixed_cost_per_truck_day": 50})
    assert row["cost_baseline"] is None and row["improvement_cost_pct"] is None
    assert row["improvement_km_pct"] == pytest.approx(10.0)


def test_zero_baseline_cost_is_unavailable():
    zero = {"km": 0, "travel_h": 0, "crew_h": 0, "truck_days": 0, "kg": 0, "stops": 0, "overflow_container_days": 0}
    row = benchmark.compare_run({"seed": 1, "totals": zero}, {"seed": 1, "totals": zero},
                                {"cost_per_km": 0.6, "crew_cost_per_h": 30, "fixed_cost_per_truck_day": 50})
    assert row["cost_baseline"] == 0 and row["improvement_cost_pct"] is None


def test_infeasible_baseline_run_marked_invalid():
    t = {"km": 100, "travel_h": 3, "crew_h": 5, "truck_days": 2, "kg": 1000, "stops": 9, "overflow_container_days": 0}
    row = benchmark.compare_run({"seed": 1, "totals": t}, None,
                                {"cost_per_km": 0.6, "crew_cost_per_h": 30, "fixed_cost_per_truck_day": 50})
    assert row["valid"] is False and row["improvement_cost_pct"] is None


# ---------------------------------------------------------------- end to end on synthetic data

@pytest.fixture(scope="module")
def world(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("s2")
    synthetic.main(["--out", str(tmp / "raw" / "synthetic")])
    assert load.main(["--source", "synthetic", "--raw-root", str(tmp / "raw"), "--out", str(tmp / "clean")]) == 0
    clean = load.load_clean(tmp / "clean")
    a = load.load_assumptions()
    m = matrix.get_matrix(matrix.matrix_points(clean), "approx", detour_factor=1.4, speed_kmh=45, cache_dir=tmp)
    sim = simulate.simulate(clean, m, a, profiles=["low", "high"], n_seeds=2)
    return clean, m, a, sim


def test_solver_hook_leaves_existing_results_unchanged(world):
    clean, m, a, sim = world
    again = simulate.simulate(clean, m, a, profiles=["low", "high"], n_seeds=2)
    strip = lambda r: {**r, "meta": {**r["meta"], "generated_at": None}}
    assert strip(again) == strip(sim)


def test_benchmark_on_identical_inputs(world):
    clean, m, a, sim = world
    res = benchmark.run_benchmark(clean, m, a, sim, clean["containers"])
    assert res["cost_params"] == cost.cost_params(a)                      # the assumptions, not new numbers
    for profile, pol in res["scenarios"].items():
        for policy, r in pol.items():
            opt_runs = sim["scenarios"][profile][policy]["per_seed"]
            for row, opt in zip(r["per_seed"], opt_runs):
                assert row["seed"] == opt["seed"] and row["valid"]
                # Same collection decisions: identical stops, kg and overflow (asserted per week in run_benchmark too).
                for k in ("stops", "kg", "overflow_container_days"):
                    assert math.isclose(row["baseline"][k], row["optimised"][k], abs_tol=0.5)
                # Optimised totals are the existing simulation's, untouched.
                assert row["optimised"]["km"] == opt["totals"]["km"]
                # Costs recomputed from physical totals with the one cost model.
                expect = cost.operating_cost(row["baseline"]["km"], row["baseline"]["crew_h"],
                                             row["baseline"]["truck_days"], row["baseline"]["kg"], res["cost_params"])
                assert row["cost_baseline"] == pytest.approx(expect["total"])


def test_benchmark_rejects_mismatched_inputs(world):
    clean, m, a, sim = world
    bad = copy.deepcopy(sim)
    bad["scenarios"]["low"]["A"]["per_seed"][0]["inputs"] = "tampered"
    with pytest.raises(AssertionError, match="inputs differ"):
        benchmark.run_benchmark(clean, m, a, bad, clean["containers"])


def test_export_rejects_stale_benchmark(world):
    clean, m, a, sim = world
    bench = benchmark.run_benchmark(clean, m, a, sim, clean["containers"])
    bench["meta"] = {"assumptions_sha": simulate.fingerprint(a), "matrix_key": m["key"],
                     "simulation_generated_at": sim["meta"]["generated_at"]}
    assert export.optimisation_benchmark_for(sim, bench, a)["baseline"] == "nearest_stop"
    assert export.optimisation_benchmark_for(sim, None, a) is None
    stale = {**bench, "meta": {**bench["meta"], "simulation_generated_at": "earlier"}}
    with pytest.raises(export.StaleError, match="benchmark is stale"):
        export.optimisation_benchmark_for(sim, stale, a)
