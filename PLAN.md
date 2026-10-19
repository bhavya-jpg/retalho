# Retalho: development plan (PLAN.md)

*Hack4Guimarães 2035, Challenge 5: TexVitrus. Work week Mon 19 – Fri 23 Oct 2026. Submission deadline Fri 23 Oct 16:30 Lisbon time (= 21:00 IST); our target is 12:00. Jury pitch Mon 26 Oct 14:30.*

> **How to use this file:** commit it as `PLAN.md` in the repository root on Monday. Give Claude Code one milestone at a time: *"Implement milestone Mx from PLAN.md. Stop when its acceptance checks pass."* Do not start a milestone until the ones it depends on are complete. No code is written before kickoff.

---

## 0. Decision gate: Monday before 10:00

Get written answers from the organisers. The rest of this plan depends on them.

| Question | If YES | If NO |
|---|---|---|
| May we use open-source libraries and engines as dependencies (pyvroom, OSRM, spopt, Leaflet)? | Follow this plan as written | Use the **no-library fallbacks** in §6. Every core component has one written from scratch |
| Must the repository be public, and may it contain VITRUS data? | Commit sponsor data under `data/vitrus/` | Commit synthetic data only; keep sponsor files outside git (`.gitignore`) and load them locally |
| Does VITRUS's data come with any usage or confidentiality terms? | Follow them | — |
| What must be submitted (repository, video, slides, live URL)? | Add to the checklist in §10 | — |

Also ask **mentor Lucas Nascimento** (Monday morning):
- Container locations and current collection frequency.
- Container capacity and typical textile weight per container.
- Truck capacity, crew size and shift length.
- Cost per km and per crew-hour.
- Depot location.
- Characterisation of the unsorted waste, including the textile fraction.
- What VITRUS would count as success.

Each answer replaces an assumption in `config/assumptions.yaml` (§4.2).

---

## 1. The product (MVP)

**One sentence:** Retalho shows VITRUS where textile drop-points should be and how to collect them at the lowest cost. It compares a fixed weekly round with demand-based collection over four weeks, and shows every assumption behind each number.

**User:** a VITRUS operations planner, on a laptop.

**The four screens are tabs of one page:**

| Tab | Question it answers | Content |
|---|---|---|
| **Rede** (Network) | Where are textile points today, and who can reach them? | Map of existing points, candidate sites, depot, municipality boundary. KPI: share of residents within *R* m of a textile point |
| **Cobertura** (Coverage) | How many new points do we need, and where? | Slider "+N new points" → proposed sites on the map, coverage % and marginal gain per point. Existing points always kept |
| **Recolha** (Collection) | What does each collection policy cost? | Scenario A vs B: four-week totals (km, crew hours, €, € per tonne, overflow container-days), routes on the map per week, weekly bar chart |
| **Pressupostos** (Assumptions) | Where does each number come from? | Every parameter with its value, unit and source badge (Sponsor / Public / Assumption). Cost sliders recompute € instantly. Fill-rate profile selector (low / mid / high) |

**Definitions used throughout:**
- **Scenario A, fixed:** every container is emptied once per week. Routes are optimised, so A is already a fair, efficient baseline, not a straw man.
- **Scenario B, demand-based:** each week, a container is emptied only if its projected fill would reach threshold *T* (default 80%) before the next run.
- **Fair-comparison rules (enforced in code):**
  - Same distance matrix, fleet, depot and fill-rate draws for A and B.
  - Zero unassigned stops.
  - Overflow container-days reported for both.
  - Results shown as a range across ≥ 5 random seeds.

---

## 2. Feature priority

### 2.1 Mandatory (the MVP; nothing else starts until these work)

| # | Feature | Why judges care (official criteria) |
|---|---|---|
| F1 | Data loader with schema validation and source labels | Technical soundness |
| F2 | Road-distance matrix (OSRM) with cache and labelled fallback | Technical soundness; credibility of every km figure |
| F3 | Single-day routing (pyvroom) with zero-unassigned check | Technical soundness |
| F4 | Four-week A vs B simulation, multi-seed, with overflow | **The core result** ("lowest operating cost") |
| F5 | Cost model (Python, mirrored in the frontend) | Answers the brief directly |
| F6 | Coverage: existing vs +N points (spopt MCLP, existing fixed) | "Closer to the citizen", lowest investment; impact on the territory |
| F7 | Map: points, depot, boundary, routes per scenario | Clarity |
| F8 | KPI tiles + A/B comparison + weekly chart | Clarity |
| F9 | Assumptions tab with source badges + live cost sliders | Clarity and honesty; defends every number in Q&A |
| F10 | Break-even curve: savings of B vs A as average weekly fill varies | Turns an unknown into a finding ("B saves money whenever average weekly fill is below X%") |

