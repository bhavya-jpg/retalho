"""M4 acceptance tests: four-week A vs B simulator (PLAN.md §5, M4)."""

import json

import numpy as np
import pytest

from pipeline import load, matrix, simulate, synthetic
from pipeline.solve import Fleet, InfeasibleError


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    """Synthetic data + approximate matrix (no OSRM needed) + the real assumptions file."""
    tmp = tmp_path_factory.mktemp("m4")
    synthetic.main(["--out", str(tmp / "raw" / "synthetic")])
    assert load.main(["--source", "synthetic", "--raw-root", str(tmp / "raw"), "--out", str(tmp / "clean")]) == 0
    clean = load.load_clean(tmp / "clean")
    a = load.load_assumptions()
    m = matrix.get_matrix(matrix.matrix_points(clean), "approx", detour_factor=1.6, speed_kmh=40, cache_dir=tmp)
    return clean, m, a


@pytest.fixture(scope="module")
def result(world):
    clean, m, a = world
    return simulate.simulate(clean, m, a, profiles=["low", "high"], n_seeds=3)


def without_timestamp(res):
    return json.dumps({**res, "meta": {**res["meta"], "generated_at": None}}, sort_keys=True)


def test_same_seed_identical_output(world, result):
    clean, m, a = world
    again = simulate.simulate(clean, m, a, profiles=["low", "high"], n_seeds=3)
    assert without_timestamp(again) == without_timestamp(result)


def test_different_seeds_differ(result):
    a_runs = result["scenarios"]["low"]["A"]["per_seed"]
    assert a_runs[0]["totals"]["generated_kg"] != a_runs[1]["totals"]["generated_kg"]


def test_a_visits_every_container_every_week(world, result):
    ids = sorted(c["id"] for c in world[0]["containers"])
    for profile in result["scenarios"].values():
        for run in profile["A"]["per_seed"]:
            for w in run["weeks"]:
                assert sorted(s for r in w["routes"] for s in r["stop_ids"]) == ids


def test_both_scenarios_received_identical_inputs(result):
    for profile in result["scenarios"].values():
        for ra, rb in zip(profile["A"]["per_seed"], profile["B"]["per_seed"]):
            assert ra["seed"] == rb["seed"] and ra["inputs"] == rb["inputs"]
            assert ra["totals"]["generated_kg"] == rb["totals"]["generated_kg"]


def test_route_km_adds_up_and_overflow_reported(result):
    for profile in result["scenarios"].values():
        for policy in ("A", "B"):
            for run in profile[policy]["per_seed"]:
                for w in run["weeks"]:
                    assert w["km"] == pytest.approx(sum(r["km"] for r in w["routes"]), abs=1e-6)
                    assert w["stops"] == sum(len(r["stop_ids"]) for r in w["routes"])
                    assert isinstance(w["overflow_container_days"], int) and w["overflow_container_days"] >= 0
                assert run["totals"]["km"] == pytest.approx(sum(w["km"] for w in run["weeks"]), abs=1e-3)
            s = profile[policy]["summary"]
            assert s["km"]["min"] <= s["km"]["median"] <= s["km"]["max"]


def test_b_never_visits_more_than_a(result):
    for profile in result["scenarios"].values():
        for ra, rb in zip(profile["A"]["per_seed"], profile["B"]["per_seed"]):
            assert rb["totals"]["stops"] <= ra["totals"]["stops"]


def test_infeasible_fleet_raises(world):
    clean, m, a = world
    tiny = {**a, "truck_capacity_kg": {**a["truck_capacity_kg"], "value": 400},
            "collection_days_per_week": {**a["collection_days_per_week"], "value": 1}}
    with pytest.raises(InfeasibleError):
        simulate.simulate(clean, m, tiny, profiles=["mid"], n_seeds=1)


# ---------------------------------------------------------------- hand-checked toy cases

def toy(base, initial, weeks=4):
    """Single container 100 m from the depot, no randomness (weekly factor 1)."""
    m = {"provider": "test", "key": "toy", "ids": ["DEPOT", "C1"], "roles": ["depot", "container"],
         "distances_m": [[0, 100], [100, 0]], "durations_s": [[0, 10], [10, 0]]}
    draws = {"base": np.array([base]), "weekly": np.ones((weeks, 1)), "initial": np.array([initial])}
    containers = [{"id": "C1", "capacity_kg": 100}]
    f = Fleet(vehicles=1, capacity_kg=1000, shift_h=8, service_min_per_stop=5)
    return draws, containers, m, f


def test_b_rule_hand_checked():
    # base 0.35, start empty, T = 0.8: fill 0 (skip: 0.35 < 0.8), 0.35 (skip: 0.70), 0.70 (collect: 1.05), 0.35 (skip)
    draws, containers, m, f = toy(base=0.35, initial=0.0)
    run = simulate.run_scenario("B", draws, containers, m, f, threshold=0.8)
    assert [w["stops"] for w in run["weeks"]] == [0, 0, 1, 0]
    assert run["weeks"][2]["kg"] == pytest.approx(70.0)
    assert run["totals"]["end_backlog_kg"] == pytest.approx(70.0)  # 0.35 x 2 weeks after the week-3 collection


def test_overflow_days_hand_checked():
    # base 1.4 per week = 0.2 per day; emptied weekly by A: days end at 0.2 ... 1.4 -> 2 days above 100% per week
    draws, containers, m, f = toy(base=1.4, initial=0.0)
    run = simulate.run_scenario("A", draws, containers, m, f, threshold=0.8)
    assert [w["overflow_container_days"] for w in run["weeks"]] == [2, 2, 2, 2]
    assert run["weeks"][1]["kg"] == pytest.approx(140.0)  # side bags are collected too
