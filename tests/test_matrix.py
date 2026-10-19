"""M2 acceptance tests: distance matrix, cache and labelled fallback (PLAN.md §5, M2).

Most tests use a fake OSRM, so they run without Docker. `test_live_osrm` runs only when a
real OSRM server is reachable (`make osrm`).
"""

import json
import math

import pytest

from pipeline import load, matrix, synthetic

DEAD_URL = "http://127.0.0.1:9"  # nothing listens on the discard port

POINTS = [
    {"id": "DEPOT", "lat": 41.4210, "lon": -8.3150, "role": "depot"},
    {"id": "TX-001", "lat": 41.4425, "lon": -8.2918, "role": "container"},
    {"id": "TX-002", "lat": 41.4500, "lon": -8.3000, "role": "container"},
    {"id": "CAND-001", "lat": 41.4300, "lon": -8.2700, "role": "candidate"},
]


def fake_osrm(points, ratio=1.5, speed_ms=10.0, nulls=()):
    """Stand-in for _http_json: road distance = straight line x ratio, snapped = input coords."""
    def http_json(url, timeout):
        if "/nearest/" in url:
            return {"code": "Ok"}
        d = [[matrix.haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) * ratio for b in points] for a in points]
        t = [[v / speed_ms for v in row] for row in d]
        for i, j in nulls:
            d[i][j] = t[i][j] = None
        src = [{"location": [p["lon"], p["lat"]], "distance": 12.5} for p in points]
        return {"code": "Ok", "distances": d, "durations": t, "sources": src, "destinations": src}
    return http_json


def get(points=POINTS, provider="auto", **kw):
    kw.setdefault("detour_factor", 1.62)
    kw.setdefault("speed_kmh", 42)
    kw.setdefault("data_version", "test")
    return matrix.get_matrix(points, provider, **kw)


# ---------------------------------------------------------------- helpers

def test_haversine_one_degree_of_latitude():
    assert matrix.haversine_m(0, 0, 1, 0) == pytest.approx(2 * math.pi * matrix.EARTH_RADIUS_M / 360, rel=1e-9)


def test_polyline_matches_reference_example():
    # Example from Google's encoded polyline algorithm documentation.
    pts = [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]
    assert matrix.encode_polyline(pts) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"


# ---------------------------------------------------------------- approx fallback

def test_approx_matrix_shape_values_and_label(tmp_path):
    m = get(provider="approx", cache_dir=tmp_path)
    n = len(POINTS)
    assert m["provider"] == "approx" and "APPROXIMATE" in m["label"]
    assert len(m["distances_m"]) == n and all(len(r) == n for r in m["distances_m"])
    for i, a in enumerate(POINTS):
        assert m["distances_m"][i][i] == 0 and m["durations_s"][i][i] == 0
        for j, b in enumerate(POINTS):
            if i != j:
                expected = matrix.haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) * 1.62
                assert m["distances_m"][i][j] == round(expected)
                assert m["durations_s"][i][j] == pytest.approx(expected / (42 / 3.6), abs=0.1)
    assert matrix.straight_line_violations(m) == []


def test_cache_hit_on_second_call(tmp_path, monkeypatch):
    first = get(provider="approx", cache_dir=tmp_path)
    calls = []
    monkeypatch.setattr(matrix, "build_approx", lambda *a, **k: calls.append(1))
    second = get(provider="approx", cache_dir=tmp_path)
    assert not first["cache_hit"] and second["cache_hit"] and calls == []
    assert second["distances_m"] == first["distances_m"]


def test_cache_key_changes_with_inputs():
    base = matrix.cache_key(POINTS, "approx", {"detour_factor": 1.62, "speed_kmh": 42})
    moved = [dict(p) for p in POINTS]
    moved[1]["lat"] += 0.001
    assert matrix.cache_key(moved, "approx", {"detour_factor": 1.62, "speed_kmh": 42}) != base
    assert matrix.cache_key(POINTS, "approx", {"detour_factor": 1.5, "speed_kmh": 42}) != base
    assert matrix.cache_key(POINTS, "osrm", {"profile": "car", "data_version": "a"}) != \
        matrix.cache_key(POINTS, "osrm", {"profile": "car", "data_version": "b"})
    # The server address does not change the data, so it does not change the key.
    assert matrix.cache_key(POINTS, "osrm", {"profile": "car", "data_version": "a", "osrm_url": "x"}) == \
        matrix.cache_key(POINTS, "osrm", {"profile": "car", "data_version": "a", "osrm_url": "y"})


