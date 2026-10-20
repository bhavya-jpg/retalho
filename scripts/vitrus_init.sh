#!/usr/bin/env bash
# Prepare data/raw/vitrus/ (git-ignored) for VITRUS's files, without inventing any VITRUS data.
# Copies only the PUBLIC layers VITRUS is unlikely to supply (boundary, census population, candidate
# sites, with their provenance) and writes templates for what VITRUS must provide. Never overwrites.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=data/raw/public
DST=data/raw/vitrus
[ -d "$SRC" ] || { echo "Missing $SRC; run: make public-data" >&2; exit 1; }
mkdir -p "$DST/original"

copy() { if [ -e "$DST/$1" ]; then echo "  keep   $DST/$1 (exists)"; else cp "$SRC/$1" "$DST/$1"; echo "  public $DST/$1 (copied from $SRC)"; fi; }
copy boundary.geojson
copy demand_points.geojson
copy candidates.geojson
copy sources.json

if [ ! -e "$DST/containers.csv" ]; then
  echo "id,lat,lon,capacity_kg,site_type,source_type,name" > "$DST/containers.csv"
  echo "  EMPTY  $DST/containers.csv (header only: add VITRUS's containers, source_type=sponsor)"
fi
if [ ! -e "$DST/PROVENANCE.md" ]; then
  cat > "$DST/PROVENANCE.md" <<'MD'
# VITRUS data provenance (fill in for every file received)

| File (as received, kept unchanged in original/) | Received from | Date received | Terms of use | Transformations applied -> file used by the pipeline |
|---|---|---|---|---|
|  |  |  |  |  |

Assumptions updated in config/assumptions.yaml (set source_type: sponsor and cite the file in the note):

| Key | Old value | VITRUS value | Source file |
|---|---|---|---|
|  |  |  |  |
MD
  echo "  NEW    $DST/PROVENANCE.md (record source, date and transformations here)"
fi
[ -e "$DST/depot.json" ] || echo "  TODO   $DST/depot.json: {\"name\": ..., \"lat\": ..., \"lon\": ..., \"source_type\": \"sponsor\"}"
echo "Put VITRUS's original files in $DST/original/ unchanged, then: make all SOURCE=vitrus (see docs/VITRUS_DATA.md)"
