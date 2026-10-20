// Types for public/results.json. The contract is schema/results.schema.json (PLAN.md §4.3).

export type Range = { min: number; median: number; max: number };
export type DataSourceType = "sponsor" | "public" | "synthetic";
export type AssumptionSource = "sponsor" | "public" | "assumption";

export type PointFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { id: string; source_type: DataSourceType; name?: string; site_type?: string; capacity_kg?: number };
};
export type PointCollection = { type: "FeatureCollection"; features: PointFeature[] };

export type Route = { truck: number; stop_ids: string[]; km: number; travel_h: number; kg: number };
export type Week = {
  week: number; stops: number; km: number; travel_h: number; service_h: number; crew_h: number;
  kg: number; truck_days: number; overflow_container_days: number; routes: Route[];
};
export type Totals = {
  km: number; travel_h: number; service_h: number; crew_h: number; kg: number; stops: number;
  truck_days: number; overflow_container_days: number; end_backlog_kg: number; generated_kg?: number;
};
export type SeedRun = { seed: number; inputs: string; weeks: Week[]; totals: Totals };
export type Scenario = { per_seed: SeedRun[]; summary: Record<string, Range> };
export type Physical = { km: number; crew_h: number; truck_days: number; kg: number };

export type BreakevenPoint = {
  mean_weekly_fill: number; spread: number;
  saving_km_pct: Range | null; saving_cost_pct: Range | null; saving_cost_per_tonne_pct: Range | null;
  extra_overflow_days_B: Range | null; extra_backlog_kg_B: Range | null;
  per_seed: { seed: number; A: Physical; B: Physical }[];
};

export type Assumption = { key: string; value: unknown; unit: string; source_type: AssumptionSource; note: string };

export type Results = {
  meta: {
    generated_at: string; git_commit: string; label: string; data_source: string;
    distance_provider: "osrm" | "approx"; distance_label: string;
    distance_checks?: { road_shorter_than_straight_line: number; max_snap_m: number;
                        calibration: { pairs: number; detour_factor_median: number; speed_kmh_median: number } | null };
    data_sources: { name: string; source_type: DataSourceType; licence: string; url: string | null }[];
    seeds: number[]; horizon_weeks: number; threshold_T: number;
    fleet: { vehicles: number; capacity_kg: number; shift_h: number; service_min_per_stop: number; speed_factor: number };
    collection_network?: { existing: string[]; proposed: string[]; n_new: number } | null;
  };
  assumptions: Assumption[];
  network: {
    containers: PointCollection; candidates: PointCollection;
    depot: { id: string; name: string; lat: number; lon: number; source_type: DataSourceType };
    boundary: GeoJSON.FeatureCollection;
  };
  coverage: {
    label: string; distance: "straight_line" | "walking_route"; radius_m: number; population_total: number;
    data_source_types: DataSourceType[];
    existing: { sites: string[]; covered_pop: number; share: number };
    all_candidates: { covered_pop: number; share: number };
    additions: { n_new: number; site_ids: string[]; covered_pop: number; share: number; marginal_share: number; nested: boolean }[];
  };
  scenarios: Record<string, { A: Scenario; B: Scenario }>;
  breakeven: { points: BreakevenPoint[]; monotonicity_violations: unknown[]; cost_params: CostParams };
  benchmarks: { name: string; metric: string; value: number; unit: string; source_url: string; note?: string }[];
  route_geometry?: RouteGeometry | null;
};

export type RouteGeometry = {
  route_keys: Record<string, string>;
  geometries: Record<string, { status: "road"; polyline6: string; osrm_distance_m: number }
                            | { status: "straight"; reason: string; coords: [number, number][] }>;
  stats: Record<string, number>;
  data_version: string | null;
};

export type CostParams = { cost_per_km: number; crew_cost_per_h: number; fixed_cost_per_truck_day: number };

export type DatasetIndex = { default: string; datasets: { source: string; label: string; file: string; generated_at: string }[] };
