"""Road distance and travel-time matrix with cache and a labelled fallback (PLAN.md M2).

Providers:
    osrm    Road distances and free-flow car travel times from a local OSRM server
            (`make osrm`). This is the only provider that gives road distance.
    approx  FALLBACK: straight-line distance x detour_factor, time at fallback_speed_kmh.
            Not road distance. The matrix records provider="approx" and a warning
            label, and every later output carries that label.

`auto` (the default) uses, in order: a cached OSRM matrix for exactly these points,
a live OSRM server, then approx (with a warning on stderr). It never mixes providers.

Usage:
    python -m pipeline.matrix [--provider auto|osrm|approx] [--refresh]
    python -m pipeline.matrix --print-bbox [--buffer-km 5]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from pipeline.load import DEFAULT_ASSUMPTIONS, DEFAULT_CLEAN, load_assumptions, load_clean

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / "cache"
OSRM_DATA_VERSION_FILE = ROOT / "cache" / "osrm" / "data_version.txt"
DEFAULT_OSRM_URL = os.environ.get("OSRM_URL", "http://localhost:5050")

EARTH_RADIUS_M = 6_371_008.8
SNAP_WARN_M = 250          # a point this far from the nearest road is probably misplaced
VIOLATION_TOL_M = 1.0      # OSRM rounds distances to 0.1 m; allow for rounding only
CALIBRATION_MIN_M = 300    # ignore very short pairs when calibrating ratios (snapping noise)


class MatrixError(Exception):
    """The matrix could not be built (OSRM error, unreachable pairs, bad input)."""


# ---------------------------------------------------------------- geometry helpers

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def encode_polyline(latlons: list[tuple[float, float]], precision: int = 5) -> str:
    """Google encoded-polyline format, used to keep OSRM request URLs short."""
    factor = 10 ** precision
    out, prev_lat, prev_lon = [], 0, 0
    for lat, lon in latlons:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            v = ~(delta << 1) if delta < 0 else delta << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


def matrix_points(clean: dict) -> list[dict]:
    """Depot first, then containers, then candidate sites (all ids are unique after M1)."""
    d = clean["depot"]
    pts = [{"id": str(d.get("id", "DEPOT")), "lat": d["lat"], "lon": d["lon"], "role": "depot"}]
    pts += [{"id": r["id"], "lat": r["lat"], "lon": r["lon"], "role": "container"} for r in clean["containers"]]
    pts += [{"id": r["id"], "lat": r["lat"], "lon": r["lon"], "role": "candidate"} for r in clean["candidates"]]
    return pts


def bbox(clean: dict, buffer_km: float) -> tuple[float, float, float, float]:
    """(min_lon, min_lat, max_lon, max_lat) of the boundary and depot, grown by buffer_km."""
    min_lon, min_lat, max_lon, max_lat = clean["boundary"].bounds
    d = clean["depot"]
    min_lon, max_lon = min(min_lon, d["lon"]), max(max_lon, d["lon"])
    min_lat, max_lat = min(min_lat, d["lat"]), max(max_lat, d["lat"])
    dlat = buffer_km / 110.574
    dlon = buffer_km / (111.320 * math.cos(math.radians((min_lat + max_lat) / 2)))
    return (round(min_lon - dlon, 4), round(min_lat - dlat, 4), round(max_lon + dlon, 4), round(max_lat + dlat, 4))


# ---------------------------------------------------------------- providers

def build_approx(points: list[dict], detour_factor: float, speed_kmh: float) -> dict:
    n = len(points)
    dist = [[0] * n for _ in range(n)]
    dur = [[0.0] * n for _ in range(n)]
    for i, a in enumerate(points):
        for j, b in enumerate(points):
            if i != j:
                m = haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) * detour_factor
                dist[i][j] = round(m)
                dur[i][j] = round(m / (speed_kmh / 3.6), 1)
    return {
        "provider": "approx",
        "label": (f"APPROXIMATE, not road distance: straight line x {detour_factor} detour factor, "
                  f"time at {speed_kmh} km/h"),
        "distances_m": dist,
        "durations_s": dur,
        "params": {"detour_factor": detour_factor, "speed_kmh": speed_kmh},
    }


def _http_json(url: str, timeout: float) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "retalho-pipeline"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:  # OSRM sends JSON error bodies with 4xx codes
        try:
            return json.loads(e.read())
        except (ValueError, OSError):
            raise MatrixError(f"OSRM returned HTTP {e.code} for {url[:120]}...") from e


def osrm_available(osrm_url: str, timeout: float = 2.0) -> bool:
    """True if an OSRM server answers a trivial nearest-road query."""
    try:
        r = _http_json(f"{osrm_url}/nearest/v1/driving/-8.2918,41.4425", timeout)
    except (urllib.error.URLError, OSError, MatrixError, ValueError):
        return False
    return r.get("code") == "Ok"


def build_osrm(points: list[dict], osrm_url: str, data_version: str | None, timeout: float = 120.0) -> dict:
    coords = encode_polyline([(p["lat"], p["lon"]) for p in points])
    url = f"{osrm_url}/table/v1/driving/polyline({urllib.parse.quote(coords, safe='')})?annotations=distance,duration"
    try:
        r = _http_json(url, timeout)
    except (urllib.error.URLError, OSError) as e:
        raise MatrixError(f"OSRM at {osrm_url} is not reachable ({e}). Run `make osrm`, or use --provider approx.") from e
    if r.get("code") != "Ok":
        raise MatrixError(f"OSRM table request failed: {r.get('code')}: {r.get('message')}")

    ids = [p["id"] for p in points]
    unreachable = [(ids[i], ids[j]) for i, row in enumerate(r["distances"]) for j, v in enumerate(row)
                   if v is None or r["durations"][i][j] is None]
    if unreachable:
        sample = ", ".join(f"{a}->{b}" for a, b in unreachable[:10])
        raise MatrixError(f"OSRM found no road route for {len(unreachable)} pair(s), e.g. {sample}. "
                          "Check that these points are on the road network covered by the OSRM extract.")

    n = len(points)
    dist = [[0 if i == j else round(r["distances"][i][j]) for j in range(n)] for i in range(n)]
    dur = [[0.0 if i == j else round(r["durations"][i][j], 1) for j in range(n)] for i in range(n)]
    return {
        "provider": "osrm",
        "label": f"Road distance and free-flow car time from OSRM (OSM data {data_version or 'unknown'})",
        "distances_m": dist,
        "durations_s": dur,
        "snapped": [s["location"] for s in r["sources"]],          # [lon, lat] on the road network
        "snap_m": [round(s.get("distance", 0.0), 1) for s in r["sources"]],
        "params": {"osrm_url": osrm_url, "profile": "car", "data_version": data_version},
    }


# ---------------------------------------------------------------- cache + selection

def osrm_data_version() -> str | None:
    try:
        return OSRM_DATA_VERSION_FILE.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def cache_key(points: list[dict], provider: str, params: dict) -> str:
    """Depends on exact ids and coordinates, the provider and its parameters (not the OSRM URL)."""
    params = {k: v for k, v in params.items() if k != "osrm_url"}
    payload = json.dumps({"points": [[p["id"], round(p["lat"], 6), round(p["lon"], 6)] for p in points],
                          "provider": provider, "params": params}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _cache_path(cache_dir: Path, key: str) -> Path:
    return Path(cache_dir) / f"matrix_{key}.json"


def _read_cache(cache_dir: Path, key: str) -> dict | None:
    path = _cache_path(cache_dir, key)
    if not path.exists():
        return None
    m = json.loads(path.read_text(encoding="utf-8"))
    m["cache_hit"] = True
    return m


def _finish(m: dict, points: list[dict], key: str, cache_dir: Path) -> dict:
    m.update(ids=[p["id"] for p in points], roles=[p["role"] for p in points],
             coords=[[p["lon"], p["lat"]] for p in points], key=key,
             created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    validate_matrix(m)
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    _cache_path(cache_dir, key).write_text(json.dumps(m, separators=(",", ":")), encoding="utf-8")
    m["cache_hit"] = False
    return m


def get_matrix(points: list[dict], provider: str = "auto", *, detour_factor: float, speed_kmh: float,
               osrm_url: str = DEFAULT_OSRM_URL, cache_dir: Path = DEFAULT_CACHE, refresh: bool = False,
               data_version: str | None = None) -> dict:
    """Return a validated N x N matrix for `points` (same order). See module docstring for providers."""
    if provider not in ("auto", "osrm", "approx"):
        raise ValueError(f"provider must be auto, osrm or approx, got {provider!r}")
    if not points:
        raise MatrixError("no points given")
    data_version = data_version if data_version is not None else osrm_data_version()
    osrm_params = {"profile": "car", "data_version": data_version}
    approx_params = {"detour_factor": detour_factor, "speed_kmh": speed_kmh}

    if provider in ("auto", "osrm"):
        key = cache_key(points, "osrm", osrm_params)
        if not refresh and (hit := _read_cache(cache_dir, key)):
            return hit
        if provider == "osrm" or osrm_available(osrm_url):
            return _finish(build_osrm(points, osrm_url, data_version), points, key, cache_dir)
        print(f"WARNING: OSRM not reachable at {osrm_url} and no cached OSRM matrix for these points. "
              "Falling back to APPROXIMATE distances (straight line x detour factor). "
              "Results will be labelled distance_provider=approx.", file=sys.stderr)

    key = cache_key(points, "approx", approx_params)
    if not refresh and (hit := _read_cache(cache_dir, key)):
        return hit
    return _finish(build_approx(points, detour_factor, speed_kmh), points, key, cache_dir)


# ---------------------------------------------------------------- checks + calibration

def validate_matrix(m: dict) -> None:
    n = len(m["ids"])
    for name in ("distances_m", "durations_s"):
        rows = m[name]
        if len(rows) != n or any(len(r) != n for r in rows):
            raise MatrixError(f"{name} is not {n} x {n}")
        for i, row in enumerate(rows):
            if row[i] != 0:
                raise MatrixError(f"{name}[{i}][{i}] = {row[i]}, expected 0")
            if any(v is None or not math.isfinite(v) or v < 0 for v in row):
                raise MatrixError(f"{name} row {m['ids'][i]} has missing, negative or non-finite values")


def straight_line_violations(m: dict, tol_m: float = VIOLATION_TOL_M) -> list[dict]:
    """Pairs whose road distance is shorter than the straight line between the (snapped) points.

    For OSRM the comparison uses the snapped road positions, since OSRM routes between those.
    """
    pts = m.get("snapped") or m["coords"]
    out = []
    for i, row in enumerate(m["distances_m"]):
        for j, d in enumerate(row):
            if i != j:
                sl = haversine_m(pts[i][1], pts[i][0], pts[j][1], pts[j][0])
                if d + tol_m < sl:
                    out.append({"from": m["ids"][i], "to": m["ids"][j], "road_m": d, "straight_m": round(sl, 1)})
    return out


def calibrate(m: dict) -> dict | None:
    """Median road/straight-line ratio and median speed over pairs at least CALIBRATION_MIN_M apart.

    Uses the original point coordinates, which is what the approx fallback sees.
    """
    if m["provider"] != "osrm":
        return None
    ratios, speeds = [], []
    c = m["coords"]
    for i, row in enumerate(m["distances_m"]):
        for j, d in enumerate(row):
            sl = haversine_m(c[i][1], c[i][0], c[j][1], c[j][0])
            if i != j and sl >= CALIBRATION_MIN_M and m["durations_s"][i][j] > 0:
                ratios.append(d / sl)
                speeds.append(d / m["durations_s"][i][j] * 3.6)
    if not ratios:
        return None
    q = statistics.quantiles(ratios, n=4)
    return {"pairs": len(ratios), "detour_factor_median": round(statistics.median(ratios), 3),
            "detour_factor_iqr": [round(q[0], 3), round(q[2], 3)],
            "speed_kmh_median": round(statistics.median(speeds), 1), "data_version": m["params"].get("data_version")}


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build (or read from cache) the distance matrix for data/clean.")
    ap.add_argument("--provider", choices=["auto", "osrm", "approx"], default="auto")
    ap.add_argument("--osrm-url", default=DEFAULT_OSRM_URL)
    ap.add_argument("--clean", type=Path, default=DEFAULT_CLEAN)
    ap.add_argument("--assumptions", type=Path, default=DEFAULT_ASSUMPTIONS)
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and rebuild")
    ap.add_argument("--print-bbox", action="store_true", help="print the OSRM clip box and exit")
    ap.add_argument("--buffer-km", type=float, default=5.0)
    args = ap.parse_args(argv)

    clean = load_clean(args.clean)
    if args.print_bbox:
        print(",".join(str(v) for v in bbox(clean, args.buffer_km)))
        return 0

    a = load_assumptions(args.assumptions)
    points = matrix_points(clean)
    t0 = time.perf_counter()
    try:
        m = get_matrix(points, args.provider, detour_factor=a["detour_factor"]["value"],
                       speed_kmh=a["fallback_speed_kmh"]["value"], osrm_url=args.osrm_url,
                       cache_dir=args.cache, refresh=args.refresh)
    except MatrixError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    elapsed = time.perf_counter() - t0

    roles = {r: m["roles"].count(r) for r in ("depot", "container", "candidate")}
    n = len(m["ids"])
    print(f"Distance matrix: {n} x {n} points ({roles['depot']} depot, {roles['container']} containers, "
          f"{roles['candidate']} candidates)")
    print(f"  provider: {m['provider']}  ({m['label']})")
    print(f"  {'read from cache' if m['cache_hit'] else 'built and cached'} in {elapsed:.2f} s: "
          f"{_cache_path(args.cache, m['key']).relative_to(ROOT) if args.cache.is_relative_to(ROOT) else m['key']}")
    print("  checks: square, diagonal 0, all values finite and non-negative: OK")

    violations = straight_line_violations(m)
    print(f"  road distance shorter than straight line: {len(violations)} pair(s)")
    for v in violations[:5]:
        print(f"    {v['from']} -> {v['to']}: road {v['road_m']} m < straight {v['straight_m']} m")

    if m["provider"] == "osrm":
        far = [(m["ids"][i], s) for i, s in enumerate(m["snap_m"]) if s > SNAP_WARN_M]
        i_max = max(range(n), key=lambda i: m["snap_m"][i])
        print(f"  snap to road: max {m['snap_m'][i_max]} m ({m['ids'][i_max]}); "
              f"{len(far)} point(s) more than {SNAP_WARN_M} m from a road")
        for pid, s in far[:10]:
            print(f"    WARNING: {pid} is {s} m from the nearest road")
        cal = calibrate(m)
        if cal:
            (args.cache / "calibration.json").write_text(json.dumps(cal, indent=1) + "\n", encoding="utf-8")
            print(f"  calibration ({cal['pairs']} pairs >= {CALIBRATION_MIN_M} m): median road/straight ratio "
                  f"{cal['detour_factor_median']} (IQR {cal['detour_factor_iqr'][0]}-{cal['detour_factor_iqr'][1]}), "
                  f"median speed {cal['speed_kmh_median']} km/h")
            print("    -> use these as detour_factor and fallback_speed_kmh in config/assumptions.yaml")
    else:
        print("  NOTE: approximate distances. Every result built on this matrix is labelled distance_provider=approx.")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