### 2.2 Should-have (only after F1–F10 pass on Wednesday evening)

| # | Feature | Effort |
|---|---|---|
| S1 | Road-following route lines (OSRM `route` service, cached) instead of straight stop-to-stop lines | 0.25 day |
| S2 | "Optimisation value" check: pyvroom routes vs a nearest-neighbour ordering on the same stops | 0.25 day |
| S3 | Export the week-by-week plan as CSV (one row per stop: week, truck, order, container) | 0.25 day |

### 2.3 Optional (Thursday, only if everything above is done)

| # | Feature | Condition |
|---|---|---|
| O1 | QR "contentor cheio" (bin full) report page feeding B's fill estimates | Needs a tiny write endpoint (FastAPI + SQLite file); the only reason to run a server |
| O2 | Walking distances by road for coverage (second OSRM build, foot profile) | Only if the car-profile OSRM build took under 1 hour |

### 2.4 Excluded, with reasons

| Excluded | Reason |
|---|---|
| AI photo triage | Fibre identification from photos is research-grade (~81% on 4 classes); it doesn't serve "lowest cost" |
| Authentication | Single-user planning tool; no personal data |
| Database server | All results are files; the static frontend reads JSON |
| Fill sensors / IoT | Hardware; outside budget and time |
| Mobile app | A responsive web page covers the QR flow (O1) |

---

## 3. Architecture and data flow

**Principle:** an **offline Python pipeline** computes everything into versioned JSON. A **static React app** displays it. Cost sliders recompute in the browser because cost is arithmetic on km and hours; no re-routing is needed. At pitch time nothing needs a server or the network except map tiles, and those have a fallback.

```
data/raw/ (sponsor CSV | OSM extract | INE census | CAOP boundary | synthetic)
   │  M1 load + validate  → data/clean/containers.geojson, candidates.geojson,
   │                         demand_points.geojson, depot.json, boundary.geojson
   ▼
config/assumptions.yaml  (value + unit + source_type + note for every parameter)
   ▼
M2 matrix   → cache/matrix_<hash>.json   (OSRM table; fallback: straight-line × detour, labelled)
M3 solver   → solve_day(stops, fill_kg) → {routes, km, travel_h, service_h, unassigned=[]}
M4 simulate → 4 weeks × {A,B} × seeds × fill profiles
M5 cost     → € totals, € per tonne, break-even curve
M6 coverage → existing share; +N additions (N = 0…Nmax), sites and shares
   ▼
out/results.json  (single file, schema in §4.3)  + out/test_vectors.json (cost checks)
   ▼
web/ (Vite + React + TypeScript + Tailwind + Leaflet + Recharts)
   reads public/results.json → 4 tabs; cost recomputed client-side
   ▼
static build → deployed URL + offline copy on the pitch laptop
```

### 3.1 Repository layout

```
retalho/
├─ PLAN.md  README.md  LICENSE  Makefile  .gitignore
├─ config/assumptions.yaml
├─ data/raw/  data/clean/            (sponsor files git-ignored unless permitted)
├─ cache/                            (matrices; git-ignored)
├─ pipeline/
│  ├─ load.py        validate + normalise inputs → data/clean
│  ├─ synthetic.py   clearly labelled synthetic generator (fallback data)
│  ├─ matrix.py      OSRM table client + cache + fallback
│  ├─ solve.py       pyvroom wrapper (solve_day)
│  ├─ simulate.py    four-week A/B engine
│  ├─ cost.py        cost model + break-even sweep
│  ├─ coverage.py    MCLP additions
│  ├─ export.py      assemble out/results.json + test vectors
│  └─ run_all.py     end-to-end CLI
├─ tests/            pytest, one file per module + fixtures/
├─ out/              results.json, test_vectors.json
└─ web/              Vite React app; public/results.json copied from out/
```

### 3.2 Technology choices (each one justified)

