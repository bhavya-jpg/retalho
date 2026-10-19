"""M1 acceptance tests: loaders, validation and the synthetic generator (PLAN.md §5, M1)."""

import json
import shutil
from pathlib import Path

import pytest
import yaml
from shapely.geometry import Point

from pipeline import load, synthetic

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures"
POINT_LAYERS = ("containers", "candidates", "demand_points")


@pytest.fixture(scope="module")
def synthetic_clean(tmp_path_factory) -> dict:
    """Run the full M1 path (generate -> validate -> write -> read back) into a temp folder."""
    tmp = tmp_path_factory.mktemp("m1")
    synthetic.main(["--out", str(tmp / "raw" / "synthetic")])
    assert load.main(["--source", "synthetic", "--raw-root", str(tmp / "raw"), "--out", str(tmp / "clean")]) == 0
    return load.load_clean(tmp / "clean")


# ---------------------------------------------------------------- synthetic data passes the contract

def test_writes_every_file_in_the_contract(synthetic_clean):
    cfg = yaml.safe_load((ROOT / "config" / "synthetic.yaml").read_text())
    for layer in POINT_LAYERS:
        assert len(synthetic_clean[layer]) == cfg["counts"][layer]
    assert synthetic_clean["depot"]["name"]
    assert synthetic_clean["boundary"].geom_type == "Polygon"


def test_ids_unique_across_all_layers(synthetic_clean):
    ids = [r["id"] for layer in POINT_LAYERS for r in synthetic_clean[layer]]
    assert len(ids) == len(set(ids))


def test_all_points_inside_boundary(synthetic_clean):
    boundary = synthetic_clean["boundary"]
    for layer in POINT_LAYERS:
        for r in synthetic_clean[layer]:
            assert boundary.covers(Point(r["lon"], r["lat"])), f"{layer} {r['id']} outside boundary"


def test_capacity_and_population_valid(synthetic_clean):
    assert all(r["capacity_kg"] > 0 for r in synthetic_clean["containers"])
    assert all(r["population"] >= 0 for r in synthetic_clean["demand_points"])
    assert synthetic_clean["manifest"]["population_total"] == sum(r["population"] for r in synthetic_clean["demand_points"])


def test_every_record_labelled_synthetic(synthetic_clean):
    for layer in POINT_LAYERS:
        assert {r["source_type"] for r in synthetic_clean[layer]} == {"synthetic"}
    assert synthetic_clean["depot"]["source_type"] == "synthetic"
    assert synthetic_clean["boundary_props"]["source_type"] == "synthetic"


def test_kinds_match_layer(synthetic_clean):
    assert {r["kind"] for r in synthetic_clean["containers"]} == {"existing"}
    assert {r["kind"] for r in synthetic_clean["candidates"]} == {"candidate"}


def test_container_capacity_comes_from_assumptions(synthetic_clean):
    expected = load.load_assumptions()["container_capacity_kg"]["value"]
    assert {r["capacity_kg"] for r in synthetic_clean["containers"]} == {expected}


def test_generator_is_deterministic():
    cfg = yaml.safe_load((ROOT / "config" / "synthetic.yaml").read_text())
    a = synthetic.generate(cfg, container_capacity_kg=300)
    b = synthetic.generate(cfg, container_capacity_kg=300)
    c = synthetic.generate(cfg, container_capacity_kg=300, seed=cfg["seed"] + 1)
    assert json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    assert json.dumps(a, sort_keys=True) != json.dumps(c, sort_keys=True)


# ---------------------------------------------------------------- hand-written fixtures

def test_valid_fixture_with_csv_input_is_normalised():
    data = load.load_raw(FIXTURES / "valid")
    # CSV strings become numbers, site_type is lower-cased, kind is implied by the file, records are sorted.
    assert [r["id"] for r in data["containers"]] == ["TX-1", "TX-2"]
    tx1, tx2 = data["containers"]
    assert tx1["capacity_kg"] == 250 and isinstance(tx1["capacity_kg"], int)
    assert tx2["site_type"] == "ecoponto"
    assert {r["kind"] for r in data["containers"]} == {"existing"}
    assert data["candidates"][0]["kind"] == "candidate"
    assert data["depot"]["id"] == "DEPOT"
    assert data["warnings"] == []


def test_broken_fixture_fails_with_readable_message():
    with pytest.raises(load.ValidationError) as exc:
        load.load_raw(FIXTURES / "broken")
    msg = str(exc.value)
    expected = [
        "record TX-1: duplicate id",
        "record TX-OUTSIDE: point",           # ... is outside the municipality boundary
        "outside the municipality boundary",
        "record TX-NEGCAP: capacity_kg must be a positive number",
        "record TX-NOSOURCE: missing required field 'source_type'",
        "record TX-BADSITE: site_type must be one of",
        "record CAND-BADSOURCE: source_type must be one of",
        "record DP-NEGPOP: population must be a non-negative number",
        "depot.json: missing required field 'name'",
    ]
    for fragment in expected:
        assert fragment in msg, f"expected {fragment!r} in:\n{msg}"
    assert msg.startswith("Input validation failed for")
    assert len(exc.value.problems) == len(expected) - 1  # two fragments come from the same TX-OUTSIDE line


def test_cli_exits_nonzero_on_broken_input(tmp_path, capsys):
    shutil.copytree(FIXTURES / "broken", tmp_path / "raw" / "broken")
    rc = load.main(["--source", "broken", "--raw-root", str(tmp_path / "raw"), "--out", str(tmp_path / "clean")])
    assert rc == 1
    assert "Input validation failed" in capsys.readouterr().err
    assert not (tmp_path / "clean").exists()  # nothing is written when validation fails


def test_missing_files_reported(tmp_path):
    (tmp_path / "empty").mkdir()
    with pytest.raises(load.ValidationError) as exc:
        load.load_raw(tmp_path / "empty")
    msg = str(exc.value)
    for name in ("boundary.geojson", "containers", "candidates", "demand_points", "depot.json"):
        assert name in msg


def test_depot_outside_boundary_is_a_warning_not_an_error(tmp_path):
    shutil.copytree(FIXTURES / "valid", tmp_path / "v")
    (tmp_path / "v" / "depot.json").write_text(json.dumps(
        {"name": "Outside depot", "lat": 41.50, "lon": -8.20, "source_type": "synthetic"}))
    data = load.load_raw(tmp_path / "v")
    assert data["warnings"] == ["depot.json: depot lies outside the municipality boundary"]


# ---------------------------------------------------------------- assumptions

def test_assumptions_file_is_complete():
    a = load.load_assumptions()
    for key in load.REQUIRED_ASSUMPTIONS:
        assert {"value", "unit", "source_type", "note"} <= set(a[key])


def test_bad_assumptions_rejected(tmp_path):
    a = yaml.safe_load((ROOT / "config" / "assumptions.yaml").read_text())
    a["cost_per_km"]["source_type"] = "guess"
    a["cost_per_km"]["value"] = -1
    del a["seeds"]
    a["trucks"]["note"] = ""
    path = tmp_path / "assumptions.yaml"
    path.write_text(yaml.safe_dump(a))
    with pytest.raises(load.ValidationError) as exc:
        load.load_assumptions(path)
    msg = str(exc.value)
    assert "cost_per_km: source_type must be one of" in msg
    assert "cost_per_km: value must not be negative" in msg
    assert "seeds: missing" in msg
    assert "trucks: note is empty" in msg
