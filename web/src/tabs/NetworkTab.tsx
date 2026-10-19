import { useMemo } from "react";
import { Badge, sourceBadge, type BadgeKind } from "../components/Badge";
import { MAP_INK, MapLegend, MapView, type PointLayer } from "../components/MapView";
import { Card, StatTile } from "../components/StatTile";
import { fmt, pct } from "../lib/format";
import { useTokens } from "../lib/tokens";
import type { PointCollection, Results } from "../types";

export const toPoints = (fc: PointCollection) =>
  fc.features.map((f) => ({
    id: f.properties.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    label: `<b>${f.properties.id}</b>${f.properties.name ? `<br>${f.properties.name}` : ""}` +
      `${f.properties.site_type ? `<br>${f.properties.site_type}` : ""}`,
  }));

/** Badge for a figure computed from input data: Measured only when the inputs are real. */
export function dataBadges(types: string[]): BadgeKind[] {
  return types.includes("synthetic") ? ["synthetic"] : ["measured", ...types.map(sourceBadge)];
}

/** Badge for a what-if computed on input data (e.g. coverage with proposed sites): a model output. */
export function whatIfBadges(types: string[]): BadgeKind[] {
  return types.includes("synthetic") ? ["simulated", "synthetic"] : ["simulated", ...types.map(sourceBadge)];
}

export function NetworkTab({ r }: { r: Results }) {
  const t = useTokens();
  const { containers, candidates, depot, boundary } = r.network;
  const cov = r.coverage;
  const containerTypes = [...new Set(containers.features.map((f) => f.properties.source_type))];
  const osmPoints = containerTypes.includes("public");

  const layers = useMemo<PointLayer[]>(() => [
    { name: "Candidate site", points: toPoints(candidates), color: t.candidate, radius: 4, hollow: true },
    { name: "Existing textile point", points: toPoints(containers), color: t["series-a"], radius: 5 },
    { name: "Depot", points: [{ id: depot.id, lat: depot.lat, lon: depot.lon, label: `<b>${depot.name}</b>` }],
      color: MAP_INK, radius: 6, square: true },
  ], [candidates, containers, depot, t]);

  const checks = r.meta.distance_checks;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Existing textile points" value={fmt(containers.features.length)}
                  badges={containerTypes.map(sourceBadge)} swatch={t["series-a"]} />
        <StatTile label="Candidate sites" value={fmt(candidates.features.length)}
                  sub="Places a new point could go" badges={[...new Set(candidates.features.map((f) => sourceBadge(f.properties.source_type)))]} />
        <StatTile label={`Residents within ${fmt(cov.radius_m)} m of a ${osmPoints ? "mapped " : ""}point`} value={pct(cov.existing.share)}
                  sub={`${fmt(cov.existing.covered_pop)} of ${fmt(cov.population_total)} people` +
                       (osmPoints ? "; only points mapped in OpenStreetMap" : "")}
                  badges={[...dataBadges(cov.data_source_types), "straight-line"]} />
        <StatTile label="Depot" value={<span className="text-lg">{depot.name}</span>} badges={[sourceBadge(depot.source_type)]} />
      </div>

      <Card title="Textile collection network" subtitle="Existing points, candidate sites and the depot. Hover a point for details.">
        <MapView boundary={boundary} layers={layers} />
        <MapLegend items={[
          { color: t["series-a"], label: "Existing textile point" },
          { color: t.candidate, label: "Candidate site", hollow: true },
          { color: t.ink, label: "Depot", square: true },
        ]} />
      </Card>

      <Card title="Distances used for routing" subtitle={r.meta.distance_label}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {r.meta.distance_provider === "approx" ? <Badge kind="approx" /> : <Badge kind="public" />}
          {checks && (
            <span>
              Road distance shorter than the straight line: <b className="text-ink">{checks.road_shorter_than_straight_line}</b> pairs.
              {checks.calibration && <> Median road / straight-line ratio <b className="text-ink">{checks.calibration.detour_factor_median}</b>,
                median free-flow speed <b className="text-ink">{checks.calibration.speed_kmh_median} km/h</b> ({fmt(checks.calibration.pairs)} pairs).</>}
              {" "}Furthest point from a road: {fmt(checks.max_snap_m)} m.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