| Need | Choice | Reason |
|---|---|---|
| Routing | `pyvroom` 1.15.x | Tested: solves Guimarães-scale problems in < 1 s and returns order, km, time and unassigned stops |
| Road distances | OSRM (Docker), car profile, Guimarães area extract | BSD-2; one table call gives the full matrix |
| Coverage | `spopt` MCLP with `predefined_facilities_arr` | Tested: keeps existing sites and adds N |
| Geodata | `geopandas`, `shapely`, `pyproj` | Reprojection to EPSG:3763 (Portugal TM06) for metre distances |
| Frontend | Vite + React + TS + Tailwind | Static data; no server rendering needed |
| Map | `leaflet` (BSD-2) used directly through a small React component we write | Avoids `react-leaflet` (Hippocratic licence) |
| Charts | `recharts` (MIT) | — |
| Tests | `pytest`; `vitest` for the frontend cost function | — |
| Hosting | Any static host (e.g. GitHub Pages or Netlify) | No backend to keep alive |

**pyvroom platform check:** wheels exist for Windows x64, Linux glibc ≥ 2.34 and macOS 15+ on Apple Silicon only. Any teammate on an Intel Mac or older macOS runs the pipeline inside Docker (`python:3.12-slim`).

---

## 4. Data contract

### 4.1 Input files (after M1 normalisation)

| File | Required fields | Source priority |
|---|---|---|
| `containers.geojson` (Point) | `id`, `kind` = existing, `capacity_kg`, `site_type` (ecoponto / standalone / other), `source_type` | Sponsor → OSM textile points (`recycling:clothes=yes`; verify coverage) → synthetic |
| `candidates.geojson` (Point) | `id`, `kind` = candidate, `site_type`, `source_type` | Existing eco-points from sponsor or OSM (`amenity=recycling`) → synthetic |
| `demand_points.geojson` (Point) | `id`, `population`, `source_type` | INE Census 2021 small-area population (verify access) → OSM building centroids as a proxy (labelled) → synthetic |
| `depot.json` | `lat`, `lon`, `name`, `source_type` | Sponsor → labelled assumption |
| `boundary.geojson` | Guimarães municipality polygon | DGT CAOP |

`source_type` ∈ {`sponsor`, `public`, `synthetic`}. Every record carries one, and the UI shows it.

### 4.2 `config/assumptions.yaml`

Every parameter has the form `{value, unit, source_type: sponsor|public|assumption, note}`. Initial set, all `assumption` until confirmed:

| Key | Unit | Note |
|---|---|---|
| `container_capacity_kg` | kg | Ask the mentor |
| `fill_rate_profiles` (low/mid/high mean, spread) | share of capacity per week | Derived from sponsor characterisation if provided |
| `threshold_T` | share | Scenario B rule (default 0.8) |
| `service_min_per_stop` | min | Ask the mentor |
| `trucks`, `truck_capacity_kg`, `shift_h` | count, kg, h | Ask the mentor |
| `cost_per_km`, `crew_cost_per_h`, `fixed_cost_per_truck_day` | € | Ask the mentor |
| `new_point_cost` | € | Optional; if unknown, investment is shown as a count, not € |
| `coverage_radius_m` | m | Policy choice (e.g. 300 / 500) |
| `detour_factor` | ratio | Used only by the fallback matrix; calibrated in M2 |
| `seeds`, `horizon_weeks` | — | 10 seeds, 4 weeks |

### 4.3 `out/results.json` (the only interface between pipeline and frontend)

```
meta:        generated_at, git_commit, distance_provider (osrm|ors|approx),
             data_sources[{name, source_type, licence, url}], seeds, horizon_weeks
assumptions: [{key, value, unit, source_type, note}]
network:     containers (GeoJSON), candidates (GeoJSON), depot, boundary
coverage:    radius_m, population_total,
             existing {sites, covered_pop, share},
             additions [{n_new, site_ids[], covered_pop, share, marginal_share}]
scenarios:   {profile: {A|B: {
               per_seed[{seed, weeks[{week, stops, km, travel_h, service_h, kg,
                                       overflow_container_days,
                                       routes[{truck, stop_ids[], km, travel_h}]}]}],
               summary {km, travel_h, service_h, kg, overflow_container_days,
                        stops, each as {min, median, max}}}}}
breakeven:   [{mean_weekly_fill, saving_km_pct {min,median,max}, saving_cost_pct {...}}]
benchmarks:  [{name: "Ekocharita (Sensoneo)", metric: "collection cost", value: -22,
               unit: "%", source_url}]
```

