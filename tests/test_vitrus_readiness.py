"""VITRUS readiness: the sponsor path validates, labels and reports correctly.

All rows here are TEST data written to a temporary folder. No VITRUS data exists in the repository.
"""

import json
import shutil
from pathlib import Path

import pytest

from pipeline import export, load

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def vitrus_dir(tmp_path):
    d = tmp_path / "raw" / "vitrus"
    shutil.copytree(FIXTURES / "valid", d)               # stands in for the copied public layers
    (d / "containers.csv").unlink()
    return d


def write_sponsor(d, rows, depot=True):
    header = "id,lat,lon,capacity_kg,site_type,source_type,name\n"
    (d / "containers.csv").write_text(header + "".join(rows), encoding="utf-8")
    if depot:
        (d / "depot.json").write_text(json.dumps({"name": "TEST depot", "lat": 41.431, "lon": -8.299,
                                                  "source_type": "sponsor"}))


def test_template_without_vitrus_rows_fails_clearly(vitrus_dir):
    write_sponsor(vitrus_dir, [], depot=False)
    (vitrus_dir / "depot.json").unlink()
    with pytest.raises(load.ValidationError) as exc:
        load.load_raw(vitrus_dir)
    assert "containers.csv: contains no valid records" in str(exc.value)
    assert "depot.json: file missing" in str(exc.value)


def test_sponsor_rows_validate_and_keep_their_label(vitrus_dir):
    write_sponsor(vitrus_dir, ["TEST-1,41.440,-8.290,350,ecoponto,sponsor,TEST container\n",
                               "TEST-2,41.436,-8.296,350,standalone,sponsor,TEST container\n"])
    data = load.load_raw(vitrus_dir)
    assert {r["source_type"] for r in data["containers"]} == {"sponsor"}
    assert data["depot"]["source_type"] == "sponsor"
    assert {r["source_type"] for r in data["demand_points"]} == {"synthetic"}  # untouched layers keep their own label


def test_bad_sponsor_rows_are_reported_not_fixed(vitrus_dir):
    write_sponsor(vitrus_dir, ["TEST-1,41.440,-8.290,,ecoponto,sponsor,missing capacity\n",
                               "TEST-2,41.436,-8.296,350,standalone,vitrus,wrong label\n",
                               "TEST-1,41.437,-8.297,350,standalone,sponsor,duplicate id\n"])
    with pytest.raises(load.ValidationError) as exc:
        load.load_raw(vitrus_dir)
    msg = str(exc.value)
    assert "TEST-1: missing required field 'capacity_kg'" in msg
    assert "TEST-2: source_type must be one of" in msg


def test_source_report_lists_what_vitrus_data_replaced():
    def res(src, cont_type, depot_type):
        fc = lambda t: {"type": "FeatureCollection", "features": [{"properties": {"source_type": t}}]}
        return {"meta": {"data_source": src, "generated_at": "t", "distance_provider": "osrm"},
                "network": {"containers": fc(cont_type), "candidates": fc("public"), "depot": {"source_type": depot_type},
                            "boundary": {"features": [{"properties": {"source_type": "public"}}]}},
                "coverage": {"data_source_types": ["public"]},
                "assumptions": [{"key": "truck_capacity_kg", "value": 2500, "source_type": "assumption"}]}
    vitrus = res("vitrus", "sponsor", "sponsor")
    vitrus["assumptions"][0] = {"key": "truck_capacity_kg", "value": 3200, "source_type": "sponsor"}
    report = export.source_report(vitrus, {"public": res("public", "public", "synthetic")})
    assert "containers: public -> sponsor" in report and "depot: synthetic -> sponsor" in report
    assert "truck_capacity_kg: 2500 (assumption) -> 3200 (sponsor)" in report
    assert "candidates" not in report.split("## Changes")[1]
