"""M13 tests: public dataset builder (OSM + INE), planned collection network, source report."""

import json

import geopandas as gpd
import pytest
from shapely.geometry import box

from pipeline import export, load, public_data, simulate

CFG = {"municipality_code": "0308", "exclude_recycling_types": ["reverse_vending_machine", "centre"],
       "dedupe_m": 15, "boundary_simplify_m": 1, "osm_extract": "test",
       "depot": {"name": "Assumed depot", "lat": 41.44, "lon": -8.29}}


@pytest.fixture
def inputs(tmp_path):
    # Two adjacent 1 km x 1 km subsections in EPSG:3763 around Guimarães, plus one from another municipality.
    x0, y0 = -27000, 222000  # roughly 41.44 N, 8.29 W in PT-TM06
    bgri = gpd.GeoDataFrame({
        "DTMN21": ["0308", "0308", "0303"], "SUBSECCAO": ["A1", "A2", "X9"], "N_INDIVIDUOS": [120.0, 80.0, 999.0],
        "geometry": [box(x0, y0, x0 + 1000, y0 + 1000), box(x0 + 1000, y0, x0 + 2000, y0 + 1000),
                     box(x0 + 5000, y0, x0 + 6000, y0 + 1000)]}, crs="EPSG:3763")
    gpkg = tmp_path / "bgri.gpkg"
    bgri.to_file(gpkg, driver="GPKG")

    inside = gpd.GeoSeries.from_xy([x0 + 500, x0 + 505, x0 + 1500, x0 + 1200, x0 + 1800, x0 + 300],
                                   [y0 + 500, y0 + 500, y0 + 500, y0 + 200, y0 + 800, y0 + 900], crs="EPSG:3763").to_crs(4326)
    outside = gpd.GeoSeries.from_xy([x0 + 5500], [y0 + 500], crs="EPSG:3763").to_crs(4326)
    feats = [
        ("n1", inside[0], {"amenity": "recycling", "recycling:clothes": "yes", "recycling:glass": "yes"}),  # textile, ecoponto
        ("n2", inside[1], {"amenity": "recycling", "recycling:paper": "yes"}),                            # 5 m away: duplicate site
        ("n3", inside[2], {"amenity": "recycling", "recycling:clothes": "yes", "name": "Cáritas"}),       # textile, standalone
        ("n4", inside[3], {"amenity": "recycling", "recycling_type": "container", "recycling:glass": "yes"}),  # candidate
        ("n5", inside[4], {"amenity": "recycling", "recycling_type": "reverse_vending_machine"}),          # excluded type
        ("w6", inside[5].buffer(0.0001), {"amenity": "recycling", "recycling_type": "container"}),         # area -> point
        ("n7", outside[0], {"amenity": "recycling", "recycling:clothes": "yes"}),                         # other municipality
    ]
    seq = tmp_path / "osm.geojsonseq"
    with seq.open("w") as f:
        for oid, geom, tags in feats:
            f.write("\x1e" + json.dumps({"type": "Feature", "id": oid, "geometry": geom.__geo_interface__,
                                         "properties": tags}) + "\n")
    return seq, gpkg


def test_builds_labelled_public_dataset(inputs, tmp_path):
    seq, gpkg = inputs
    data = public_data.build(seq, gpkg, {**CFG, "depot": {"name": "Assumed depot", "lat": 41.444, "lon": -8.287}}, 300)
    cont = {f["properties"]["id"]: f["properties"] for f in data["containers"]["features"]}
    cand = [f["properties"]["id"] for f in data["candidates"]["features"]]
    assert set(cont) == {"OSM-n1", "OSM-n3"}                       # outside-municipality textile point dropped
    assert cont["OSM-n1"]["site_type"] == "ecoponto" and cont["OSM-n3"]["site_type"] == "standalone"
    assert cont["OSM-n3"]["name"] == "Cáritas" and cont["OSM-n1"]["capacity_kg"] == 300
    assert sorted(cand) == ["OSM-n4", "OSM-w6"]                    # duplicate n2 and vending machine n5 excluded
    assert data["stats"]["population"] == 200                     # other municipality's subsection excluded
    assert {f["properties"]["source_type"] for k in ("containers", "candidates", "demand_points")
            for f in data[k]["features"]} == {"public"}
    assert data["depot"]["source_type"] == "synthetic"            # assumed depot is never labelled public

    public_data.write(data, tmp_path / "raw" / "public", CFG)
    clean = load.load_raw(tmp_path / "raw" / "public")              # passes the M1 data contract
    assert len(clean["demand_points"]) == 2


