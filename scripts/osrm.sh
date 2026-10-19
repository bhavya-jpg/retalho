#!/usr/bin/env bash
# Build and run a local OSRM server (car profile) for the area around data/clean/boundary.geojson.
#
#   scripts/osrm.sh build   clip the OSM extract to the boundary bbox (+ buffer) and preprocess (MLD)
#   scripts/osrm.sh up      start the server on $OSRM_PORT (default 5050; macOS uses 5000 for AirPlay)
#   scripts/osrm.sh down    stop it
#
# Needs Docker. osmium runs in a Debian container, so nothing is installed on the host.
set -euo pipefail
cd "$(dirname "$0")/.."

OSM_PBF=${OSM_PBF:-cache/osm/portugal-261018.osm.pbf}
OSM_URL=${OSM_URL:-https://download.geofabrik.de/europe/portugal-261018.osm.pbf}
OSRM_IMAGE=${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:v6.0.0}
OSRM_PORT=${OSRM_PORT:-5050}
BUFFER_KM=${BUFFER_KM:-5}
NAME=retalho-osrm
OUT=cache/osrm

build() {
  if [ ! -f "$OSM_PBF" ]; then
    echo "Downloading $OSM_URL"
    mkdir -p "$(dirname "$OSM_PBF")"
    curl -fL -o "$OSM_PBF" "$OSM_URL"
    curl -fsSL -o "$OSM_PBF.md5" "$OSM_URL.md5"
    (cd "$(dirname "$OSM_PBF")" && md5sum -c "$(basename "$OSM_PBF").md5" 2>/dev/null || \
      [ "$(md5 -q "$(basename "$OSM_PBF")")" = "$(cut -d' ' -f1 "$(basename "$OSM_PBF").md5")" ]) \
      || { echo "Checksum mismatch for $OSM_PBF" >&2; exit 1; }
  fi
  local bbox
  bbox=$(uv run python -m pipeline.matrix --print-bbox --buffer-km "$BUFFER_KM")
  echo "Clip box (lon/lat, boundary + ${BUFFER_KM} km): $bbox"

  rm -rf "$OUT" && mkdir -p "$OUT"
  local src_dir src_file
  src_dir=$(cd "$(dirname "$OSM_PBF")" && pwd)
  src_file=$(basename "$OSM_PBF")
  docker run --rm -v "$src_dir:/src:ro" -v "$PWD/$OUT:/data" debian:bookworm-slim sh -c "
    apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null &&
    osmium extract --strategy=complete_ways -b $bbox /src/$src_file -o /data/area.osm.pbf --overwrite"

  docker run --rm -v "$PWD/$OUT:/data" "$OSRM_IMAGE" osrm-extract -p /opt/car.lua /data/area.osm.pbf
  docker run --rm -v "$PWD/$OUT:/data" "$OSRM_IMAGE" osrm-partition /data/area.osrm
  docker run --rm -v "$PWD/$OUT:/data" "$OSRM_IMAGE" osrm-customize /data/area.osrm

  # Recorded with every matrix so a rebuilt network invalidates cached matrices.
  echo "$(basename "$OSM_PBF" .osm.pbf) bbox=$bbox" > "$OUT/data_version.txt"
  echo "OSRM data ready in $OUT ($(cat "$OUT/data_version.txt"))"
}

up() {
  [ -f "$OUT/area.osrm.mldgr" ] || { echo "No OSRM data in $OUT. Run: make osrm-build" >&2; exit 1; }
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p "$OSRM_PORT:5000" -v "$PWD/$OUT:/data" "$OSRM_IMAGE" \
    osrm-routed --algorithm mld --max-table-size 1000 /data/area.osrm >/dev/null
  for _ in $(seq 1 60); do
    if curl -sf "http://localhost:$OSRM_PORT/nearest/v1/driving/-8.2918,41.4425" >/dev/null; then
      echo "OSRM running at http://localhost:$OSRM_PORT (container $NAME)"
      return 0
    fi
    sleep 0.5
  done
  echo "OSRM did not start; see: docker logs $NAME" >&2
  exit 1
}

down() { docker rm -f "$NAME" >/dev/null 2>&1 && echo "OSRM stopped" || echo "OSRM was not running"; }

case "${1:-}" in
  build) build ;;
  up) up ;;
  down) down ;;
  *) echo "usage: $0 build|up|down" >&2; exit 2 ;;
esac
