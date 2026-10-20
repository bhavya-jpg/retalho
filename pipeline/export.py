"""Assemble out/results.json, the single contract between pipeline and web app (PLAN.md §4.3, M7).

Reads data/clean, config/assumptions.yaml, config/benchmarks.yaml and the stage outputs
(out/simulation.json, out/breakeven.json, out/coverage.json). Refuses to export if a stage
output is stale (built from other assumptions, points or distance matrix), validates the
result against schema/results.schema.json, and copies it to web/public/.

Usage:
    python -m pipeline.export
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import jsonschema
import yaml

from pipeline.load import DEFAULT_ASSUMPTIONS, DEFAULT_CLEAN, load_assumptions, load_clean
from pipeline.matrix import MatrixError, get_matrix, matrix_points, straight_line_violations
from pipeline.simulate import fingerprint

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
SCHEMA = ROOT / "schema" / "results.schema.json"
BENCHMARKS = ROOT / "config" / "benchmarks.yaml"
COST_VECTORS = ROOT / "tests" / "fixtures" / "cost_vectors.json"
WEB_PUBLIC = ROOT / "web" / "public"


class StaleError(Exception):
    pass


def git_commit() -> str:
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True,
                             check=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
        return sha + ("-dirty" if dirty else "")
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "uncommitted"


def data_sources(clean: dict, m: dict) -> list[dict]:
    """One entry per real source (from data/raw/<source>/sources.json when present), plus one naming
    exactly which inputs are synthetic or assumed, plus the road network."""
    layers = {"textile points": {r["source_type"] for r in clean["containers"]},
              "candidate sites": {r["source_type"] for r in clean["candidates"]},
              "population": {r["source_type"] for r in clean["demand_points"]},
              "depot location": {clean["depot"]["source_type"]},
              "boundary": {clean["boundary_props"]["source_type"]}}
    out = []
    sources_file = ROOT / "data" / "raw" / clean["manifest"]["source"] / "sources.json"
    if sources_file.exists():
        for key, src in json.loads(sources_file.read_text(encoding="utf-8")).items():
            used = {"ine": "population and boundary", "osm": "textile points and candidate sites"}.get(key)
            out.append({"name": f"{src['name']}{f' ({used})' if used else ''}",
                        "source_type": src.get("source_type", "public"),
                        "licence": src["licence"], "url": src.get("url")})
    synthetic = [name for name, types in layers.items() if "synthetic" in types]
    if synthetic:
        out.append({"name": f"Synthetic or assumed: {', '.join(synthetic)}", "source_type": "synthetic",
                    "licence": "Generated for this project", "url": None})
    if m["provider"] == "osrm":
        version = m["params"].get("data_version") or "unknown"
        out.append({"name": f"OpenStreetMap road network via Geofabrik ({version.split()[0]}), routed with OSRM",
                    "source_type": "public", "licence": "ODbL 1.0, © OpenStreetMap contributors",
                    "url": "https://www.openstreetmap.org/copyright"})
    return out


def _read(name: str) -> dict:
    path = OUT / name
    if not path.exists():
        raise StaleError(f"{path.relative_to(ROOT)} is missing; run `make all`")
    return json.loads(path.read_text(encoding="utf-8"))


def route_geometry_for(sim: dict, geo: dict | None) -> dict | None:
    """Geometry block for results.json, or None (the app then draws labelled straight segments).
    Refuses geometry built for a different matrix, or one that misses any simulated route."""
    if geo is None:
        return None
    if geo.get("meta", {}).get("matrix_key") != sim["meta"]["matrix_key"]:
        raise StaleError("route geometry was built for a different distance matrix; run `make geometry`")
    keys = geo["route_keys"]
    for profile in sim["scenarios"].values():
        for policy in ("A", "B"):
            for run in profile[policy]["per_seed"]:
                for week in run["weeks"]:
                    for route in week["routes"]:
                        if "|".join(route["stop_ids"]) not in keys:
                            raise StaleError("route geometry is missing simulated routes; run `make geometry`")
    used = set(keys.values())
    return {"data_version": geo["data_version"], "stats": geo["stats"], "matrix_check": geo.get("matrix_check"),
            "route_keys": keys, "geometries": {k: g for k, g in geo["geometries"].items() if k in used}}


def optimisation_benchmark_for(sim: dict, bench: dict | None, a: dict) -> dict | None:
    """S2 block for results.json; refuses a benchmark built from other assumptions, matrix or simulation."""
    if bench is None:
        return None
    meta = bench.get("meta", {})
    if (meta.get("assumptions_sha") != fingerprint(a) or meta.get("matrix_key") != sim["meta"]["matrix_key"]
            or meta.get("simulation_generated_at") != sim["meta"]["generated_at"]):
        raise StaleError("optimisation benchmark is stale; run `make benchmark`")
    return {k: v for k, v in bench.items() if k != "meta"}


def build_results(clean: dict, a: dict, m: dict, sim: dict, be: dict, cov: dict, benchmarks: list,
                  geo: dict | None = None, bench: dict | None = None) -> dict:
    sha = fingerprint(a)
    problems = []
    for name, meta in (("simulation", sim["meta"]), ("breakeven", be["meta"])):
        if meta.get("assumptions_sha") != sha:
            problems.append(f"{name} was built with different assumptions")
        if meta.get("matrix_key") != m["key"]:
            problems.append(f"{name} was built on a different distance matrix")
    if cov.get("meta", {}).get("inputs_sha") != clean["manifest"]["inputs"]:
        problems.append("coverage was built from different input data")
    if cov["radius_m"] != a["coverage_radius_m"]["value"]:
        problems.append("coverage radius differs from coverage_radius_m")
    net = sim["meta"].get("collection_network", {})
    if net.get("existing") != [c["id"] for c in clean["containers"]]:
        problems.append("simulation was built on different existing containers")
    if net.get("n_new"):
        by_n = {x["n_new"]: x["site_ids"] for x in cov["additions"]}
        if by_n.get(net["n_new"]) != net.get("proposed"):
            problems.append("simulation's proposed sites differ from the coverage solution")
    if problems:
        raise StaleError("stage outputs are stale: " + "; ".join(problems) + ". Run `make all`.")

    def fc(records: list[dict]) -> dict:
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
             "properties": {k: v for k, v in r.items() if k not in ("lon", "lat")}} for r in records]}

    calibration = None
    cal_path = ROOT / "cache" / "calibration.json"
    if m["provider"] == "osrm" and cal_path.exists():
        calibration = json.loads(cal_path.read_text(encoding="utf-8"))

    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "git_commit": git_commit(),
            "label": "Inputs and results are labelled per item: Measured, Simulated, Benchmark or Assumption",
            "data_source": clean["manifest"]["source"],
            "distance_provider": m["provider"],
            "distance_label": m["label"],
            "distance_checks": {"road_shorter_than_straight_line": len(straight_line_violations(m)),
                                "max_snap_m": max(m.get("snap_m") or [0]),
                                "calibration": calibration},
            "data_sources": data_sources(clean, m),
            "seeds": sim["meta"]["seeds"],
            "horizon_weeks": sim["meta"]["horizon_weeks"],
            "threshold_T": sim["meta"]["threshold_T"],
            "fleet": sim["meta"]["fleet"],
            "simulation_label": sim["meta"]["label"],
            "collection_network": sim["meta"].get("collection_network"),
        },
        "assumptions": [{"key": k, "value": e["value"], "unit": str(e["unit"]), "source_type": e["source_type"],
                         "note": " ".join(str(e["note"]).split())} for k, e in a.items()],
        "network": {"containers": fc(clean["containers"]), "candidates": fc(clean["candidates"]),
                    "depot": clean["depot"], "boundary": {"type": "FeatureCollection", "features": [{
                        "type": "Feature", "geometry": clean["boundary"].__geo_interface__,
                        "properties": clean["boundary_props"]}]}},
        "coverage": {k: v for k, v in cov.items() if k != "meta"},
        "scenarios": sim["scenarios"],
        "breakeven": {k: v for k, v in be.items() if k != "meta"},
        "benchmarks": benchmarks,
        "route_geometry": route_geometry_for(sim, geo),
        "optimisation_benchmark": optimisation_benchmark_for(sim, bench, a),
    }


DATASET_LABELS = {"synthetic": "Synthetic demo data", "public": "Public data (OpenStreetMap + INE Census 2021)",
                  "vitrus": "VITRUS data"}


def _layer_sources(res: dict) -> dict:
    n = res["network"]
    out = {k: sorted({f["properties"]["source_type"] for f in n[k]["features"]}) for k in ("containers", "candidates")}
    out["demand_points"] = sorted(res["coverage"].get("data_source_types", []))
    out["depot"] = [n["depot"]["source_type"]]
    out["boundary"] = sorted({f["properties"].get("source_type") for f in n["boundary"]["features"]})
    return out


def source_report(current: dict, others: dict[str, dict]) -> str:
    """Markdown: where every input and assumption comes from, and what changed vs the other datasets."""
    src = current["meta"]["data_source"]
    lines = [f"# Source report: {DATASET_LABELS.get(src, src)}", "",
             f"Generated {current['meta']['generated_at']}, distances: {current['meta']['distance_provider']}.", "",
             "## Inputs", "", "| Input | Source type |", "|---|---|"]
    lines += [f"| {k} | {', '.join(v)} |" for k, v in _layer_sources(current).items()]
    by_type: dict[str, list[str]] = {}
    for x in current["assumptions"]:
        by_type.setdefault(x["source_type"], []).append(x["key"])
    lines += ["", "## Assumptions by source", ""] + [f"- **{t}** ({len(ks)}): {', '.join(ks)}" for t, ks in sorted(by_type.items())]
    for name, other in others.items():
        lines += ["", f"## Changes vs {DATASET_LABELS.get(name, name)}", ""]
        a, b = _layer_sources(other), _layer_sources(current)
        changed = [f"- {k}: {', '.join(a[k])} -> {', '.join(b[k])}" for k in b if a.get(k) != b[k]]
        prev = {x["key"]: x for x in other["assumptions"]}
        for x in current["assumptions"]:
            o = prev.get(x["key"])
            if o is None:
                changed.append(f"- assumption {x['key']}: new ({x['source_type']})")
            elif o["source_type"] != x["source_type"] or o["value"] != x["value"]:
                changed.append(f"- assumption {x['key']}: {o['value']} ({o['source_type']}) -> {x['value']} ({x['source_type']})")
        lines += changed or ["- no changes in source types or assumption values"]
    return "\n".join(lines) + "\n"


def publish(results: dict) -> list[Path]:
    """Write out/results.json plus a per-dataset copy and index in web/public/ for the app's dataset switch."""
    src = results["meta"]["data_source"]
    text = json.dumps(results, ensure_ascii=False, separators=(",", ":")) + "\n"
    OUT.mkdir(exist_ok=True)
    WEB_PUBLIC.mkdir(parents=True, exist_ok=True)
    paths = [OUT / "results.json", WEB_PUBLIC / "results.json", WEB_PUBLIC / f"results-{src}.json"]
    for p in paths:
        p.write_text(text, encoding="utf-8")
    shutil.copyfile(COST_VECTORS, OUT / "test_vectors.json")

    index_path = WEB_PUBLIC / "datasets.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"datasets": []}
    entries = {d["source"]: d for d in index["datasets"] if (WEB_PUBLIC / d["file"]).exists()}
    entries[src] = {"source": src, "label": DATASET_LABELS.get(src, src), "file": f"results-{src}.json",
                    "generated_at": results["meta"]["generated_at"]}
    order = ["vitrus", "public", "synthetic"]
    datasets = sorted(entries.values(), key=lambda d: order.index(d["source"]) if d["source"] in order else 99)
    index_path.write_text(json.dumps({"default": datasets[0]["source"], "datasets": datasets}, indent=1) + "\n",
                          encoding="utf-8")

    others = {d["source"]: json.loads((WEB_PUBLIC / d["file"]).read_text(encoding="utf-8"))
              for d in datasets if d["source"] != src}
    report = OUT / f"source_report_{src}.md"
    report.write_text(source_report(results, others), encoding="utf-8")
    return paths + [index_path, report]


