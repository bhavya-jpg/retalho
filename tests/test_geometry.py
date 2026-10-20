"""S1 tests: street-following route geometry, fallback and export checks (no live OSRM needed)."""

import json
import math
import urllib.error
import urllib.parse

import pytest

from pipeline import export, geometry
from pipeline.matrix import encode_polyline

STOPS = [(41.421, -8.315), (41.4425, -8.2918), (41.45, -8.30), (41.421, -8.315)]  # depot -> 2 stops -> depot


def osrm_ok(path=None, distance=5234.5, duration=600.0):
    path = path or [(41.421, -8.315), (41.43, -8.30), (41.4425, -8.2918), (41.45, -8.30), (41.421, -8.315)]
    return {"code": "Ok", "routes": [{"geometry": encode_polyline(path, precision=6), "distance": distance,
                                      "duration": duration}]}


def fake(response=None, exc=None, calls=None):
    def fetch(url, timeout):
        if calls is not None:
            calls.append(url)
        if exc:
            raise exc
        return response
    return fetch


# ---------------------------------------------------------------- polyline

def test_polyline_round_trip_precision6():
    pts = [(41.4425, -8.2918), (41.45, -8.3), (-12.3456789, 120.987654)]
    back = geometry.decode_polyline(encode_polyline(pts, precision=6))
    assert all(math.isclose(a, c, abs_tol=1e-6) and math.isclose(b, d, abs_tol=1e-6) for (a, b), (c, d) in zip(pts, back))


def test_polyline_reference_example_precision5():
    assert geometry.decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5) == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]


@pytest.mark.parametrize("bad", ["", "_p~iF~ps|U_", "\x10\x10", None])
def test_polyline_rejects_malformed(bad):
    with pytest.raises(ValueError):
        geometry.decode_polyline(bad)


# ---------------------------------------------------------------- adapter

def test_valid_street_route():
    g = geometry.route_geometry(STOPS, "http://osrm", fetch=fake(osrm_ok()))
    assert g["status"] == "road" and g["osrm_distance_m"] == 5234.5 and g["points"] == 5
    assert geometry.decode_polyline(g["polyline6"])[0] == pytest.approx(STOPS[0])


def test_request_keeps_stop_order():
    calls = []
    geometry.route_geometry(STOPS, "http://osrm", fetch=fake(osrm_ok(), calls=calls))
    encoded = calls[0].split("polyline(")[1].split(")")[0]
    sent = geometry.decode_polyline(urllib.parse.unquote(encoded), precision=5)
    assert sent == [pytest.approx(p, abs=1e-5) for p in STOPS]
    assert "continue_straight=false" in calls[0] and "overview=full" in calls[0]


@pytest.mark.parametrize("exc", [urllib.error.URLError("refused"), OSError("timeout"), ValueError("bad json")])
def test_service_unavailable_falls_back_to_straight(exc):
    g = geometry.route_geometry(STOPS, "http://osrm", fetch=fake(exc=exc))
    assert g["status"] == "straight" and "unavailable" in g["reason"]
    assert g["coords"] == [[round(a, 6), round(b, 6)] for a, b in STOPS]   # same order, nothing invented
    assert "osrm_distance_m" not in g                                     # no road distance claimed


@pytest.mark.parametrize("response,reason", [
    ({"code": "NoRoute", "routes": []}, "no route (NoRoute)"),
    ({"code": "Ok", "routes": []}, "no route (Ok)"),
    ({"code": "Ok", "routes": [{"geometry": "not a polyline!", "distance": 1, "duration": 1}]}, "invalid routing response"),
    ({"code": "Ok", "routes": [{"geometry": encode_polyline(STOPS, 6), "distance": -5, "duration": 1}]}, "bad geometry or distance"),
    ({"code": "Ok", "routes": [{"distance": 10, "duration": 1}]}, "invalid routing response"),
    ({"code": "Ok", "routes": [{"geometry": encode_polyline([(95.0, 0.0), (0.0, 0.0)], 6), "distance": 1, "duration": 1}]},
     "bad geometry or distance"),
    (["not", "a", "dict"], "no route (list)"),
])
def test_invalid_responses_fall_back(response, reason):
    g = geometry.route_geometry(STOPS, "http://osrm", fetch=fake(response))
    assert g["status"] == "straight" and reason in g["reason"]


