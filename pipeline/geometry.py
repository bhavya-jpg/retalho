"""Road-following geometry for simulated routes (PLAN.md S1).

Display only. Route ORDER comes from the optimiser (pipeline/solve.py) and route DISTANCE
comes from the distance matrix (pipeline/matrix.py); neither changes here. For each distinct
ordered stop sequence this module asks OSRM's `route` service for the street path through the
stops in that order, keeping the order exactly.

    status "road"      OSRM geometry (polyline6) plus OSRM's own distance/duration for the path,
                       kept to cross-check against the matrix km used for costs.
    status "straight"  FALLBACK: straight segments between stops, drawn dashed and labelled
                       approximate in the app. No road distance is claimed for it.

Results are cached in cache/route_geometry.json (successes only), keyed by the coordinates and
the OSRM data version, so an unchanged run makes no requests. Nothing here is needed at view
time: the static site reads the geometry from results.json.

Usage:
    python -m pipeline.geometry [--osrm-url http://localhost:5050] [--refresh]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.parse
from pathlib import Path

from pipeline.load import DEFAULT_CLEAN, load_clean
from pipeline.matrix import DEFAULT_OSRM_URL, MatrixError, _http_json, encode_polyline, osrm_data_version

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / "cache" / "route_geometry.json"
DEFAULT_SIM = ROOT / "out" / "simulation.json"
DEFAULT_OUT = ROOT / "out" / "route_geometry.json"
MAX_WAYPOINTS = 500  # far above any truck-day here; guards against a malformed request
SIMPLIFY_DEG = 0.00003  # ~3 m: invisible at city zoom, keeps results.json small (the cache keeps full detail)


def _valid_coord(lat, lon) -> bool:
    return (isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and math.isfinite(lat)
            and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180)


def decode_polyline(encoded: str, precision: int = 6) -> list[tuple[float, float]]:
    """Inverse of matrix.encode_polyline. Raises ValueError on malformed input."""
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("empty polyline")
    coords, index, lat, lon, factor = [], 0, 0, 0, 10 ** precision
    while index < len(encoded):
        for which in (0, 1):
            shift = result = 0
            while True:
                if index >= len(encoded):
                    raise ValueError("truncated polyline")
                b = ord(encoded[index]) - 63
                index += 1
                if b < 0 or b > 63:
                    raise ValueError("invalid polyline character")
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if which == 0:
                lat += delta
            else:
                lon += delta
        coords.append((lat / factor, lon / factor))
    return coords


def straight(coords: list[tuple[float, float]], reason: str) -> dict:
    return {"status": "straight", "reason": reason, "coords": [[round(a, 6), round(b, 6)] for a, b in coords]}


def route_geometry(coords: list[tuple[float, float]], osrm_url: str = DEFAULT_OSRM_URL, timeout: float = 30.0,
                   fetch=_http_json) -> dict:
    """Street geometry through `coords` ([(lat, lon), ...], already in visiting order).

    Never raises for service problems: an unavailable service or invalid response gives a
    labelled straight-segment fallback. Raises ValueError only for invalid input coordinates.
    """
    if len(coords) < 2:
        raise ValueError("a route needs at least two points")
    if len(coords) > MAX_WAYPOINTS:
        raise ValueError(f"too many waypoints ({len(coords)} > {MAX_WAYPOINTS})")
    bad = [i for i, (lat, lon) in enumerate(coords) if not _valid_coord(lat, lon)]
    if bad:
        raise ValueError(f"invalid coordinates at positions {bad[:5]}")

    poly = urllib.parse.quote(encode_polyline(coords), safe="")
    url = (f"{osrm_url}/route/v1/driving/polyline({poly})"
           "?overview=full&geometries=polyline6&continue_straight=false")
    try:
        r = fetch(url, timeout)
    except (urllib.error.URLError, OSError, MatrixError, ValueError) as e:
        return straight(coords, f"routing service unavailable ({type(e).__name__})")

    if not isinstance(r, dict) or r.get("code") != "Ok" or not r.get("routes"):
        code = r.get("code") if isinstance(r, dict) else type(r).__name__
        return straight(coords, f"routing service returned no route ({code})")
    route = r["routes"][0]
    try:
        path = decode_polyline(route["geometry"])
        dist, dur = float(route["distance"]), float(route["duration"])
    except (KeyError, TypeError, ValueError) as e:
        return straight(coords, f"invalid routing response ({e})")
    if len(path) < 2 or not all(_valid_coord(a, b) for a, b in path) or not (math.isfinite(dist) and dist >= 0):
        return straight(coords, "invalid routing response (bad geometry or distance)")
    return {"status": "road", "polyline6": route["geometry"], "points": len(path),
            "osrm_distance_m": round(dist, 1), "osrm_duration_s": round(dur, 1)}


def simplified(g: dict, tolerance: float = SIMPLIFY_DEG) -> dict:
    """Copy of a road geometry with the path simplified (Douglas-Peucker); endpoints are kept."""
    if g["status"] != "road":
        return g
    from shapely.geometry import LineString

    path = decode_polyline(g["polyline6"])
    line = LineString([(lon, lat) for lat, lon in path]).simplify(tolerance, preserve_topology=False)
    pts = [(lat, lon) for lon, lat in line.coords]
    return {**g, "polyline6": encode_polyline(pts, precision=6), "points": len(pts), "points_full": len(path)}


def sequence_key(coords: list[tuple[float, float]], data_version: str | None) -> str:
    payload = json.dumps({"c": [[round(a, 6), round(b, 6)] for a, b in coords], "v": data_version})
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def route_coords(stop_ids: list[str], points: dict[str, tuple[float, float]], depot: tuple[float, float]):
    return [depot] + [points[s] for s in stop_ids] + [depot]


def build_geometries(sim: dict, clean: dict, osrm_url: str, cache_path: Path, refresh: bool = False,
                     fetch=_http_json) -> dict:
    """Geometry for every distinct route in a simulation, plus a key per route (by stop sequence)."""
    pts = {r["id"]: (r["lat"], r["lon"]) for r in clean["containers"] + clean["candidates"]}
    depot = (clean["depot"]["lat"], clean["depot"]["lon"])
    version = osrm_data_version()
    cache = {} if refresh or not cache_path.exists() else json.loads(cache_path.read_text(encoding="utf-8"))

    geometries, by_seq, stats = {}, {}, {"requested": 0, "cached": 0, "road": 0, "straight": 0}
    for profile in sim["scenarios"].values():
        for policy in ("A", "B"):
            for run in profile[policy]["per_seed"]:
                for week in run["weeks"]:
                    for route in week["routes"]:
                        seq = tuple(route["stop_ids"])
                        if seq in by_seq:
                            continue
                        coords = route_coords(route["stop_ids"], pts, depot)
                        key = sequence_key(coords, version)
                        by_seq[seq] = key
                        if key in cache:
                            g = cache[key]
                            stats["cached"] += 1
                        else:
                            g = route_geometry(coords, osrm_url, fetch=fetch)
                            stats["requested"] += 1
                            if g["status"] == "road":
                                cache[key] = g
                        stats[g["status"]] += 1
                        geometries[key] = simplified(g)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")
    return {"data_version": version, "geometries": geometries,
            "route_keys": {"|".join(seq): key for seq, key in by_seq.items()}, "stats": stats}


def check_against_matrix(sim: dict, geo: dict) -> dict:
    """Largest relative gap between OSRM route-path distance and the matrix km used for costs."""
    gaps = []
    for profile in sim["scenarios"].values():
        for policy in ("A", "B"):
            for run in profile[policy]["per_seed"]:
                for week in run["weeks"]:
                    for route in week["routes"]:
                        g = geo["geometries"][geo["route_keys"]["|".join(route["stop_ids"])]]
                        if g["status"] == "road" and route["km"] > 0:
                            gaps.append(abs(g["osrm_distance_m"] / 1000 - route["km"]) / route["km"])
    return {"routes_checked": len(gaps), "max_rel_gap": round(max(gaps), 4) if gaps else None,
            "median_rel_gap": round(sorted(gaps)[len(gaps) // 2], 4) if gaps else None}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Road-following geometry for the simulated routes (display only).")
    ap.add_argument("--osrm-url", default=DEFAULT_OSRM_URL)
    ap.add_argument("--sim", type=Path, default=DEFAULT_SIM)
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args(argv)
    if not args.sim.exists():
        print(f"ERROR: {args.sim} not found; run `make simulate` first.", file=sys.stderr)
        return 1
    sim = json.loads(args.sim.read_text(encoding="utf-8"))
    clean = load_clean(DEFAULT_CLEAN)
    t0 = time.perf_counter()
    geo = build_geometries(sim, clean, args.osrm_url, args.cache, args.refresh)
    geo["matrix_check"] = check_against_matrix(sim, geo)
    geo["meta"] = {"matrix_key": sim["meta"]["matrix_key"], "data_source": clean["manifest"]["source"]}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(geo, separators=(",", ":")), encoding="utf-8")
    s, c = geo["stats"], geo["matrix_check"]
    print(f"Route geometry for {len(geo['geometries'])} distinct routes in {time.perf_counter() - t0:.1f} s: "
          f"{s['road']} road-following, {s['straight']} straight fallback ({s['cached']} from cache, "
          f"{s['requested']} requested)")
    if c["routes_checked"]:
        print(f"  OSRM path distance vs matrix km: median gap {c['median_rel_gap']:.2%}, max {c['max_rel_gap']:.2%} "
              f"over {c['routes_checked']} routes (costs always use the matrix km)")
    if s["straight"]:
        reasons = sorted({g["reason"] for g in geo["geometries"].values() if g["status"] == "straight"})
        print(f"  NOTE: {s['straight']} route(s) drawn as straight segments, labelled approximate: {'; '.join(reasons)}")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