def validate(results: dict) -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    jsonschema.validate(results, schema, cls=jsonschema.Draft202012Validator)


def main(argv: list[str] | None = None) -> int:
    a = load_assumptions(DEFAULT_ASSUMPTIONS)
    clean = load_clean(DEFAULT_CLEAN)
    try:
        sim, be, cov = _read("simulation.json"), _read("breakeven.json"), _read("coverage.json")
        # Same provider choice as the stage that built the simulation, read from cache.
        m = get_matrix(matrix_points(clean), sim["meta"]["distance_provider"],
                       detour_factor=a["detour_factor"]["value"], speed_kmh=a["fallback_speed_kmh"]["value"])
        benchmarks = yaml.safe_load(BENCHMARKS.read_text(encoding="utf-8")) or []
        geo_path = OUT / "route_geometry.json"
        geo = json.loads(geo_path.read_text(encoding="utf-8")) if geo_path.exists() else None
        if geo is None:
            print("NOTE: no out/route_geometry.json; the app will draw routes as straight segments (labelled).")
        bench_path = OUT / "benchmark.json"
        bench = json.loads(bench_path.read_text(encoding="utf-8")) if bench_path.exists() else None
        if bench is None:
            print("NOTE: no out/benchmark.json; the app will show the optimisation benchmark as unavailable.")
        results = build_results(clean, a, m, sim, be, cov, benchmarks, geo, bench)
        validate(results)
    except (StaleError, MatrixError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    except jsonschema.ValidationError as e:
        print(f"ERROR: results.json does not match the schema at {'/'.join(map(str, e.absolute_path))}: {e.message}",
              file=sys.stderr)
        return 1

    paths = publish(results)
    path = paths[0]
    print(f"Wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1024:.0f} KB, schema OK, "
          f"distances: {results['meta']['distance_provider']}, data: {results['meta']['data_source']}, "
          f"commit: {results['meta']['git_commit']})")
    for p in paths[1:]:
        print(f"  also {p.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