@pytest.mark.parametrize("coords", [[(41.4, -8.3)], [(41.4, float("nan")), (41.5, -8.3)], [(91.0, -8.3), (41.5, -8.3)],
                                    [(41.4, -181.0), (41.5, -8.3)]])
def test_invalid_coordinates_rejected(coords):
    with pytest.raises(ValueError):
        geometry.route_geometry(coords, "http://osrm", fetch=fake(osrm_ok()))


def test_simplified_keeps_endpoints_and_reduces_points():
    dense = [(41.42 + i * 1e-6, -8.31) for i in range(200)] + [(41.43, -8.30)]
    g = geometry.route_geometry([dense[0], dense[-1]], "http://osrm", fetch=fake(osrm_ok(path=dense)))
    s = geometry.simplified(g)
    pts = geometry.decode_polyline(s["polyline6"])
    assert s["points"] < g["points"] and pts[0] == pytest.approx(dense[0]) and pts[-1] == pytest.approx(dense[-1])
    assert geometry.simplified({"status": "straight", "reason": "x", "coords": []})["status"] == "straight"


# ---------------------------------------------------------------- build + cache

def sim_and_clean():
    routes = [{"truck": 1, "stop_ids": ["C1", "C2"], "km": 5.2345, "travel_h": 0.2, "kg": 10}]
    week = {"week": 1, "routes": routes}
    sim = {"meta": {"matrix_key": "m1"},
           "scenarios": {"mid": {"A": {"per_seed": [{"weeks": [week, week]}]},
                                 "B": {"per_seed": [{"weeks": [{"week": 1, "routes": [{**routes[0], "stop_ids": ["C2"]}]}]}]}}}}
    clean = {"containers": [{"id": "C1", "lat": 41.4425, "lon": -8.2918}],
             "candidates": [{"id": "C2", "lat": 41.45, "lon": -8.30}], "depot": {"lat": 41.421, "lon": -8.315}}
    return sim, clean


def test_build_dedupes_and_caches_successes_only(tmp_path):
    sim, clean = sim_and_clean()
    calls = []
    geo = geometry.build_geometries(sim, clean, "http://osrm", tmp_path / "c.json", fetch=fake(osrm_ok(), calls=calls))
    assert len(calls) == 2 and set(geo["route_keys"]) == {"C1|C2", "C2"}     # 3 routes, 2 distinct sequences
    again = geometry.build_geometries(sim, clean, "http://osrm", tmp_path / "c.json", fetch=fake(exc=OSError("down")))
    assert again["stats"]["cached"] == 2 and again["stats"]["straight"] == 0  # served from cache, no request

    calls.clear()
    geometry.build_geometries(sim, clean, "http://osrm", tmp_path / "d.json", fetch=fake(exc=OSError("down")))
    retry = geometry.build_geometries(sim, clean, "http://osrm", tmp_path / "d.json", fetch=fake(osrm_ok(), calls=calls))
    assert len(calls) == 2 and retry["stats"]["road"] == 2                    # failures are not cached


def test_matrix_check_compares_path_and_matrix_distance(tmp_path):
    sim, clean = sim_and_clean()
    geo = geometry.build_geometries(sim, clean, "http://osrm", tmp_path / "c.json", fetch=fake(osrm_ok(distance=5234.5)))
    c = geometry.check_against_matrix(sim, geo)
    assert c["routes_checked"] == 3 and c["max_rel_gap"] == pytest.approx(0.0, abs=1e-4)


# ---------------------------------------------------------------- export checks

def test_export_rejects_stale_or_incomplete_geometry(tmp_path):
    sim, clean = sim_and_clean()
    geo = geometry.build_geometries(sim, clean, "http://osrm", tmp_path / "c.json", fetch=fake(osrm_ok()))
    assert export.route_geometry_for(sim, None) is None
    with pytest.raises(export.StaleError, match="different distance matrix"):
        export.route_geometry_for(sim, {**geo, "meta": {"matrix_key": "other"}})
    geo["meta"] = {"matrix_key": "m1"}
    block = export.route_geometry_for(sim, geo)
    assert set(block["route_keys"]) == {"C1|C2", "C2"}
    geo["route_keys"].pop("C2")
    with pytest.raises(export.StaleError, match="missing simulated routes"):
        export.route_geometry_for(sim, geo)
    json.dumps(block)  # serialisable for results.json
