"""M3 acceptance tests: solve_day wrapper around pyvroom (PLAN.md §5, M3)."""

import itertools
import random
import time

import pytest

from pipeline import matrix as mx
from pipeline.solve import Fleet, InfeasibleError, solve_day


def line_matrix() -> dict:
    """Depot at x=0 km, stops A-D at x=1..4 km on a straight road; 1 km takes 60 s."""
    xs = [0, 1, 2, 3, 4]
    d = [[abs(a - b) * 1000 for b in xs] for a in xs]
    return {"provider": "test", "ids": ["DEPOT", "A", "B", "C", "D"], "roles": ["depot"] + ["container"] * 4,
            "distances_m": d, "durations_s": [[v * 0.06 for v in row] for row in d]}


def fleet(**kw) -> Fleet:
    base = dict(vehicles=1, capacity_kg=1000, shift_h=8, service_min_per_stop=5, speed_factor=1.0,
                cost_per_km=1.0, crew_cost_per_h=0.0, fixed_cost_per_vehicle=0.0)
    return Fleet(**{**base, **kw})


KG = {"A": 100, "B": 150, "C": 200, "D": 250}


def random_matrix(n_stops: int, seed: int) -> dict:
    rng = random.Random(seed)
    pts = [{"id": "DEPOT", "lat": 41.421, "lon": -8.315, "role": "depot"}] + [
        {"id": f"S{i:03d}", "lat": 41.39 + rng.random() * 0.12, "lon": -8.37 + rng.random() * 0.15, "role": "container"}
        for i in range(n_stops)]
    m = mx.build_approx(pts, detour_factor=1.6, speed_kmh=40)
    m.update(ids=[p["id"] for p in pts], roles=[p["role"] for p in pts], coords=[[p["lon"], p["lat"]] for p in pts])
    return m


# ---------------------------------------------------------------- known answer

def test_four_stop_fixture_known_order_and_km():
    plan = solve_day(line_matrix(), ["C", "A", "D", "B"], KG, fleet())
    (route,) = plan["routes"]
    assert route["stop_ids"] == ["A", "B", "C", "D"]  # symmetric matrix: the smaller of the two equal directions
    assert plan["km"] == 8.0
    assert plan["travel_h"] == pytest.approx(8 / 60, abs=1e-3)
    assert plan["service_h"] == pytest.approx(4 * 5 / 60, abs=1e-3)
    assert plan["kg"] == 700 and plan["stops"] == 4 and plan["unassigned"] == {}


def test_matches_brute_force_optimum():
    m = random_matrix(6, seed=7)
    stops = m["ids"][1:]
    plan = solve_day(m, stops, {s: 10 for s in stops}, fleet())
    d = m["distances_m"]
    best = min(sum(d[a][b] for a, b in zip((0, *p), (*p, 0))) for p in itertools.permutations(range(1, 7)))
    assert plan["routes"][0]["distance_m"] == best


def test_speed_factor_scales_travel_time_only():
    fast = solve_day(line_matrix(), list(KG), KG, fleet())
    slow = solve_day(line_matrix(), list(KG), KG, fleet(speed_factor=0.8))
    assert slow["km"] == fast["km"]
    assert slow["travel_h"] == pytest.approx(fast["travel_h"] / 0.8, abs=1e-3)
    assert slow["service_h"] == fast["service_h"]


# ---------------------------------------------------------------- infeasibility is never silent

def test_capacity_shortfall_raises_and_names_stops():
    kg = {"A": 600, "B": 600}
    with pytest.raises(InfeasibleError) as exc:
        solve_day(line_matrix(), ["A", "B"], kg, fleet())
    assert len(exc.value.unassigned) == 1
    assert "fleet capacity: 1200 kg to collect" in str(exc.value)

    partial = solve_day(line_matrix(), ["A", "B"], kg, fleet(), allow_unassigned=True)
    assert len(partial["unassigned"]) == 1 and partial["stops"] == 1

    two = solve_day(line_matrix(), ["A", "B"], kg, fleet(vehicles=2))
    assert two["vehicles_used"] == 2 and all(r["kg"] <= 1000 for r in two["routes"])


def test_single_overweight_stop():
    with pytest.raises(InfeasibleError, match="D: load 1500 kg exceeds truck capacity 1000 kg"):
        solve_day(line_matrix(), ["D"], {"D": 1500}, fleet())