# ---------------------------------------------------------------- OSRM provider (faked)

def test_osrm_matrix_from_fake_server(tmp_path, monkeypatch):
    monkeypatch.setattr(matrix, "_http_json", fake_osrm(POINTS))
    m = get(provider="osrm", cache_dir=tmp_path)
    assert m["provider"] == "osrm" and m["ids"] == [p["id"] for p in POINTS]
    assert all(m["distances_m"][i][i] == 0 for i in range(len(POINTS)))
    assert m["snap_m"] == [12.5] * len(POINTS)
    assert matrix.straight_line_violations(m) == []
    cal = matrix.calibrate(m)
    assert cal["detour_factor_median"] == pytest.approx(1.5, abs=0.01)
    assert cal["speed_kmh_median"] == pytest.approx(36.0, abs=0.1)


def test_unreachable_pairs_raise_with_ids(tmp_path, monkeypatch):
    monkeypatch.setattr(matrix, "_http_json", fake_osrm(POINTS, nulls=[(1, 3)]))
    with pytest.raises(matrix.MatrixError, match="TX-001->CAND-001"):
        get(provider="osrm", cache_dir=tmp_path)


def test_auto_falls_back_to_approx_with_warning(tmp_path, capsys):
    m = get(provider="auto", osrm_url=DEAD_URL, cache_dir=tmp_path)
    assert m["provider"] == "approx"
    assert "Falling back to APPROXIMATE" in capsys.readouterr().err


def test_auto_prefers_cached_osrm_when_server_is_down(tmp_path, monkeypatch):
    monkeypatch.setattr(matrix, "_http_json", fake_osrm(POINTS))
    get(provider="osrm", cache_dir=tmp_path)
    monkeypatch.undo()
    m = get(provider="auto", osrm_url=DEAD_URL, cache_dir=tmp_path)
    assert m["provider"] == "osrm" and m["cache_hit"]


def test_forced_osrm_never_falls_back(tmp_path):
    with pytest.raises(matrix.MatrixError, match="not reachable"):
        get(provider="osrm", osrm_url=DEAD_URL, cache_dir=tmp_path)


# ---------------------------------------------------------------- checks

def test_violation_detected():
    m = {"ids": ["A", "B"], "coords": [[-8.30, 41.44], [-8.29, 41.44]], "distances_m": [[0, 10], [900, 0]]}
    v = matrix.straight_line_violations(m)
    assert [(x["from"], x["to"]) for x in v] == [("A", "B")]


@pytest.mark.parametrize("dist", [[[5, 1], [1, 0]], [[0, float("nan")], [1, 0]], [[0, -1], [1, 0]], [[0, 1]]])
def test_validate_matrix_rejects_bad_values(dist):
    m = {"ids": ["A", "B"], "distances_m": dist, "durations_s": [[0, 1], [1, 0]]}
    with pytest.raises(matrix.MatrixError):
        matrix.validate_matrix(m)


# ---------------------------------------------------------------- live OSRM (optional)

@pytest.mark.skipif(not matrix.osrm_available(matrix.DEFAULT_OSRM_URL), reason="OSRM not running (make osrm)")
def test_live_osrm(tmp_path):
    synthetic.main(["--out", str(tmp_path / "raw" / "synthetic")])
    assert load.main(["--source", "synthetic", "--raw-root", str(tmp_path / "raw"), "--out", str(tmp_path / "clean")]) == 0
    points = matrix.matrix_points(load.load_clean(tmp_path / "clean"))
    m = get(points, provider="osrm", cache_dir=tmp_path, data_version=matrix.osrm_data_version())
    matrix.validate_matrix(m)
    assert m["provider"] == "osrm" and len(m["ids"]) == len(points)
    assert matrix.straight_line_violations(m) == []
    assert json.loads((tmp_path / f"matrix_{m['key']}.json").read_text())["provider"] == "osrm"
