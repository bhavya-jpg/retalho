"""M7 acceptance tests: results.json assembly, staleness checks and JSON Schema (PLAN.md §5, M7)."""

import copy

import jsonschema
import pytest

from pipeline import cost, coverage, export, load, matrix, simulate, synthetic


@pytest.fixture(scope="module")
def parts(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("m7")
    synthetic.main(["--out", str(tmp / "raw" / "synthetic")])
    assert load.main(["--source", "synthetic", "--raw-root", str(tmp / "raw"), "--out", str(tmp / "clean")]) == 0
    clean = load.load_clean(tmp / "clean")
    a = load.load_assumptions()
    m = matrix.get_matrix(matrix.matrix_points(clean), "approx", detour_factor=1.6, speed_kmh=40, cache_dir=tmp)
    sim = simulate.simulate(clean, m, a, profiles=["mid"], n_seeds=1)
    be = cost.breakeven_sweep(clean, m, a, cost.DEFAULT_SWEEP, n_seeds=1)
    be["meta"] = {"assumptions_sha": simulate.fingerprint(a), "matrix_key": m["key"]}
    cov = coverage.coverage_analysis(clean, a["coverage_radius_m"]["value"], max_new=2)
    cov["meta"] = {"inputs_sha": clean["manifest"]["inputs"]}
    return clean, a, m, sim, be, cov


def build(parts, **override):
    clean, a, m, sim, be, cov = (override.get(k, v) for k, v in
                                 zip(("clean", "a", "m", "sim", "be", "cov"), parts))
    return export.build_results(clean, a, m, sim, be, cov, override.get("benchmarks", []))


def test_results_validate_against_schema(parts):
    results = build(parts)
    export.validate(results)
    assert results["meta"]["distance_provider"] == "approx"
    assert results["meta"]["data_source"] == "synthetic"
    assert {s["source_type"] for s in results["meta"]["data_sources"]} == {"synthetic"}  # no OSM claim for approx
    assert len(results["network"]["containers"]["features"]) == len(parts[0]["containers"])
    assert all(x["source_type"] in ("sponsor", "public", "assumption") for x in results["assumptions"])


def test_no_euro_figures_stored(parts):
    # PLAN §4.3: cost is computed by the app from km, hours and truck-days, never stored as euros.
    text = str(build(parts)["scenarios"])
    assert "cost" not in text and "eur" not in text.lower()


def test_stale_assumptions_rejected(parts):
    a2 = copy.deepcopy(parts[1])
    a2["threshold_T"]["value"] = 0.7
    with pytest.raises(export.StaleError, match="different assumptions"):
        build(parts, a=a2)


def test_stale_matrix_rejected(parts):
    m2 = {**parts[2], "key": "something-else"}
    with pytest.raises(export.StaleError, match="different distance matrix"):
        build(parts, m=m2)


def test_stale_coverage_rejected(parts):
    cov2 = {**parts[5], "meta": {"inputs_sha": {"other": 1}}}
    with pytest.raises(export.StaleError, match="coverage was built from different input data"):
        build(parts, cov=cov2)


@pytest.mark.parametrize("mutate", [
    lambda r: r["meta"].pop("distance_provider"),
    lambda r: r["meta"].update(distance_provider="haversine"),
    lambda r: r["breakeven"].update(points=r["breakeven"]["points"][:5]),
    lambda r: r.update(benchmarks=[{"name": "x", "metric": "y", "value": 1, "unit": "%", "source_url": "none"}]),
    lambda r: r["assumptions"][0].update(source_type="guess"),
    lambda r: r["network"]["containers"]["features"][0]["properties"].pop("source_type"),
    lambda r: r.update(extra_key=1),
])
def test_schema_rejects_bad_results(parts, mutate):
    results = build(parts)
    mutate(results)
    with pytest.raises(jsonschema.ValidationError):
        export.validate(results)
