"""M6 acceptance tests: coverage of existing points and MCLP additions (PLAN.md §5, M6)."""

import numpy as np
import pytest

from pipeline import coverage, load, synthetic


def pt(i, lat, lon, **props):
    return {"id": i, "lat": lat, "lon": lon, **props}


def toy_clean():
    """Three clusters about 1.1 km apart (0.01 deg latitude). One existing point covers cluster A;
    candidate CB covers cluster B (100 people), CC covers cluster C (50 people), CX covers no one."""
    demand = [pt("DA", 41.40, -8.30, population=30), pt("DB", 41.41, -8.30, population=100),
              pt("DC", 41.42, -8.30, population=50)]
    for d in demand:
        d["source_type"] = "synthetic"
    return {"demand_points": demand,
            "containers": [pt("EX", 41.4001, -8.30)],
            "candidates": [pt("CC", 41.4199, -8.30), pt("CB", 41.4101, -8.30), pt("CX", 41.45, -8.30)]}


def test_distance_one_hundredth_degree_latitude():
    d = coverage.distance_matrix_m([pt("a", 41.40, -8.30)], [pt("b", 41.41, -8.30)])
    assert d[0, 0] == pytest.approx(1111.95, abs=0.1)


def test_toy_known_answer():
    cov = coverage.coverage_analysis(toy_clean(), radius=500, max_new=3)
    assert cov["population_total"] == 180
    assert cov["existing"]["covered_pop"] == 30
    assert cov["all_candidates"]["covered_pop"] == 180
    add = {x["n_new"]: x for x in cov["additions"]}
    assert add[0]["site_ids"] == [] and add[0]["covered_pop"] == 30
    assert add[1]["site_ids"] == ["CB"] and add[1]["covered_pop"] == 130
    assert sorted(add[2]["site_ids"]) == ["CB", "CC"] and add[2]["covered_pop"] == 180
    assert add[2]["marginal_share"] == pytest.approx(50 / 180, abs=1e-4)
    assert add[3]["covered_pop"] == 180 and add[3]["marginal_share"] == 0  # the useless site adds nothing
    assert cov["distance"] == "straight_line"


@pytest.fixture(scope="module")
def synthetic_cov(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("m6")
    synthetic.main(["--out", str(tmp / "raw" / "synthetic")])
    assert load.main(["--source", "synthetic", "--raw-root", str(tmp / "raw"), "--out", str(tmp / "clean")]) == 0
    clean = load.load_clean(tmp / "clean")
    return clean, coverage.coverage_analysis(clean, radius=500, max_new=8)


def test_existing_sites_always_kept_and_counts_right(synthetic_cov):
    clean, cov = synthetic_cov
    candidate_ids = {c["id"] for c in clean["candidates"]}
    assert cov["existing"]["sites"] == [c["id"] for c in clean["containers"]]
    for x in cov["additions"]:
        assert len(x["site_ids"]) == x["n_new"] and set(x["site_ids"]) <= candidate_ids


def test_coverage_never_decreases_and_stays_below_ceiling(synthetic_cov):
    _, cov = synthetic_cov
    shares = [x["covered_pop"] for x in cov["additions"]]
    assert shares == sorted(shares)
    assert shares[0] == cov["existing"]["covered_pop"]
    assert shares[-1] <= cov["all_candidates"]["covered_pop"]


def test_each_solve_under_sixty_seconds(synthetic_cov):
    _, cov = synthetic_cov
    assert max(x["solve_s"] for x in cov["additions"]) < 60


def test_population_weighting_differs_from_point_count():
    # Two demand points, one site covers only the big one: 90% of people, 50% of points.
    dist = np.array([[100.0], [5000.0]])
    pop = np.array([90.0, 10.0])
    assert coverage.covered_population(dist, pop, np.array([True]), 500) == 90.0