def test_missing_osm_ids_rejected(tmp_path):
    seq = tmp_path / "no_ids.geojsonseq"
    seq.write_text(json.dumps({"type": "Feature", "geometry": {"type": "Point", "coordinates": [-8.3, 41.4]},
                               "properties": {"amenity": "recycling"}}) + "\n")
    with pytest.raises(ValueError, match="add-unique-id"):
        public_data.read_osm(seq)


# ---------------------------------------------------------------- planned collection network

def network_inputs(n_new):
    clean = {"containers": [{"id": "E1", "capacity_kg": 300}], "candidates": [{"id": "C1"}, {"id": "C2"}, {"id": "C3"}],
             "manifest": {"inputs": {"x": 1}}}
    a = {"collection_network_new_points": {"value": n_new}, "container_capacity_kg": {"value": 250}}
    cov = {"meta": {"inputs_sha": {"x": 1}}, "additions": [{"n_new": 0, "site_ids": []}, {"n_new": 1, "site_ids": ["C2"]},
                                                            {"n_new": 2, "site_ids": ["C1", "C3"]}]}
    return clean, a, cov


def test_network_existing_only_when_zero():
    clean, a, cov = network_inputs(0)
    containers, info = simulate.collection_network(clean, a, None)
    assert [c["id"] for c in containers] == ["E1"] and info["n_new"] == 0


def test_network_adds_coverage_sites_with_capacity():
    clean, a, cov = network_inputs(2)
    containers, info = simulate.collection_network(clean, a, cov)
    assert [c["id"] for c in containers] == ["E1", "C1", "C3"]
    assert [c["capacity_kg"] for c in containers] == [300, 250, 250]
    assert info == {"existing": ["E1"], "proposed": ["C1", "C3"], "n_new": 2}


def test_network_rejects_missing_coverage():
    clean, a, _ = network_inputs(2)
    with pytest.raises(ValueError, match="needs out/coverage.json"):
        simulate.collection_network(clean, a, None)


@pytest.mark.parametrize("mutate,msg", [
    (lambda cov: cov.update(meta={"inputs_sha": {"x": 2}}), "different input data"),
    (lambda cov: cov.update(additions=cov["additions"][:2]), "no \\+2 solution"),
])
def test_network_rejects_stale_coverage(mutate, msg):
    clean, a, cov = network_inputs(2)
    mutate(cov)
    with pytest.raises(ValueError, match=msg):
        simulate.collection_network(clean, a, cov)


# ---------------------------------------------------------------- source report

def fake_results(src, layer_type, cost_source):
    fc = {"type": "FeatureCollection", "features": [{"properties": {"source_type": layer_type}}]}
    return {"meta": {"data_source": src, "generated_at": "t", "distance_provider": "osrm"},
            "network": {"containers": fc, "candidates": fc, "depot": {"source_type": "synthetic"},
                        "boundary": {"features": [{"properties": {"source_type": layer_type}}]}},
            "coverage": {"data_source_types": [layer_type]},
            "assumptions": [{"key": "cost_per_km", "value": 0.6, "source_type": cost_source}]}


def test_source_report_lists_changes():
    report = export.source_report(fake_results("vitrus", "sponsor", "sponsor"),
                                  {"public": fake_results("public", "public", "assumption")})
    assert "containers: public -> sponsor" in report
    assert "assumption cost_per_km: 0.6 (assumption) -> 0.6 (sponsor)" in report
    assert "depot" not in report.split("## Changes")[1]          # unchanged inputs are not listed as changes
