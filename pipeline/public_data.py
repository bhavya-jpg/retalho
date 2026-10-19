"""Build the PUBLIC input dataset (data/raw/public/) from OpenStreetMap and INE Census 2021.

    boundary.geojson       union of INE BGRI 2021 subsections for the municipality (official census geometry)
    demand_points.geojson  one point per subsection (inside it), weighted by resident population N_INDIVIDUOS
    containers.geojson     OSM amenity=recycling with recycling:clothes=yes inside the boundary
    candidates.geojson     other OSM recycling containers inside the boundary (de-duplicated)
    depot.json             ASSUMED location from config/public_source.yaml (labelled synthetic)

OSM shows what mappers have recorded, which may not be every textile container in use;
VITRUS's own list (data/raw/vitrus/) would replace containers.geojson.

Run via `make public-data`, which first extracts the OSM recycling features with osmium.

Usage:
    python -m pipeline.public_data --osm cache/osm/work/recycling-pt.geojsonseq --bgri cache/ine/bgri_0308/BGRI2021_0308.gpkg
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import yaml
from pyproj import Transformer
from shapely.geometry import Point, mapping, shape

from pipeline.load import DEFAULT_ASSUMPTIONS, load_assumptions

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "public_source.yaml"
DEFAULT_OUT = ROOT / "data" / "raw" / "public"
PT_TM06 = "EPSG:3763"

INE = {"name": "INE, Censos 2021, Base Geográfica de Referenciação de Informação (BGRI2021)",
       "licence": "INE open data; reuse with source citation", "url": "https://mapas.ine.pt/download/index2021.phtml"}
OSM = {"name": "OpenStreetMap contributors, via Geofabrik", "licence": "ODbL 1.0",
       "url": "https://www.openstreetmap.org/copyright"}


def read_osm(path: Path) -> list[dict]:
    """GeoJSON-seq from `osmium export` -> [{osm_id, tags, point (lon, lat)}]. Areas become an interior point."""
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.lstrip("\x1e").strip()
            if not line:
                continue
            feat = json.loads(line)
            geom = shape(feat["geometry"])
            pt = geom if geom.geom_type == "Point" else geom.representative_point()
            osm_id = feat.get("id")  # "n123" / "w456" / "r789" from `osmium export --add-unique-id=type_id`
            if not osm_id:
                raise ValueError(f"{path}: features have no OSM id; export with --add-unique-id=type_id")
            out.append({"osm_id": str(osm_id), "tags": feat["properties"], "point": pt})
    return out


def _is_multi_stream(tags: dict) -> bool:
    return any(k.startswith("recycling:") and k != "recycling:clothes" and v == "yes" for k, v in tags.items())


def _osm_name(tags: dict, fallback: str) -> str:
    return tags.get("name") or tags.get("operator") or tags.get("brand") or fallback


def build(osm_path: Path, bgri_path: Path, cfg: dict, capacity_kg: float) -> dict:
    to_m = Transformer.from_crs("EPSG:4326", PT_TM06, always_xy=True).transform

    bgri = gpd.read_file(bgri_path)
    if str(bgri.crs) != PT_TM06:
        bgri = bgri.to_crs(PT_TM06)
    bgri = bgri[bgri["DTMN21"] == cfg["municipality_code"]]
    if bgri.empty:
        raise ValueError(f"no BGRI subsections for municipality {cfg['municipality_code']}")

    area_m = bgri.geometry.union_all().buffer(0).simplify(cfg["boundary_simplify_m"])
    boundary_m = area_m.buffer(1.0)  # 1 m tolerance so simplification never cuts off a subsection point
    boundary_ll = gpd.GeoSeries([boundary_m], crs=PT_TM06).to_crs("EPSG:4326").iloc[0]

    rep = bgri.geometry.representative_point()
    rep_ll = gpd.GeoSeries(rep, crs=PT_TM06).to_crs("EPSG:4326")
    demand = []
    for sub, pop, pt in zip(bgri["SUBSECCAO"], bgri["N_INDIVIDUOS"], rep_ll):
        demand.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(pt.x, 6), round(pt.y, 6)]},
                       "properties": {"id": f"SS-{sub}", "population": int(pop), "source_type": "public"}})

    inside = []
    for f in read_osm(osm_path):
        x, y = to_m(f["point"].x, f["point"].y)
        if boundary_m.covers(Point(x, y)):
            inside.append({**f, "xy": (x, y)})

    def far_from(xy, others) -> bool:
        return all((xy[0] - o[0]) ** 2 + (xy[1] - o[1]) ** 2 >= cfg["dedupe_m"] ** 2 for o in others)

    containers, kept_xy = [], []
    for f in sorted(inside, key=lambda f: f["osm_id"]):
        if f["tags"].get("recycling:clothes") != "yes" or not far_from(f["xy"], kept_xy):
            continue
        kept_xy.append(f["xy"])
        oid = f["osm_id"]
        containers.append({"type": "Feature",
                           "geometry": {"type": "Point", "coordinates": [round(f["point"].x, 6), round(f["point"].y, 6)]},
                           "properties": {"id": f"OSM-{oid}", "kind": "existing",
                                          "name": _osm_name(f["tags"], "Textile container (OSM)"),
                                          "capacity_kg": capacity_kg,
                                          "site_type": "ecoponto" if _is_multi_stream(f["tags"]) else "standalone",
                                          "source_type": "public", "osm_id": f["osm_id"]}})

    candidates = []
    for f in sorted(inside, key=lambda f: f["osm_id"]):
        tags = f["tags"]
        if tags.get("recycling:clothes") == "yes" or tags.get("recycling_type") in cfg["exclude_recycling_types"]:
            continue
        if not far_from(f["xy"], kept_xy):
            continue
        kept_xy.append(f["xy"])
        oid = f["osm_id"]
        candidates.append({"type": "Feature",
                           "geometry": {"type": "Point", "coordinates": [round(f["point"].x, 6), round(f["point"].y, 6)]},
                           "properties": {"id": f"OSM-{oid}", "kind": "candidate",
                                          "name": _osm_name(tags, "Recycling point (OSM)"),
                                          "site_type": "ecoponto", "source_type": "public", "osm_id": f["osm_id"]}})

    d = cfg["depot"]
    if not boundary_ll.covers(Point(d["lon"], d["lat"])):
        print("WARNING: the assumed depot is outside the municipality boundary", file=sys.stderr)

    return {
        "boundary": {"type": "FeatureCollection", "features": [{
            "type": "Feature", "geometry": mapping(boundary_ll),
            "properties": {"name": "Guimarães (union of INE BGRI 2021 subsections)", "source_type": "public",
                           "dtmn": cfg["municipality_code"]}}]},
        "demand_points": {"type": "FeatureCollection", "features": demand},
        "containers": {"type": "FeatureCollection", "features": containers},
        "candidates": {"type": "FeatureCollection", "features": candidates},
        "depot": {"id": "DEPOT", "name": d["name"], "lat": d["lat"], "lon": d["lon"], "source_type": "synthetic"},
        "stats": {"subsections": len(demand), "population": int(np.sum([x["properties"]["population"] for x in demand])),
                  "osm_inside": len(inside), "containers": len(containers), "candidates": len(candidates)},
    }


def write(data: dict, out: Path, cfg: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name in ("boundary", "demand_points", "containers", "candidates"):
        (out / f"{name}.geojson").write_text(json.dumps(data[name], ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "depot.json").write_text(json.dumps(data["depot"], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    s = data["stats"]
    (out / "SOURCES.md").write_text(
        "# Public dataset (generated by pipeline/public_data.py)\n\n"
        f"Built {datetime.now(timezone.utc).isoformat(timespec='seconds')}.\n\n"
        f"- Boundary and {s['subsections']} demand points ({s['population']} residents): {INE['name']}. "
        f"{INE['licence']}. {INE['url']}\n"
        f"- {s['containers']} textile containers and {s['candidates']} candidate sites: {OSM['name']} "
        f"(extract {cfg['osm_extract']}), {OSM['licence']}. OSM may not list every container in use.\n"
        "- Container capacity: assumption (config/assumptions.yaml), not measured.\n"
        "- Depot: ASSUMED location, labelled synthetic; replace with VITRUS's depot.\n",
        encoding="utf-8")
    (out / "sources.json").write_text(json.dumps({"ine": INE, "osm": {**OSM, "extract": cfg["osm_extract"]}}, indent=1),
                                      encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build data/raw/public from OSM + INE Census 2021.")
    ap.add_argument("--osm", type=Path, default=ROOT / "cache" / "osm" / "work" / "recycling-pt.geojsonseq")
    ap.add_argument("--bgri", type=Path, default=ROOT / "cache" / "ine" / "bgri_0308" / "BGRI2021_0308.gpkg")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    for p in (args.osm, args.bgri):
        if not p.exists():
            print(f"ERROR: {p} not found; run `make public-data`.", file=sys.stderr)
            return 1
    capacity = load_assumptions(DEFAULT_ASSUMPTIONS)["container_capacity_kg"]["value"]
    data = build(args.osm, args.bgri, cfg, capacity)
    write(data, args.out, cfg)
    s = data["stats"]
    print(f"PUBLIC dataset written to {args.out}: {s['containers']} textile containers (OSM), {s['candidates']} "
          f"candidate sites (OSM), {s['subsections']} census subsections with {s['population']} residents (INE 2021); "
          f"depot is an ASSUMED location")
    return 0


if __name__ == "__main__":
    sys.exit(main())
