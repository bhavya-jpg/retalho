# Source report: Public data (OpenStreetMap + INE Census 2021)

Generated 2026-10-20T09:56:14+00:00, distances: osrm.

## Inputs

| Input | Source type |
|---|---|
| containers | public |
| candidates | public |
| demand_points | public |
| depot | synthetic |
| boundary | public |

## Assumptions by source

- **assumption** (18): container_capacity_kg, fill_rate_profiles, fill_weekly_cv, collection_network_new_points, collection_days_per_week, threshold_T, service_min_per_stop, trucks, truck_capacity_kg, truck_speed_factor, shift_h, cost_per_km, crew_cost_per_h, fixed_cost_per_truck_day, new_point_cost, coverage_radius_m, seeds, horizon_weeks
- **public** (2): detour_factor, fallback_speed_kmh

## Changes vs Synthetic demo data

- containers: synthetic -> public
- candidates: synthetic -> public
- demand_points: synthetic -> public
- boundary: synthetic -> public
