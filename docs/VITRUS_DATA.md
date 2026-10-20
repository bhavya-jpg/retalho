# Bringing in VITRUS data

This is the procedure for replacing Retalho's public and assumed inputs with VITRUS's own data. Nothing from VITRUS is in the repository yet: `data/raw/vitrus/` is git-ignored, so sponsor files are never committed by accident.

## What is still missing

| Input | Used for | Current stand-in | Where it goes |
|---|---|---|---|
| Textile container locations | every map, coverage today, the collection network | 2 OpenStreetMap containers + 15 proposed sites | `data/raw/vitrus/containers.csv` |
| Container capacity (kg) | fill model, truck loads | 300 kg (assumption) | `capacity_kg` column, and `container_capacity_kg` |
| Depot location | every route | assumed point | `data/raw/vitrus/depot.json` |
| Fill rates or textile characterisation | which fill profile applies; break-even position | three profiles, 35% / 60% / 90% per week (assumption) | `fill_rate_profiles`, `fill_weekly_cv` |
| Truck capacity (kg) | routing constraints | 2,500 kg (assumption) | `truck_capacity_kg` |
| Number of trucks, working days | weekly fleet | 2 trucks × 5 days (assumption) | `trucks`, `collection_days_per_week` |
| Crew size and cost per hour | costs | €30/h for the whole crew (assumption) | `crew_cost_per_h` |
| Shift length | routing constraints | 8 h (assumption) | `shift_h` |
| Service time per container | crew hours | 5 min (assumption) | `service_min_per_stop` |
| Cost per km, fixed cost per truck-day | costs | €0.60/km, €50/day (assumption) | `cost_per_km`, `fixed_cost_per_truck_day` |
| Truck speed vs car | travel times | 80% of free-flow car speed (assumption) | `truck_speed_factor` |

Parameters live in `config/assumptions.yaml`. Each has `value`, `unit`, `source_type` and `note`.

## Procedure

1. **Prepare the folder.** Run `make vitrus-init`. It creates `data/raw/vitrus/` and copies in only the *public* layers VITRUS is unlikely to send (boundary, census population, candidate sites), with their provenance. It writes an empty `containers.csv` (header only) and a `PROVENANCE.md` template. It never overwrites anything.

2. **Keep the originals.** Copy every file exactly as received into `data/raw/vitrus/original/` and do not edit those copies.

3. **Record provenance.** In `data/raw/vitrus/PROVENANCE.md`, for each file note who sent it, the date received, the terms of use, and every transformation made, such as a column rename, a coordinate conversion or a unit change.

4. **Write the pipeline files.**
   - **`containers.csv`:** columns `id, lat, lon, capacity_kg, site_type, source_type, name`.
     - `lat`/`lon` are WGS84 decimal degrees.
     - `site_type` is one of `ecoponto`, `standalone`, `other`.
     - `source_type` is `sponsor`.
     - A GeoJSON `containers.geojson` with the same properties also works.
   - **`depot.json`:** `{"name": "...", "lat": ..., "lon": ..., "source_type": "sponsor"}`.
   - **`sources.json`:** add an entry such as `"vitrus": {"name": "VITRUS container register", "licence": "<terms>", "url": null, "source_type": "sponsor"}`.

5. **Update assumptions.** For every figure VITRUS confirms:
   - change `value` in `config/assumptions.yaml`
   - set `source_type: sponsor`
   - name the file in `note`

   With the real container list, set `collection_network_new_points: 0` to simulate VITRUS's actual network. Keep 15 to simulate it with the proposed sites added.

6. **Validate.** Run `make data SOURCE=vitrus`. Validation lists every problem at once and writes nothing until all are fixed:
   - missing fields
   - duplicate ids
   - points outside the boundary
   - non-positive capacity
   - unknown site types or labels

   Fix the pipeline files, not the originals, and record each fix in `PROVENANCE.md`.

7. **Re-clip the road network** if the boundary changed: `make osrm-build && make osrm`.

8. **Recompute everything.** Run `make all SOURCE=vitrus`, then `make all SOURCE=public` if you want the public scenario rebuilt as well. This reruns:
   - the matrix and coverage
   - the four-week A/B simulation and the break-even sweep
   - the optimisation benchmark and the route geometry

9. **Compare.** `out/source_report_vitrus.md` lists every input whose source changed and every assumption whose value or source changed, compared with the public planned-network scenario. The app's header switch shows "VITRUS data" next to the public and synthetic datasets.

## What becomes measured

| Figure | With public data | With VITRUS data |
|---|---|---|
| Coverage today | Measured, but OSM-mapped points only | Measured on VITRUS's real points |
| Coverage with +N sites | Simulated (what-if) | Simulated (what-if) |
| Four-week costs, km, overflow | Simulated, on assumed fill and costs | Still simulated. Only the confirmed inputs become measured, and each assumption's badge in the Pressupostos tab shows which. |
| Route distances | OSRM road distances | OSRM road distances |

Collection results stay **simulated**, because they model four future weeks. VITRUS data makes their inputs real; it does not turn the outputs into observations.