def test_stop_beyond_shift():
    with pytest.raises(InfeasibleError, match="depot round trip alone takes"):
        solve_day(line_matrix(), ["D"], {"D": 10}, fleet(shift_h=0.1))  # 8 min drive + 5 min service > 6 min


@pytest.mark.parametrize("stops,kg,msg", [
    (["A", "Z"], {"A": 1, "Z": 1}, "not in the distance matrix"),
    (["A", "A"], {"A": 1}, "duplicate"),
    (["DEPOT"], {"DEPOT": 1}, "depot cannot be a stop"),
    (["A"], {"A": -5}, "invalid kg"),
    (["A"], {}, "invalid kg"),
])
def test_bad_input_rejected(stops, kg, msg):
    with pytest.raises(ValueError, match=msg):
        solve_day(line_matrix(), stops, kg, fleet())


# ---------------------------------------------------------------- consistency, determinism, speed

def test_empty_day():
    plan = solve_day(line_matrix(), [], {}, fleet())
    assert plan["routes"] == [] and plan["km"] == 0 and plan["stops"] == 0


def test_every_stop_once_and_totals_add_up():
    m = random_matrix(40, seed=3)
    stops = m["ids"][1:]
    kg = {s: 80 for s in stops}
    plan = solve_day(m, stops, kg, fleet(vehicles=4))
    served = [s for r in plan["routes"] for s in r["stop_ids"]]
    assert sorted(served) == sorted(stops)
    assert plan["km"] == pytest.approx(sum(r["km"] for r in plan["routes"]), abs=1e-6)
    assert all(r["kg"] <= 1000 and r["duration_h"] <= 8 for r in plan["routes"])


def test_deterministic():
    m = random_matrix(40, seed=3)
    stops = m["ids"][1:]
    kg = {s: 80 for s in stops}
    a = solve_day(m, stops, kg, fleet(vehicles=4))
    b = solve_day(m, stops, kg, fleet(vehicles=4))
    assert [r["stop_ids"] for r in a["routes"]] == [r["stop_ids"] for r in b["routes"]]


def test_150_stops_under_two_seconds():
    m = random_matrix(150, seed=11)
    stops = m["ids"][1:]
    t0 = time.perf_counter()
    plan = solve_day(m, stops, {s: 50 for s in stops}, fleet(vehicles=6, capacity_kg=2500))
    elapsed = time.perf_counter() - t0
    assert plan["stops"] == 150 and plan["unassigned"] == {}
    assert elapsed < 2.0, f"150-stop solve took {elapsed:.2f} s"


def test_costs_fall_back_to_time_when_unknown():
    assert fleet(cost_per_km=None).vroom_costs() is not None
    plan = solve_day(line_matrix(), list(KG), KG, fleet(cost_per_km=None, crew_cost_per_h=None))
    assert plan["km"] == 8.0


def test_routes_in_canonical_order():
    # Identical vehicles make VROOM's vehicle-to-route assignment an arbitrary tie-break; the wrapper
    # orders routes by stop sequence and numbers them 1..n so identical inputs give identical output.
    m = random_matrix(40, seed=3)
    stops = m["ids"][1:]
    plan = solve_day(m, stops, {s: 80 for s in stops}, fleet(vehicles=4))
    assert [r["stop_ids"] for r in plan["routes"]] == sorted(r["stop_ids"] for r in plan["routes"])
    assert [r["truck"] for r in plan["routes"]] == list(range(1, len(plan["routes"]) + 1))


def test_reverse_kept_only_when_it_costs_the_same():
    # Symmetric matrix: both directions tie, so the canonical (smaller) direction is returned.
    plan = solve_day(line_matrix(), ["D", "B", "C", "A"], KG, fleet())
    assert plan["routes"][0]["stop_ids"] == ["A", "B", "C", "D"]
    # Asymmetric matrix: going out via A is cheap and coming back via A is expensive, so the
    # optimiser's direction (D first) must be kept even though ["A", ...] sorts first.
    m = line_matrix()
    for j in range(1, 5):
        m["distances_m"][0][j] = m["distances_m"][j][0] = 4000  # depot equidistant from every stop
    m["distances_m"][4][0] = 500   # D -> depot is short
    m["distances_m"][0][4] = 9000  # depot -> D is long
    m["durations_s"] = [[v * 0.06 for v in row] for row in m["distances_m"]]
    plan = solve_day(m, ["A", "B", "C", "D"], KG, fleet())
    assert plan["routes"][0]["stop_ids"][-1] == "D"