**Cost is not stored as €.** The frontend and `cost.py` compute it from km, hours and the assumptions. `out/test_vectors.json` holds ≥ 3 input/expected-output pairs that both implementations must match.

---

## 5. Milestones and acceptance criteria

Owners: **P** = pipeline developer(s), **F** = frontend developer, **D** = data/pitch lead. Times are Lisbon local.

| ID | Milestone | Depends on | Owner | Acceptance criteria (all must pass) |
|---|---|---|---|---|
| **M0** | Repository and environment | Decision gate | All | `make check-env` prints Python, pyvroom, spopt and Node versions on **every** team machine (or the Docker image); `make web` serves an empty page; README has a "Built during 19–23 Oct 2026" statement |
| **M1** | Data contract, loaders, validation, synthetic generator | M0 | P + D | `make data SOURCE=synthetic` writes all files in §4.1. `pytest tests/test_load.py` checks: unique ids; all points inside the boundary; non-negative capacity/population; every record has `source_type`. Validation fails with a readable message on a deliberately broken fixture |
| **M1f** | Fixture `web/public/results.sample.json` | §4.3 | F | Hand-made, matches the schema, ~20 containers. Lets F start without the pipeline |
| **M2** | Distance matrix + cache + fallback | M1 | P | OSRM table for depot + containers + candidates: diagonal 0, all finite, size N×N. Second run reads the cache (< 1 s). Each OSRM distance ≥ straight-line distance (logged count of violations = 0). Fallback mode works with OSRM stopped and records `distance_provider = approx`. Detour factor calibrated as the median OSRM/straight-line ratio |
| **M3** | `solve_day` wrapper | M2 | P | Fixture with 4 stops returns a known order and total km. **Raises** if `unassigned` is non-empty. Returns km, travel h, service h and kg per truck. 150 stops solve in < 2 s |
| **M4** | Four-week simulator | M3 | P | Same seed → identical output. A visits every container every week. Neither scenario has unassigned stops. Overflow container-days computed for both. Sum of route km = reported km. Runs 2 scenarios × 10 seeds × 3 profiles in < 5 min |
| **M5** | Cost model + break-even sweep | M4 | P | `cost.py` matches `test_vectors.json` exactly. Break-even sweep over ≥ 6 mean-fill values. Monotonicity check: B's saving does not increase as mean fill rises (any violation is logged and investigated) |
| **M6** | Coverage additions | M1 (straight-line walking distance; M2 only if O2 is built) | P | Coverage of existing points computed. For N = 0…Nmax: all existing sites kept; coverage never decreases as N grows; solve < 60 s per N |
| **M7** | Export + end-to-end CLI | M4–M6 | P | `make all` regenerates `out/results.json` from raw data in one command. The output validates against the schema (JSON Schema test). The file is copied to `web/public/` |
| **M8** | Frontend shell + Network tab | M1f | F | Loads results JSON. Marker count equals the container count in the file. Boundary drawn. If tiles fail (network off), the map still shows boundary and points on a plain background |
| **M9** | Collection tab | M8 | F | A/B toggle redraws routes for the selected week. KPI tiles show median and min–max range. Values are identical to the JSON (vitest snapshot). Each tile carries a source badge: Simulated / Measured / Benchmark |
| **M10** | Assumptions tab + live cost | M9 | F | Every assumption listed with its badge. Moving €/km or €/h updates € within 100 ms. The TS cost function passes the same `test_vectors.json` as Python |
| **M11** | Coverage tab | M8 | F | Slider N updates the proposed sites, coverage % and marginal gain from the JSON; existing sites visibly distinct |
| **M12** | Break-even chart | M9 | F | Line chart of B's saving vs mean weekly fill with the min–max band; the current profile is marked |
| **M13** | Integration on real data | M7, M8–M12 | All | `make all SOURCE=vitrus` (or OSM) runs clean. The app shows real points. A diff report lists which assumptions changed source type |
| **M14** | Demo hardening | M13 | F + D | Static build deployed. Offline copy opens from disk. 1080p projector check. Backup video recorded. Feature freeze Thu 18:00 |
| S1–S3, O1–O2 | See §2.2–2.3 | M13 | Any | Each has its own pass/fail test written before it starts |

