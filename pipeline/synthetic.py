"""Generate a SYNTHETIC input dataset for Retalho.

The output exists so the pipeline and UI can be built before sponsor or public
data arrive. It does not describe real containers, residents or a real depot.
Every record carries ``source_type: synthetic``, and the boundary is a coarse
hand-drawn outline, not the official CAOP polygon.

Usage:
    python -m pipeline.synthetic [--config config/synthetic.yaml] [--out data/raw/synthetic]
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml
from shapely.geometry import Point, Polygon

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "synthetic.yaml"
DEFAULT_ASSUMPTIONS = ROOT / "config" / "assumptions.yaml"
DEFAULT_OUT = ROOT / "data" / "raw" / "synthetic"

KM_PER_DEG_LAT = 110.574


def _sample_points(rng: np.random.Generator, n: int, area: Polygon, centre: tuple[float, float],
                   urban_share: float, sigma_km: float) -> list[tuple[float, float]]:
    """Draw n (lon, lat) points inside `area`: an urban Gaussian cluster plus a uniform spread."""
    lon0, lat0 = centre
    sigma_lat = sigma_km / KM_PER_DEG_LAT
    sigma_lon = sigma_km / (111.320 * math.cos(math.radians(lat0)))
    min_lon, min_lat, max_lon, max_lat = area.bounds
    n_urban = round(n * urban_share)

    points: list[tuple[float, float]] = []
    while len(points) < n:
        if len(points) < n_urban:
            lon, lat = rng.normal(lon0, sigma_lon), rng.normal(lat0, sigma_lat)
        else:
            lon, lat = rng.uniform(min_lon, max_lon), rng.uniform(min_lat, max_lat)
        if area.contains(Point(lon, lat)):
            points.append((round(float(lon), 6), round(float(lat), 6)))
    return points


def _site_types(rng: np.random.Generator, n: int, weights: dict[str, float]) -> list[str]:
    names = list(weights)
    p = np.array([weights[k] for k in names], dtype=float)
    return [str(s) for s in rng.choice(names, size=n, p=p / p.sum())]


def _integer_split(total: int, weights: np.ndarray) -> list[int]:
    """Split `total` into integers proportional to `weights` (largest-remainder), summing exactly."""
    raw = weights / weights.sum() * total
    base = np.floor(raw).astype(int)
    for i in np.argsort(-(raw - base))[: total - base.sum()]:
        base[i] += 1
    return base.tolist()


def _feature(lon: float, lat: float, props: dict) -> dict:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


def generate(cfg: dict, container_capacity_kg: float, seed: int | None = None) -> dict:
    """Build the synthetic dataset in memory. Same config and seed give identical output."""
    seed = cfg["seed"] if seed is None else seed
    rng = np.random.default_rng(seed)
    area = Polygon(cfg["approx_boundary"])
    centre = (cfg["city_centre"]["lon"], cfg["city_centre"]["lat"])
    counts = cfg["counts"]

    def sample(n: int) -> list[tuple[float, float]]:
        return _sample_points(rng, n, area, centre, cfg["urban_share"], cfg["urban_sigma_km"])

    containers = [
        _feature(lon, lat, {
            "id": f"TX-{i:03d}", "kind": "existing", "name": f"Synthetic textile point {i}",
            "capacity_kg": container_capacity_kg, "site_type": st, "source_type": "synthetic",
        })
        for i, ((lon, lat), st) in enumerate(
            zip(sample(counts["containers"]), _site_types(rng, counts["containers"], cfg["site_type_weights"]["containers"])),
            start=1)
    ]
    candidates = [
        _feature(lon, lat, {
            "id": f"CAND-{i:03d}", "kind": "candidate", "name": f"Synthetic candidate site {i}",
            "site_type": st, "source_type": "synthetic",
        })
        for i, ((lon, lat), st) in enumerate(
            zip(sample(counts["candidates"]), _site_types(rng, counts["candidates"], cfg["site_type_weights"]["candidates"])),
            start=1)
    ]
    demand_xy = sample(counts["demand_points"])
    population = _integer_split(cfg["total_population"], rng.lognormal(0.0, 0.8, size=len(demand_xy)))
    demand = [
        _feature(lon, lat, {"id": f"DP-{i:04d}", "population": pop, "source_type": "synthetic"})
        for i, ((lon, lat), pop) in enumerate(zip(demand_xy, population), start=1)
    ]

    boundary_coords = [list(c) for c in cfg["approx_boundary"]] + [list(cfg["approx_boundary"][0])]
    return {
        "containers": {"type": "FeatureCollection", "features": containers},
        "candidates": {"type": "FeatureCollection", "features": candidates},
        "demand_points": {"type": "FeatureCollection", "features": demand},
        "depot": {"id": "DEPOT", **cfg["depot"], "source_type": "synthetic"},
        "boundary": {"type": "FeatureCollection", "features": [{
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [boundary_coords]},
            "properties": {
                "name": "Guimarães (approximate synthetic outline)",
                "source_type": "synthetic",
                "note": "Hand-drawn approximation, not the official DGT CAOP boundary.",
            },
        }]},
        "_seed": seed,
    }


def write(dataset: dict, out_dir: Path, config_path: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for name, filename in [("containers", "containers.geojson"), ("candidates", "candidates.geojson"),
                           ("demand_points", "demand_points.geojson"), ("depot", "depot.json"),
                           ("boundary", "boundary.geojson")]:
        path = out_dir / filename
        path.write_text(json.dumps(dataset[name], ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        written.append(path)
    readme = out_dir / "SYNTHETIC_DATA.md"
    readme.write_text(
        "# Synthetic data\n\n"
        "Generated by `pipeline/synthetic.py`. These files do **not** describe real textile\n"
        "containers, residents, a real depot or the official municipality boundary.\n"
        "Every record carries `source_type: synthetic`.\n\n"
        f"- Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
        f"- Seed: {dataset['_seed']}\n"
        f"- Config: `{config_path.relative_to(ROOT) if config_path.is_relative_to(ROOT) else config_path}`\n",
        encoding="utf-8",
    )
    return written + [readme]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--assumptions", type=Path, default=DEFAULT_ASSUMPTIONS)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--seed", type=int, default=None, help="override the seed in the config")
    args = ap.parse_args(argv)

    from pipeline.load import load_assumptions  # local import keeps the generator usable alone

    cfg = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    capacity = load_assumptions(args.assumptions)["container_capacity_kg"]["value"]
    dataset = generate(cfg, container_capacity_kg=capacity, seed=args.seed)
    paths = write(dataset, args.out, args.config)
    counts = {k: len(dataset[k]["features"]) for k in ("containers", "candidates", "demand_points")}
    print(f"SYNTHETIC dataset (seed {dataset['_seed']}) written to {args.out}: {counts}")
    for p in paths:
        print(f"  {p}")


if __name__ == "__main__":
    main()
