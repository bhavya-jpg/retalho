# Retalho: common commands. Run `make help` for the list.
SOURCE ?= synthetic
PY := uv run python

.PHONY: help install check-env public-data vitrus-init data osrm osrm-build osrm-down matrix simulate cost coverage benchmark geometry export all test web web-build offline docker-check-env clean

help:
	@echo "make install          install Python (uv) and web (npm) dependencies"
	@echo "make check-env        print toolchain versions and prove the solvers run"
	@echo "make public-data      build data/raw/public from OpenStreetMap + INE Census 2021 (needs Docker)"
	@echo "make vitrus-init      prepare data/raw/vitrus/ (git-ignored) for VITRUS files; see docs/VITRUS_DATA.md"
	@echo "make data             build data/clean/ from data/raw/\$$SOURCE (default: synthetic)"
	@echo "make osrm             start the local OSRM server (builds the road network first if needed)"
	@echo "make osrm-build       re-clip the OSM extract to data/clean's boundary and rebuild OSRM"
	@echo "make osrm-down        stop the OSRM server"
	@echo "make matrix           build or read the cached distance matrix (PROVIDER=auto|osrm|approx)"
	@echo "make simulate         four-week A vs B simulation -> out/simulation.json"
	@echo "make cost             cost comparison + break-even sweep -> out/breakeven.json"
	@echo "make coverage         coverage of existing points and +N additions -> out/coverage.json"
	@echo "make benchmark        Retalho routes vs nearest-stop baseline on identical stops -> out/benchmark.json"
	@echo "make geometry         street-following route lines from OSRM (display only) -> out/route_geometry.json"
	@echo "make export           assemble + validate out/results.json, copy to web/public/"
	@echo "make all              data + every pipeline step + export, in one command"
	@echo "make test             run the Python test suite"
	@echo "make web              start the web dev server"
	@echo "make web-build        build the static site into web/dist (deploy this folder to any static host)"
	@echo "make offline          single self-contained HTML for the pitch laptop -> web/dist-offline/"
	@echo "make docker-check-env run check-env inside the pipeline Docker image"
	@echo "make clean            remove generated data and caches"

install:
	uv sync
	cd web && npm install

check-env:
	@$(PY) -m pipeline.check_env

public-data:
	scripts/public_data.sh

vitrus-init:
	scripts/vitrus_init.sh

data:
ifeq ($(SOURCE),synthetic)
	$(PY) -m pipeline.synthetic --out data/raw/synthetic
endif
	$(PY) -m pipeline.load --source $(SOURCE)

osrm-build:
	scripts/osrm.sh build

osrm:
	@[ -f cache/osrm/area.osrm.mldgr ] || scripts/osrm.sh build
	scripts/osrm.sh up

osrm-down:
	scripts/osrm.sh down

PROVIDER ?= auto
matrix:
	$(PY) -m pipeline.matrix --provider $(PROVIDER)

simulate:
	$(PY) -m pipeline.simulate --provider $(PROVIDER)

cost:
	$(PY) -m pipeline.cost --provider $(PROVIDER)

coverage:
	$(PY) -m pipeline.coverage

benchmark:
	$(PY) -m pipeline.benchmark --provider $(PROVIDER)

geometry:
	$(PY) -m pipeline.geometry

export:
	$(PY) -m pipeline.export

all: data
	$(PY) -m pipeline.run_all --provider $(PROVIDER)

test:
	uv run pytest

web:
	cd web && npm run dev

web-build:
	cd web && npm run build

offline:
	cd web && npm run offline

docker-check-env:
	docker build -t retalho-pipeline .
	docker run --rm retalho-pipeline python -m pipeline.check_env

clean:
	find data/clean -mindepth 1 ! -name .gitkeep -delete
	rm -f cache/matrix_*.json cache/calibration.json
	rm -rf data/raw/synthetic .pytest_cache web/dist web/dist-offline out/*.json