---

## 6. Risks and fallbacks

| Risk | Early signal | Fallback (simpler) | No-library fallback (if libraries are disallowed) |
|---|---|---|---|
| OSRM build fails or is too slow | Not serving by Mon 15:00 | Clip the extract to a Guimarães bounding box with `osmium extract` and rebuild. Else the openrouteservice matrix API (3,500 elements per request, tiled). Else straight-line × detour, labelled `approx` in the UI | Straight-line × calibrated detour factor |
| pyvroom won't install on a machine | M0 fails | Run the pipeline in Docker (`python:3.12-slim`) | Our own nearest-neighbour + 2-opt with capacity split (~150 lines) |
| spopt / CBC solve too slow | > 60 s per N | Reduce demand points (aggregate to a 250 m grid) | Greedy max-coverage: repeatedly add the site covering the most uncovered population (~40 lines; standard 63% guarantee) |
| No sponsor data during the week | Nothing by Tue 12:00 | Public OSM points + labelled synthetic fill rates; results shown only as ranges + break-even | Same |
| No population data | INE access fails | OSM building centroids as a demand proxy (labelled) | Same |
| Scenario B shows overflow above A | M4 check | Lower T; report the cost-vs-overflow trade-off explicitly | — |
| Frontend and pipeline drift | Schema test fails | `results.json` schema is the single contract; F works from M1f until M7 | — |
| Map tiles unavailable at the venue | M8 offline test | Boundary + points on a plain background; offline build | — |
| Scope creep | Any optional work before Wed evening | Stop; return to the first failing mandatory milestone | — |

---

## 7. Five-day schedule

Assumes 3–4 people. With 2, merge P and D, and drop S1–S3 and O1–O2.

| Day | P (pipeline) | F (frontend) | D (data / pitch) | End-of-day gate |
|---|---|---|---|---|
| **Mon 19** | 08:30 kickoff → decision gate by 10:00 → M0 → M1 (synthetic) → start OSRM build (runs unattended) | M0 → M1f fixture → M8 shell | Mentor meeting (§0 list); request data; OSM / INE / CAOP downloads; draft `assumptions.yaml` | M1 green, M1f exists, OSRM building or fallback chosen |
| **Tue 20** | M2 → M3 → M4 (first A/B numbers on synthetic data) | M8 done → M9 against fixture | Load public/sponsor data through M1; source labels; first assumption ledger | One four-week A/B run end-to-end; map shows real or OSM points |
| **Wed 21** | M5 → M6 → M7 (`make all`) | M10 → M11 → M12 | **Mentor review of assumptions and first results**; start pitch outline | **All mandatory features (F1–F10) working on one machine.** If not, Thursday is for finishing them, not for extras |
| **Thu 22** | M13 integration on best available data; S1/S2 if green | M13 + polish (empty, loading and error states) | README methodology section; benchmark citations; **feature freeze 18:00**; record backup video | Deployed URL works; offline copy works; video recorded |
| **Fri 23** | Bug fixes only | Bug fixes only | Final checklist (§10). **Submit by 12:00** (deadline 16:30 Lisbon = 21:00 IST) | Submission confirmed on TAIKAI |
| Sat–Sun | — | — | Pitch rehearsal ×5, Q&A prep | — |

**Work that can run in parallel:**
- After M1 + M1f: P (M2→M7), F (M8→M12) and D (data sourcing, assumptions, pitch) work independently.
- Inside the pipeline: M6 (coverage) needs only M1 when straight-line walking distance is used, so a second P developer can take M6 while the first does M3–M5.
- The only merge point is `results.json` (M7 → M13).

---

## 8. Showing impact without inventing results

**Four kinds of claim. Each one is labelled in the UI, the README and the slides.**

| Label | Meaning | Example | Allowed wording |
|---|---|---|---|
| **Measured** | Computed directly from real data, with no model assumptions | "X% of residents live within 500 m of a textile point today" (real points + census) | State as fact, with source and date |
| **Simulated** | Model output under stated assumptions | "Under the listed assumptions, B uses [min]–[max]% fewer km than A over four weeks" (filled from results.json, never typed by hand) | Always as a range across seeds and profiles, with "simulated" and a link to the assumptions |
| **Benchmark** | Published external result | "Ekocharita (Slovakia) cut textile collection cost by 22% with sensor-driven routing" | Cite the source; never present it as our own result |
| **Assumption** | An input we chose | "Container capacity [value] kg (assumption; replace with VITRUS value)" | Show it visibly; editable where possible |

