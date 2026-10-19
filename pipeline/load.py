"""Load, validate and normalise Retalho input data (PLAN.md §4.1).

Reads a raw source folder (``data/raw/<source>/``) and writes validated,
normalised files to ``data/clean/``:

    containers.geojson     existing textile points   (id, kind=existing, capacity_kg, site_type, source_type)
    candidates.geojson     possible new sites        (id, kind=candidate, site_type, source_type)
    demand_points.geojson  population-weighted pts  (id, population, source_type)
    depot.json             truck depot               (lat, lon, name, source_type)
    boundary.geojson       municipality polygon      (source_type)
    manifest.json          counts, source labels, warnings, input hashes

Point layers may be GeoJSON (Point features) or CSV (``lat`` and ``lon`` columns).
Validation collects every problem and raises one ValidationError listing them all.

Usage:
    python -m pipeline.load --source synthetic [--raw-root data/raw] [--out data/clean]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import yaml
from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_ROOT = ROOT / "data" / "raw"
DEFAULT_CLEAN = ROOT / "data" / "clean"
DEFAULT_ASSUMPTIONS = ROOT / "config" / "assumptions.yaml"

DATA_SOURCE_TYPES = {"sponsor", "public", "synthetic"}
ASSUMPTION_SOURCE_TYPES = {"sponsor", "public", "assumption"}
SITE_TYPES = {"ecoponto", "standalone", "other"}

# Required properties per point layer, and the `kind` each layer implies.
POINT_LAYERS: dict[str, dict] = {
    "containers": {"required": ["id", "kind", "capacity_kg", "site_type", "source_type"], "kind": "existing"},
    "candidates": {"required": ["id", "kind", "site_type", "source_type"], "kind": "candidate"},
    "demand_points": {"required": ["id", "population", "source_type"], "kind": None},
}

REQUIRED_ASSUMPTIONS = [
    "container_capacity_kg", "fill_rate_profiles", "fill_weekly_cv", "threshold_T", "service_min_per_stop",
    "collection_days_per_week", "collection_network_new_points", "trucks", "truck_capacity_kg", "truck_speed_factor", "shift_h", "cost_per_km", "crew_cost_per_h",
    "fixed_cost_per_truck_day", "new_point_cost", "coverage_radius_m", "detour_factor",
    "fallback_speed_kmh", "seeds", "horizon_weeks",
]


class ValidationError(Exception):
    """Raised when input data break the data contract. ``problems`` lists every issue found."""

    def __init__(self, where: str, problems: list[str]):
        self.where = where
        self.problems = problems
        lines = "\n".join(f"  - {p}" for p in problems)
        super().__init__(
            f"Input validation failed for {where} ({len(problems)} problem"
            f"{'s' if len(problems) != 1 else ''}):\n{lines}"
        )


# ---------------------------------------------------------------- assumptions

def load_assumptions(path: Path = DEFAULT_ASSUMPTIONS) -> dict[str, dict]:
    """Read config/assumptions.yaml and check every entry has value, unit, source_type and note."""
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    problems = []
    for key in REQUIRED_ASSUMPTIONS:
        if key not in data:
            problems.append(f"{key}: missing")
    for key, entry in data.items():
        if not isinstance(entry, dict):
            problems.append(f"{key}: must be a mapping with value, unit, source_type, note")
            continue
        for field in ("value", "unit", "source_type", "note"):
            if field not in entry:
                problems.append(f"{key}: missing '{field}'")
        if "source_type" in entry and entry["source_type"] not in ASSUMPTION_SOURCE_TYPES:
            problems.append(f"{key}: source_type must be one of {sorted(ASSUMPTION_SOURCE_TYPES)}, "
                            f"got {entry['source_type']!r}")
        if "note" in entry and not str(entry["note"] or "").strip():
            problems.append(f"{key}: note is empty; say where the value comes from")
        value = entry.get("value")
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value < 0:
            problems.append(f"{key}: value must not be negative, got {value}")
    if problems:
        raise ValidationError(str(path), problems)
    return data


# ---------------------------------------------------------------- reading raw files

def _find(raw_dir: Path, layer: str) -> Path | None:
    for ext in (".geojson", ".csv"):
        p = raw_dir / f"{layer}{ext}"
        if p.exists():
            return p
    return None


def _read_points(path: Path, problems: list[str]) -> list[dict]:
    """Return records as flat dicts with `lon`/`lat` keys plus all properties."""
    records = []
    if path.suffix == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as f:
            for i, row in enumerate(csv.DictReader(f), start=1):
                rec = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k}
                rec["_row"] = f"row {i + 1}"  # +1 for the header line
                records.append(rec)
        return records

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        problems.append(f"{path.name}: not valid JSON ({e})")
        return []
    if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
        problems.append(f"{path.name}: expected a GeoJSON FeatureCollection")
        return []
    for i, feat in enumerate(data["features"], start=1):
        geom = (feat or {}).get("geometry") or {}
        rec = dict((feat or {}).get("properties") or {})
        rec["_row"] = f"feature #{i}"
        if geom.get("type") != "Point" or not isinstance(geom.get("coordinates"), list) or len(geom["coordinates"]) < 2:
            rec["_geom_error"] = f"geometry must be a Point, got {geom.get('type')!r}"
        else:
            rec["lon"], rec["lat"] = geom["coordinates"][0], geom["coordinates"][1]
        records.append(rec)
    return records


def _num(value) -> float | None:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _label(filename: str, rec: dict) -> str:
    rid = rec.get("id")
    return f"{filename}, record {rid}" if rid not in (None, "") else f"{filename}, {rec.get('_row', '?')}"


# ---------------------------------------------------------------- validation + normalisation

def _check_point_layer(layer: str, filename: str, records: list[dict], boundary: BaseGeometry | None,
                       problems: list[str]) -> list[dict]:
    spec = POINT_LAYERS[layer]
    clean = []
    for rec in records:
        where = _label(filename, rec)
        bad = False

        if spec["kind"] and rec.get("kind") in (None, ""):
            rec["kind"] = spec["kind"]  # the file name implies the kind
        for field in spec["required"]:
            if rec.get(field) in (None, ""):
                problems.append(f"{where}: missing required field '{field}'")
                bad = True

        if "_geom_error" in rec:
            problems.append(f"{where}: {rec['_geom_error']}")
            bad = True
        else:
            lon, lat = _num(rec.get("lon")), _num(rec.get("lat"))
            if lon is None or lat is None:
                problems.append(f"{where}: lat/lon missing or not numeric")
                bad = True
            elif not (-180 <= lon <= 180 and -90 <= lat <= 90):
                problems.append(f"{where}: coordinates out of range (lon={lon}, lat={lat})")
                bad = True
            else:
                rec["lon"], rec["lat"] = round(lon, 6), round(lat, 6)
                if boundary is not None and not boundary.covers(Point(lon, lat)):
                    problems.append(f"{where}: point ({lat:.5f}, {lon:.5f}) is outside the municipality boundary")
                    bad = True

        st = rec.get("source_type")
        if st not in (None, "") and st not in DATA_SOURCE_TYPES:
            problems.append(f"{where}: source_type must be one of {sorted(DATA_SOURCE_TYPES)}, got {st!r}")
            bad = True
        if spec["kind"] and rec.get("kind") not in (None, "", spec["kind"]):
            problems.append(f"{where}: kind must be '{spec['kind']}' in {filename}, got {rec['kind']!r}")
            bad = True
        if "site_type" in spec["required"] and rec.get("site_type") not in (None, ""):
            rec["site_type"] = str(rec["site_type"]).strip().lower()
            if rec["site_type"] not in SITE_TYPES:
                problems.append(f"{where}: site_type must be one of {sorted(SITE_TYPES)}, got {rec['site_type']!r}")
                bad = True
        if "capacity_kg" in spec["required"] and rec.get("capacity_kg") not in (None, ""):
            cap = _num(rec["capacity_kg"])
            if cap is None or cap <= 0:
                problems.append(f"{where}: capacity_kg must be a positive number, got {rec['capacity_kg']!r}")
                bad = True
            else:
                rec["capacity_kg"] = int(cap) if cap.is_integer() else cap
        if "population" in spec["required"] and rec.get("population") not in (None, ""):
            pop = _num(rec["population"])
            if pop is None or pop < 0:
                problems.append(f"{where}: population must be a non-negative number, got {rec['population']!r}")
                bad = True
            else:
                rec["population"] = int(pop) if pop.is_integer() else pop

        rec["id"] = str(rec.get("id", "")).strip()
        if not bad:
            clean.append({k: v for k, v in rec.items() if not k.startswith("_")})
    return clean


def _read_boundary(raw_dir: Path, problems: list[str]) -> tuple[BaseGeometry | None, dict]:
    path = raw_dir / "boundary.geojson"
    if not path.exists():
        problems.append("boundary.geojson: file missing")
        return None, {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        problems.append(f"boundary.geojson: not valid JSON ({e})")
        return None, {}
    feats = data.get("features") if data.get("type") == "FeatureCollection" else [data]
    if not feats or len(feats) != 1:
        problems.append("boundary.geojson: expected exactly one boundary feature")
        return None, {}
    feat = feats[0]
    props = dict(feat.get("properties") or {})
    try:
        geom = shape(feat.get("geometry") if feat.get("type") == "Feature" else feat)
    except Exception as e:  # shapely raises several types for malformed geometry
        problems.append(f"boundary.geojson: unreadable geometry ({e})")
        return None, props
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        problems.append(f"boundary.geojson: geometry must be a Polygon or MultiPolygon, got {geom.geom_type}")
        return None, props
    if not geom.is_valid:
        problems.append("boundary.geojson: polygon is not valid (self-intersecting or malformed)")
        return None, props
    if props.get("source_type") not in DATA_SOURCE_TYPES:
        problems.append(f"boundary.geojson: source_type must be one of {sorted(DATA_SOURCE_TYPES)}, "
                        f"got {props.get('source_type')!r}")
    return geom, props


def _read_depot(raw_dir: Path, boundary: BaseGeometry | None, problems: list[str],
                warnings: list[str]) -> dict | None:
    path = raw_dir / "depot.json"
    if not path.exists():
        problems.append("depot.json: file missing")
        return None
    try:
        depot = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        problems.append(f"depot.json: not valid JSON ({e})")
        return None
    for field in ("lat", "lon", "name", "source_type"):
        if depot.get(field) in (None, ""):
            problems.append(f"depot.json: missing required field '{field}'")
    if depot.get("source_type") not in (None, "") and depot["source_type"] not in DATA_SOURCE_TYPES:
        problems.append(f"depot.json: source_type must be one of {sorted(DATA_SOURCE_TYPES)}, "
                        f"got {depot['source_type']!r}")
    lon, lat = _num(depot.get("lon")), _num(depot.get("lat"))
    if depot.get("lon") not in (None, "") and depot.get("lat") not in (None, ""):
        if lon is None or lat is None or not (-180 <= lon <= 180 and -90 <= lat <= 90):
            problems.append(f"depot.json: invalid coordinates (lat={depot.get('lat')!r}, lon={depot.get('lon')!r})")
        else:
            depot["lon"], depot["lat"] = round(lon, 6), round(lat, 6)
            # A real depot may sit just outside the municipality, so this is a warning, not an error.
            if boundary is not None and not boundary.covers(Point(lon, lat)):
                warnings.append("depot.json: depot lies outside the municipality boundary")
    depot.setdefault("id", "DEPOT")
    return depot


def load_raw(raw_dir: Path) -> dict:
    """Validate and normalise one raw source folder. Raises ValidationError listing every problem."""
    raw_dir = Path(raw_dir)
    if not raw_dir.is_dir():
        raise ValidationError(str(raw_dir), [f"source folder {raw_dir} does not exist"])

    problems: list[str] = []
    warnings: list[str] = []
    boundary, boundary_props = _read_boundary(raw_dir, problems)

    layers: dict[str, list[dict]] = {}
    inputs: dict[str, Path] = {}
    for layer in POINT_LAYERS:
        path = _find(raw_dir, layer)
        if path is None:
            problems.append(f"{layer}: no {layer}.geojson or {layer}.csv found")
            layers[layer] = []
            continue
        inputs[layer] = path
        layers[layer] = _check_point_layer(layer, path.name, _read_points(path, problems), boundary, problems)
        if not layers[layer]:
            problems.append(f"{path.name}: contains no valid records")

    depot = _read_depot(raw_dir, boundary, problems, warnings)

    # ids must be unique across every point layer (they share one distance matrix later).
    seen: dict[str, str] = {}
    for layer, recs in layers.items():
        for rec in recs:
            if rec["id"] in seen:
                problems.append(f"{layer}, record {rec['id']}: duplicate id (already used in {seen[rec['id']]})")
            else:
                seen[rec["id"]] = layer
    if depot and str(depot.get("id")) in seen:
        problems.append(f"depot.json: id {depot['id']!r} clashes with a record in {seen[str(depot['id'])]}")

    if problems:
        raise ValidationError(str(raw_dir), problems)

    for recs in layers.values():
        recs.sort(key=lambda r: r["id"])
    inputs.update({"depot": raw_dir / "depot.json", "boundary": raw_dir / "boundary.geojson"})
    return {
        **layers,
        "depot": depot,
        "boundary": boundary,
        "boundary_props": boundary_props,
        "warnings": warnings,
        "inputs": inputs,
    }


# ---------------------------------------------------------------- writing clean files

def _to_feature_collection(records: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
         "properties": {k: v for k, v in r.items() if k not in ("lon", "lat")}}
        for r in records
    ]}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_clean(data: dict, out_dir: Path, source: str) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "containers.geojson": _to_feature_collection(data["containers"]),
        "candidates.geojson": _to_feature_collection(data["candidates"]),
        "demand_points.geojson": _to_feature_collection(data["demand_points"]),
        "depot.json": data["depot"],
        "boundary.geojson": {"type": "FeatureCollection", "features": [{
            "type": "Feature", "geometry": data["boundary"].__geo_interface__, "properties": data["boundary_props"],
        }]},
    }
    layer_names = ("containers", "candidates", "demand_points")
    files["manifest.json"] = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "counts": {k: len(data[k]) for k in layer_names},
        "source_types": {
            **{k: dict(Counter(r["source_type"] for r in data[k])) for k in layer_names},
            "depot": data["depot"]["source_type"],
            "boundary": data["boundary_props"]["source_type"],
        },
        "population_total": sum(r["population"] for r in data["demand_points"]),
        "warnings": data["warnings"],
        "inputs": {k: {"file": p.name, "sha256": _sha256(p)} for k, p in data["inputs"].items()},
    }
    written = []
    for name, payload in files.items():
        path = out_dir / name
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        written.append(path)
    return written


def load_clean(clean_dir: Path = DEFAULT_CLEAN) -> dict:
    """Read the validated files written by write_clean (used by later pipeline stages)."""
    clean_dir = Path(clean_dir)

    def read(name: str):
        return json.loads((clean_dir / name).read_text(encoding="utf-8"))

    def points(name: str) -> list[dict]:
        return [{**f["properties"], "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1]}
                for f in read(name)["features"]]

    boundary = read("boundary.geojson")["features"][0]
    return {
        "containers": points("containers.geojson"),
        "candidates": points("candidates.geojson"),
        "demand_points": points("demand_points.geojson"),
        "depot": read("depot.json"),
        "boundary": shape(boundary["geometry"]),
        "boundary_props": boundary["properties"],
        "manifest": read("manifest.json"),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Validate raw inputs and write data/clean/.")
    ap.add_argument("--source", default="synthetic", help="folder name under the raw root (e.g. synthetic, osm, vitrus)")
    ap.add_argument("--raw-root", type=Path, default=DEFAULT_RAW_ROOT)
    ap.add_argument("--out", type=Path, default=DEFAULT_CLEAN)
    ap.add_argument("--assumptions", type=Path, default=DEFAULT_ASSUMPTIONS)
    args = ap.parse_args(argv)

    try:
        assumptions = load_assumptions(args.assumptions)
        data = load_raw(args.raw_root / args.source)
    except ValidationError as e:
        print(e, file=sys.stderr)
        print("\nFix the listed records and run `make data` again.", file=sys.stderr)
        return 1

    paths = write_clean(data, args.out, args.source)
    labels = sorted({r["source_type"] for k in ("containers", "candidates", "demand_points") for r in data[k]})
    print(f"Validated source '{args.source}' -> {args.out}")
    print(f"  containers={len(data['containers'])} candidates={len(data['candidates'])} "
          f"demand_points={len(data['demand_points'])} "
          f"population={sum(r['population'] for r in data['demand_points'])}")
    print(f"  data source types: {', '.join(labels)}")
    unconfirmed = [k for k, v in assumptions.items() if v["source_type"] == "assumption"]
    print(f"  assumptions: {len(assumptions)} loaded, {len(unconfirmed)} still unconfirmed (source_type=assumption)")
    if "synthetic" in labels:
        print("  NOTE: this dataset contains SYNTHETIC records; results built on it are illustrative only.")
    for w in data["warnings"]:
        print(f"  WARNING: {w}")
    for p in paths:
        print(f"  wrote {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
