# Retalho

Retalho helps VITRUS plan textile collection in Guimarães. It shows where textile drop-off points should be and compares two ways of collecting them over four weeks: an optimised fixed weekly round and demand-based collection. Every assumption behind each number is shown.

Built for **Hack4Guimarães 2035, Challenge 5: TexVitrus**. The development plan is in [PLAN.md](PLAN.md).

> **Status: milestones M0–M14 and should-haves S1 (street-following routes) and S2 (optimisation-value benchmark) are complete.** Live at https://bhavya-jpg.github.io/retalho/, deployed by CI. The app runs on public data (OpenStreetMap + INE Census 2021) and on a synthetic demo set. Waiting on VITRUS: the container list, depot, fill rates and costs ([docs/VITRUS_DATA.md](docs/VITRUS_DATA.md)). Still to do by the team: record the backup video.

## Rule compliance

All application code in this repository was written during the hackathon. Development started on 17 Oct 2026, before the 19–23 Oct work week, after the organisers approved an early start. Open-source libraries are used as dependencies only (listed below).

## Quick start

Requirements: [uv](https://docs.astral.sh/uv/), Python 3.12+ (the project pins 3.13), Node 20+, and Docker (only for OSRM).

```sh
make install       # Python deps (uv) and web deps (npm)
make check-env     # prints versions and checks that the VROOM and CBC solvers actually run
make osrm          # downloads the OSM extract once (426 MB), builds and starts OSRM on :5050 (~15 s)
make public-data   # data/raw/public from OpenStreetMap + INE Census 2021 (needs Docker)
make all SOURCE=synthetic   # synthetic demo dataset (~60 s)
make all SOURCE=public      # public dataset; built last, so it is the app's default (~20 s)
make web           # dashboard at http://localhost:5173 (switch datasets in the header)
make offline       # one self-contained HTML file for the pitch laptop: web/dist-offline/retalho-offline.html
```

- `make all SOURCE=<name>` reads `data/raw/<name>/`; each run adds `web/public/results-<name>.json` to the app's dataset list.
- After changing to a dataset with a different boundary, run `make osrm-build && make osrm` to re-clip the road network.
- `PROVIDER=osrm|approx|auto` (default `auto`) chooses the distance source.

Tests:

```sh
make test                          # Python: pytest (145 tests)
cd web && npm test                 # TypeScript: vitest (cost parity with Python)
cd web && npm run build && npx vite preview --port 4173 &  npm run smoke   # browser smoke test (Chrome)
```

**Docker (machines without a pyvroom wheel):** pyvroom ships wheels for Windows x64, Linux (glibc 2.34+) and macOS 15+ on Apple Silicon. On anything else, `make docker-check-env` builds a `python:3.12-slim` image with the pipeline in it.

## How it works

```
data/raw/<source>/ --load--> data/clean/ --matrix--> cache/matrix_<hash>.json
     --coverage--> out/coverage.json --simulate--> out/simulation.json --cost--> out/breakeven.json
     --benchmark--> out/benchmark.json --geometry--> out/route_geometry.json
     --export--> out/results.json --> web/public/results-<source>.json --> dashboard
```

The pipeline runs offline. The dashboard is a static site that reads one JSON file (schema: [schema/results.schema.json](schema/results.schema.json)) and computes euro figures in the browser, so cost sliders respond instantly.

### 1. Data contract and validation ([pipeline/load.py](pipeline/load.py))

`containers`, `candidates` and `demand_points` (GeoJSON or CSV), `depot.json` and `boundary.geojson` are validated and normalised into `data/clean/`.

Validation rejects:
- duplicate ids, points outside the boundary, bad coordinates
- non-positive capacity, negative population
- unknown types and missing fields

Every problem is reported in one message and nothing is written. Every record carries `source_type` (`sponsor`, `public` or `synthetic`).

### 2. Distances ([pipeline/matrix.py](pipeline/matrix.py), [scripts/osrm.sh](scripts/osrm.sh))

Road distance and free-flow car time come from a local OSRM server (car profile, OSM data from Geofabrik, clipped to the boundary plus 5 km). The matrix is cached by point ids, coordinates and data version.

If OSRM is unreachable and nothing is cached, the fallback is straight-line distance × a calibrated detour factor. It is labelled `approx` everywhere, including a banner in the app.

Checked on every run:
- square matrix, zero diagonal, finite values
- no road distance shorter than the straight line
- unreachable pairs, which stop the run
- points far from any road

### 3. Routing ([pipeline/solve.py](pipeline/solve.py))

`solve_day` wraps pyvroom. Each vehicle is one truck for one working day, with capacity and shift limits. VROOM minimises the same cost model the app reports.

If any stop is left unassigned, it raises `InfeasibleError` naming the stop and the reason: stop too heavy, beyond the shift, or fleet capacity or time exhausted. Route km and hours are recomputed from the matrix and cross-checked against VROOM.

### 4. Four-week simulation ([pipeline/simulate.py](pipeline/simulate.py))

**Fill model.** Each container's average weekly fill is drawn from the chosen profile (low, mid or high; a gamma distribution). Each week it varies by a random factor (CV `fill_weekly_cv`) and accumulates daily. Overflow container-days count the days a container ends above 100%.

**The two scenarios:**
- **A, fixed:** every container, every week, on optimised routes. This is a fair baseline, not VITRUS's real operation.
- **B, demand-based:** a container is emptied only if its projected fill would reach threshold T before the next weekly run.

**Fair-comparison rules (enforced in code):**
- Identical fill draws, starting fills, matrix and fleet for A and B, checked by fingerprint.
- Zero unassigned stops.
- Mass balance on every run: starting fill + generated = collected + left over.
- Overflow and end-of-horizon backlog reported for both, so B can't look cheaper by postponing collection past week 4.
- Everything runs over 10 seeds × 3 profiles and is reported as min / median / max.

### 5. Costs and break-even ([pipeline/cost.py](pipeline/cost.py), [web/src/lib/cost.ts](web/src/lib/cost.ts))

```
cost = km × €/km + crew-hours × €/h + truck-days × €/truck-day
cost per tonne = cost / tonnes collected
```

Python and TypeScript implement the same formula in the same order. Both must pass [tests/fixtures/cost_vectors.json](tests/fixtures/cost_vectors.json), and the TS savings are checked against Python's on the real `results.json`. Savings of B over A are paired by seed.

The break-even sweep re-runs the simulation at 7 average fill levels (20%–110%). It shows where demand-based collection stops paying, without needing VITRUS's real fill rate. A monotonicity check flags any point where the saving rises with fill.

### 6. Coverage ([pipeline/coverage.py](pipeline/coverage.py))

This is the population share within `coverage_radius_m` of a textile point, measured as **straight-line** distance (a walking proxy, labelled as such). For each N = 0…15, spopt's MCLP (solved exactly with CBC) picks N candidate sites to add. Existing points are always kept.

Checks: coverage never falls as N grows, the number of sites is exactly N, and whether each solution contains the previous one (nested) is reported.

### 7. Street-following route lines, S1 ([pipeline/geometry.py](pipeline/geometry.py))

This is display only.
- **Order:** route order comes from the optimiser and is never changed.
- **Distance:** comes from the distance matrix.
- **Geometry:** for each distinct ordered stop sequence, the pipeline asks the local OSRM `route` service for the street path through the stops *in that order*.
- **Storage:** paths are validated, cached (successes only), simplified to about 3 m and embedded in `results.json`. The static site never calls a routing API.

If OSRM is unavailable, or a response is invalid (no route, bad polyline, out-of-range points, negative distance), that route falls back to straight segments. The map draws those **dashed** with an "approximate" label, and the tooltip says its km is still the road distance.

As a check, OSRM's own path distance is compared with the matrix km used for costs. The median gap is 0.00% and the maximum 0.07% across all routes.

### 8. Optimisation value, S2 ([pipeline/benchmark.py](pipeline/benchmark.py))

Is Retalho's VROOM routing better than a simple alternative? The test is a deterministic **nearest-stop baseline**: for each truck-day, keep driving to the nearest unvisited stop by road distance (ties broken by id) that still fits the remaining capacity and shift, then return to the depot.

**Identical inputs:**
- The four weeks are replayed with the baseline as the router (`run_scenario(..., solver=...)`). Stops, kilograms and overflow are therefore identical by construction, and this is asserted every week.
- Same matrix, capacity (loads rounded up as for VROOM), shift, service time, truck speed factor, truck-days, and cost model.

**Formula:** improvement = (baseline − optimised) ÷ baseline, paired per run. Negative values are shown as they are; a zero or missing baseline is shown as unavailable.

**Measured on the current data (simulated weeks):** the optimiser beat the baseline in all 120 runs.

| Dataset | Median operating-cost improvement | Median distance improvement |
|---|---|---|
| Public | +2.9% to +7.1% | +3.2% to +14.2% |
| Synthetic | +9.8% to +14.0% | +21.4% to +27.1% |

Each range spans the fill profiles and both scenarios. Nearest-stop is a simple baseline, not necessarily the best alternative.

### 9. Dashboard ([web/](web/))

Vite + React + TypeScript + Tailwind, with Leaflet (used directly) and Recharts. It has four tabs:

- **Rede (Network):** points, candidates, depot, boundary; today's coverage; distance checks.
- **Cobertura (Coverage):** "+N new points" slider updating the map, coverage %, marginal gain and the coverage curve.
- **Recolha (Collection):**
  - B-vs-A tiles (median and range), plus a plain-language reading that applies the overflow rule
  - a full A/B table and the weekly distance chart
  - the optimisation-value panel: nearest-stop baseline vs Retalho, side by side, with costs following the sliders
  - street-following routes per scenario, week and run
  - the break-even chart, with total or per-tonne saving
- **Pressupostos (Assumptions):** live cost sliders, the fill-profile selector, every assumption with its source badge, and data sources with licences.

**Behaviour:**
- Every figure carries a label: Measured, Simulated, Benchmark, Assumption, Synthetic data, Straight-line or Approx. distances.
- The map works without tiles (offline), with boundary and points on a plain background.
- Light and dark themes; no horizontal scroll at 390 px.
- Loading and error states, including when `results.json` is missing.

## Datasets

The app ships two datasets and a switch in its header. The banner always says which inputs are real and which are assumed.

### Public data (default): [pipeline/public_data.py](pipeline/public_data.py)

| Input | Source | Label |
|---|---|---|
| Boundary | Union of INE BGRI 2021 subsections for Guimarães (DTMN 0308) | Public |
| Population | 2,382 census subsections, **156,830 residents** (INE Censos 2021), one point inside each | Public |
| Existing textile points | OpenStreetMap `amenity=recycling` + `recycling:clothes=yes` inside the boundary: **only 2** | Public |
| Candidate sites | 110 other OSM recycling containers (ecopontos), de-duplicated within 15 m | Public |
| Depot | **Assumed** location ([config/public_source.yaml](config/public_source.yaml)) | Synthetic |

**OpenStreetMap almost certainly lists fewer textile containers than VITRUS operates.** So today's coverage figure (Measured) describes OSM-mapped points only. To make collection meaningful, Scenarios A and B run on a **planned network**: the existing points plus the 15 sites the coverage optimiser proposes (`collection_network_new_points`; set it to 0 for existing points only).

Once VITRUS provides data, follow [docs/VITRUS_DATA.md](docs/VITRUS_DATA.md). `make vitrus-init` prepares the git-ignored `data/raw/vitrus/` folder without inventing anything, and `make all SOURCE=vitrus` reruns everything, including a report of which inputs and assumptions changed.

### Synthetic demo data: [pipeline/synthetic.py](pipeline/synthetic.py)

Seed 2035: 30 containers, 60 candidates, 400 demand points (156,000 people) and a hand-drawn boundary, all generated. It is labelled "Synthetic data" throughout and demonstrates the method on a denser network. It does not describe Guimarães.

### Source report

Each export writes `out/source_report_<source>.md`. It lists where every input and assumption comes from, and what changed compared with the other datasets (PLAN M13).

## Assumptions

All model parameters live in [config/assumptions.yaml](config/assumptions.yaml), each with a value, unit, source (`sponsor`, `public` or `assumption`) and note. The Assumptions tab lists them.

- **Calibrated from public OSM data via OSRM:** `detour_factor` 1.42 and `fallback_speed_kmh` 45, measured on the real public points (12,530 pairs).
- **Placeholders:** everything else (18), waiting for VITRUS or mentor values. This includes container capacity, fill profiles, threshold T, fleet (2 trucks; 1 could not serve the planned synthetic network at high fill), shift, service time, truck speed factor, all costs, and the size of the planned collection network.

External benchmarks go in [config/benchmarks.yaml](config/benchmarks.yaml) only after the source has been read. **None are listed yet**, since the "−22%" figure in PLAN.md still needs verifying.

## Known limitations

- **No operator data yet.** Fill rates, fleet and costs are assumptions, the depot location is assumed, and OSM lists only 2 textile containers in Guimarães. Every collection figure is a simulation on a planned network.
- **INE terms.** INE data are used with source citation; check INE's terms of use before publishing.
- **Weekly timing.** Collection is modelled as happening at the start of each week. Within-week day assignment is not simulated, and this applies equally to A and B.
- **One route per truck-day.** No mid-day unloading trips, which is conservative for capacity.
- **Free-flow travel times.** OSRM car times are scaled by the `truck_speed_factor` assumption; there are no traffic or time-of-day effects.
- **B knows average rates.** Scenario B's planner knows each container's average fill rate (as from history or "bin full" reports) but not the weekly variation; real estimates would be noisier.
- **Street geometry needs OSRM at build time.** Without it, routes are drawn as labelled dashed straight segments. Costs never depend on the drawing.
- **The benchmark measures routing only.** Collection decisions are the same for both strategies, so it says nothing about A versus B.
- **Coverage uses straight-line distance.** A walking-route version is optional O2.
- **Synthetic points are not placed on streets.** Five of the 91 lie 250–650 m from a road. OSRM routes from the nearest road point, so that access distance is not counted.
- **Routes use the default costs.** Cost sliders recompute € on routes optimised with the default costs; they do not re-route.

## Deployment

**Live site:** https://bhavya-jpg.github.io/retalho/. It is published automatically by [.github/workflows/ci.yml](.github/workflows/ci.yml).

| Job | Runs on | What it checks |
|---|---|---|
| `pipeline` | every push and PR | `uv sync --frozen`, the solver check (`check_env`), and the full pytest suite |
| `web` | every push and PR | `npm ci`, `tsc -b`, vitest, `npm run build`, and a headless-Chrome smoke test of the built site |
| `deploy` | `main` only, after both jobs pass | uploads `web/dist` and deploys it with `actions/deploy-pages` |
| `verify` | after `deploy` | re-runs the smoke test against the live URL |

A failing check stops the run, so a broken build is never deployed. No secrets are needed: the deploy uses the built-in `GITHUB_TOKEN` with `pages: write` and `id-token: write`, granted to that job only.

**One-time repository setting:** Settings → Pages → Source: **GitHub Actions**. It is already enabled for `bhavya-jpg/retalho`. On a fork or a renamed repository, enable it again.

**Why it works under `/retalho/`:**
- Vite builds with `base: "./"`, so every asset and data file is requested relative to the page. The same build works at any sub-path and from disk.
- Tabs are URL fragments (`#rede`, `#recolha`), so refreshing any tab never hits a missing server route.
- The site is fully static. The results JSON is committed under `web/public/` and regenerated with `make all`.

**Other targets:**
- **Pitch laptop:** `make offline` produces `web/dist-offline/retalho-offline.html` (about 1.4 MB). It opens by double-click with no server and no network, with both datasets embedded; the map falls back to a plain background.
- **Any static host:** upload `web/dist/` after `make web-build`.
- **Projector:** the layout was checked at 1920×1080, 1440 px and 390 px wide.

**Linting:** no linter is configured in this project. CI runs the type-checker and both test suites instead.

## Repository layout

```
config/      assumptions.yaml, synthetic.yaml, public_source.yaml, benchmarks.yaml
pipeline/    check_env, synthetic, public_data, load, matrix, solve, simulate, cost, coverage, benchmark, geometry, export, run_all
schema/      results.schema.json (the pipeline -> app contract)
scripts/     osrm.sh (build / up / down), public_data.sh, vitrus_init.sh, osmium.Dockerfile
docs/        VITRUS_DATA.md (intake procedure for sponsor data)
.github/     workflows/ci.yml (tests, build, Pages deploy, live smoke test)
tests/       pytest per module + fixtures/ (valid, broken, cost_vectors.json)
out/         stage outputs and results.json (generated)
web/         dashboard; web/public/results.json is copied there by `make all`
cache/       distance matrices, OSM extract, OSRM build (git-ignored)
```

## Dependencies and licences

| Package | Licence | Used for |
|---|---|---|
| pyvroom / VROOM | BSD-2-Clause | Vehicle routing |
| OSRM (Docker image, not bundled) | BSD-2-Clause | Road distances and travel times |
| OpenStreetMap data | ODbL 1.0, © OpenStreetMap contributors | Road network (via Geofabrik) and map tiles |
| osmium-tool (Debian package, in Docker) | GPL-3.0 | Clipping the OSM extract (build tool, not shipped) |
| spopt | BSD-3-Clause | Coverage optimisation (MCLP) |
| PuLP + CBC | MIT / EPL-2.0 | MILP solver used by spopt |
| shapely, NumPy, GeoPandas | BSD-3-Clause | Geometry, sampling, reading INE GeoPackage |
| pyproj | MIT | Reprojection (EPSG:3763 ↔ WGS84) |
| INE BGRI 2021 | INE open data, reuse with source citation | Boundary and population |
| PyYAML, jsonschema | MIT | Config, results validation |
| React, Vite, Tailwind CSS, Recharts, Vitest | MIT | Dashboard |
| Leaflet | BSD-2-Clause | Map (used directly, without react-leaflet) |
| TypeScript | Apache-2.0 | Dashboard |