**Rules:**
1. **No single-number savings claim.** Show the median and the min–max range across ≥ 10 seeds and the three fill profiles.
2. **Lead with the break-even curve.** "Demand-based collection is cheaper whenever average weekly fill is below X%; VITRUS can check its own fill against this line." The claim holds without knowing VITRUS's real fill rate.
3. **Scenario A is an optimised fixed round, not VITRUS's actual operation.** Say so. Savings against VITRUS's real routes could be larger or smaller; we don't know their routes.
4. **Overflow is part of every result.** A scenario only "wins" if its overflow container-days are equal to or lower than A's.
5. **Validation shown in the README:**
   - The OSRM-vs-straight-line check (M2).
   - Determinism (same seed, same output).
   - Python/TS cost parity (M10).
   - S2 optimisation value, if built.
6. **Context, not our output:** "73–80% of discarded textiles go to landfill or incineration" comes from the challenge brief; cite it as the problem. Retalho does not measure landfill diversion, so make no tonnage-diverted claim unless VITRUS supplies data.
7. **Investment:** shown as a number of new points. € only if VITRUS gives a unit cost.

---

## 9. Definition of done for the demo

The judge sees, in under 2 minutes, without anything failing:
1. Existing textile points and coverage % (**Measured**, if real data is available).
2. +N slider: new points appear, existing ones stay, coverage rises.
3. A vs B over four weeks: km, hours, € and overflow, as ranges (**Simulated**).
4. The break-even curve with VITRUS's likely fill zone marked.
5. The Assumptions tab: change €/km and every € figure updates.

---

## 10. Final submission checklist

**Code and reproducibility**
- [ ] `make all` rebuilds `out/results.json` from raw inputs on a clean clone (tested on a second machine)
- [ ] `pytest` and `vitest` pass; commands listed in the README
- [ ] Release tag on the submitted commit (e.g. `v1.0-submission`) **before Fri 12:00**
- [ ] Git history shows work only from 19 Oct onwards
- [ ] No secrets, API keys or personal data in the repository
- [ ] Sponsor data committed only if the organisers confirmed it is allowed; otherwise synthetic/public data + instructions

**README**
- [ ] Problem (with challenge brief citation) and one-sentence solution
- [ ] How to run: pipeline, web, Docker fallback
- [ ] Data sources with licence: OSM (ODbL, "© OpenStreetMap contributors"), CAOP, INE, sponsor
- [ ] Methodology: matrix, solver, simulation rules, fair-comparison rules, coverage model
- [ ] Assumptions table (mirrors `assumptions.yaml`) and the four claim labels
- [ ] Limitations (what is simulated; Scenario A is not VITRUS's real operation; distance provider used)
- [ ] Dependency list with licences (pyvroom/VROOM BSD-2, OSRM BSD-2, spopt BSD-3, Leaflet BSD-2, Recharts MIT, …) and the GLPK note if a Docker image is published
- [ ] Rule-compliance statement: all application code written 19–23 Oct 2026; libraries used as dependencies (per the organisers' answer)
- [ ] Licence for our own code (team decision; the team keeps the IP)

**Product**
- [ ] Deployed URL works in a private browser window
- [ ] Offline copy opens on the pitch laptop with the network off
- [ ] Every number shown carries a source label
- [ ] Backup demo video (≤ 3 min) uploaded

**TAIKAI submission**
- [ ] Project linked to **Challenge 5: TexVitrus**
- [ ] Description, repository link, demo URL, video, slides (as required by the organisers' answer)
- [ ] Submitted before 16:30 Lisbon time (21:00 IST); target 12:00

**Pitch (Mon 26 Oct, 14:30 Lisbon / 20:00 IST)**
- [ ] Rehearsed ×5 to time; one slide per official criterion (innovation, technical soundness, impact on the territory, clarity)
- [ ] Q&A answers ready on: data quality, simulated vs measured, why no sensors, cost assumptions, the two EU legal layers (separate collection since 2025; producer responsibility from 2028)
