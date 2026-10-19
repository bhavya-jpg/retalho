#!/usr/bin/env bash
# Build data/raw/public/ from OpenStreetMap (recycling points) and INE Census 2021 (BGRI) for Guimarães.
# Needs Docker (osmium runs in a container) and the OSM extract that `make osrm` downloads.
set -euo pipefail
cd "$(dirname "$0")/.."

OSM_PBF=${OSM_PBF:-cache/osm/portugal-261018.osm.pbf}
BGRI_URL=$(uv run python -c "import yaml; print(yaml.safe_load(open('config/public_source.yaml'))['bgri_url'])")
BGRI_ZIP=cache/ine/$(basename "$BGRI_URL")
WORK=cache/osm/work

[ -f "$OSM_PBF" ] || { echo "Missing $OSM_PBF; run: make osrm-build" >&2; exit 1; }
docker image inspect retalho-osmium >/dev/null 2>&1 || docker build -q -t retalho-osmium -f scripts/osmium.Dockerfile scripts
mkdir -p "$WORK"
pbf_in_container="/data/$(basename "$OSM_PBF")"
docker run --rm -v "$PWD/cache/osm:/data" retalho-osmium tags-filter "$pbf_in_container" nwr/amenity=recycling \
  -o /data/work/recycling-pt.osm.pbf --overwrite
docker run --rm -v "$PWD/cache/osm:/data" retalho-osmium export /data/work/recycling-pt.osm.pbf \
  -f geojsonseq --add-unique-id=type_id -o /data/work/recycling-pt.geojsonseq --overwrite

if [ ! -f "$BGRI_ZIP" ]; then
  mkdir -p cache/ine
  echo "Downloading $BGRI_URL"
  curl -fL -o "$BGRI_ZIP" "$BGRI_URL"
fi
BGRI_DIR="cache/ine/$(basename "$BGRI_ZIP" .zip | sed 's/BGRI2021_/bgri_/')"
mkdir -p "$BGRI_DIR" && unzip -o -q "$BGRI_ZIP" -d "$BGRI_DIR"

uv run python -m pipeline.public_data --osm "$WORK/recycling-pt.geojsonseq" --bgri "$BGRI_DIR/$(basename "$BGRI_ZIP" .zip).gpkg"
