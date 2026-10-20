import { useMemo } from "react";
import { Badge, sourceBadge, type BadgeKind } from "../components/Badge";
import { MAP_INK, MapLegend, MapView, type PointLayer } from "../components/MapView";
import { Card, StatTile } from "../components/StatTile";
import { fmt, pct } from "../lib/format";
import { t as tx, td, tr, useLang } from "../lib/i18n";
import { useTokens } from "../lib/tokens";
import type { PointCollection, Results } from "../types";

export const toPoints = (fc: PointCollection) =>
  fc.features.map((f) => ({
    id: f.properties.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    label: `<b>${f.properties.id}</b>${f.properties.name ? `<br>${td(f.properties.name)}` : ""}` +
      `${f.properties.site_type ? `<br>${td(f.properties.site_type)}` : ""}`,
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
  const { lang } = useLang();

  const layers = useMemo<PointLayer[]>(() => [
    { name: tx("net.legendCandidate"), points: toPoints(candidates), color: t.candidate, radius: 4, hollow: true, key: "candidate" },
    { name: tx("net.legendExisting"), points: toPoints(containers), color: MAP_INK, radius: 5.5, key: "existing" },
    { name: tx("net.depot"), points: [{ id: depot.id, lat: depot.lat, lon: depot.lon, label: `<b>${td(depot.name)}</b>` }],
      color: MAP_INK, radius: 6, square: true },
  ], [candidates, containers, depot, t, lang]);

  const checks = r.meta.distance_checks;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile id="Existing textile points" label={tx("net.existing")} value={fmt(containers.features.length)}
                  badges={containerTypes.map(sourceBadge)} swatch={t.ink} />
        <StatTile label={tx("net.candidates")} value={fmt(candidates.features.length)}
                  sub={tx("net.candidatesSub")} badges={[...new Set(candidates.features.map((f) => sourceBadge(f.properties.source_type)))]} />
        <StatTile label={tx(osmPoints ? "net.withinMapped" : "net.within", { r: fmt(cov.radius_m) })} value={pct(cov.existing.share)}
                  sub={tx("net.people", { c: fmt(cov.existing.covered_pop), t: fmt(cov.population_total) }) +
                       (osmPoints ? tx("net.osmOnly") : "")}
                  badges={[...dataBadges(cov.data_source_types), "straight-line"]} />
        <StatTile label={tx("net.depot")} value={<span className="text-lg">{td(depot.name)}</span>} badges={[sourceBadge(depot.source_type)]} />
      </div>

      <Card title={tx("net.card")} subtitle={tx("net.cardSub")}>
        <MapView boundary={boundary} layers={layers} />
        <MapLegend items={[
          { color: t.ink, label: tx("net.legendExisting") },
          { color: t.candidate, label: tx("net.legendCandidate"), hollow: true },
          { color: t.ink, label: tx("net.depot"), square: true },
        ]} />
      </Card>

      <Card title={tx("net.distances")} subtitle={td(r.meta.distance_label)}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {r.meta.distance_provider === "approx" ? <Badge kind="approx" /> : <Badge kind="public" />}
          {checks && (
            <span>
              {tr("net.shorter", { n: fmt(checks.road_shorter_than_straight_line) })}
              {checks.calibration && <> {tr("net.calibration", { r: fmt(checks.calibration.detour_factor_median, 3),
                s: fmt(checks.calibration.speed_kmh_median, 1), p: fmt(checks.calibration.pairs) })}</>}
              {" "}{tx("net.snap", { m: fmt(checks.max_snap_m) })}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
