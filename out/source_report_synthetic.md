# Source report: Synthetic demo data

Generated 2026-10-20T12:44:54+00:00, distances: osrm.

## Inputs

| Input | Source type |
|---|---|
| containers | synthetic |
| candidates | synthetic |
| demand_points | synthetic |
| depot | synthetic |
| boundary | synthetic |

## Assumptions by source

- **assumption** (18): container_capacity_kg, fill_rate_profiles, fill_weekly_cv, collection_network_new_points, collection_days_per_week, threshold_T, service_min_per_stop, trucks, truck_capacity_kg, truck_speed_factor, shift_h, cost_per_km, crew_cost_per_h, fixed_cost_per_truck_day, new_point_cost, coverage_radius_m, seeds, horizon_weeks
- **public** (2): detour_factor, fallback_speed_kmh

## Changes vs Public data (OpenStreetMap + INE Census 2021)

- containers: public -> synthetic
- candidates: public -> synthetic
- demand_points: public -> synthetic
- boundary: public -> synthetic
