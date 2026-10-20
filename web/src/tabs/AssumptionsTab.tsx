import { useMemo } from "react";
import { Badge } from "../components/Badge";
import { Card, Segmented, StatTile } from "../components/StatTile";
import { compareScenarios } from "../lib/cost";
import { eur, fmt, humanKey, signedPct } from "../lib/format";
import { t, td, tNote, tOr, tParam, tr, tUnit, useLang, type Key } from "../lib/i18n";
import type { Assumption, CostParams, Results } from "../types";
import { profileMeans, profileOptions, resultBadges } from "./CollectionTab";

type Props = {
  r: Results; costs: CostParams; setCosts: (c: CostParams) => void; defaults: CostParams;
  profile: string; setProfile: (p: string) => void;
};

const SLIDERS: { key: keyof CostParams; label: Key; unit: string | Key; max: number; step: number; digits: number }[] = [
  { key: "cost_per_km", label: "as.kmCost", unit: "€/km", max: 3, step: 0.05, digits: 2 },
  { key: "crew_cost_per_h", label: "as.crewCost", unit: "€/h", max: 100, step: 1, digits: 0 },
  { key: "fixed_cost_per_truck_day", label: "as.fixedCost", unit: "as.perDay", max: 300, step: 5, digits: 0 },
];

function valueText(a: Assumption): string {
  if (a.value === null) return t("as.unknown");
  if (a.key === "fill_rate_profiles" && typeof a.value === "object") {
    return Object.entries(a.value as Record<string, { mean: number; spread: number }>)
      .map(([k, v]) => t("as.profileValue", { name: tOr(`profile.${k}`, k), m: fmt(v.mean * 100), s: fmt(v.spread * 100) })).join(" · ");
  }
  return typeof a.value === "number" ? fmt(a.value, Number.isInteger(a.value) ? 0 : 2) : String(a.value);
}

export function AssumptionsTab({ r, costs, setCosts, defaults, profile, setProfile }: Props) {
  const { A, B } = r.scenarios[profile];
  const cmp = useMemo(() => compareScenarios(A, B, costs), [A, B, costs]);
  const means = profileMeans(r);
  const changed = SLIDERS.some((s) => costs[s.key] !== defaults[s.key]);
  const counts = r.assumptions.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.source_type]: (acc[a.source_type] ?? 0) + 1 }), {});
  useLang();

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("as.card")}
            subtitle={t("as.cardSub")}
            actions={changed && (
              <button onClick={() => setCosts(defaults)} className="rounded-md border border-line px-3 py-1 text-sm text-ink-2 hover:text-ink">
                {t("as.reset")}
              </button>
            )}>
        <div className="grid gap-4 md:grid-cols-3">
          {SLIDERS.map((s) => (
            <label key={s.key} className="flex flex-col gap-1 text-sm text-ink-2">
              <span className="flex justify-between">
                <span>{t(s.label)}</span>
                <span className="tabular font-semibold text-ink">{fmt(costs[s.key], s.digits)} {s.unit.startsWith("as.") ? t(s.unit as Key) : s.unit}</span>
              </span>
              <input type="range" min={0} max={s.max} step={s.step} value={costs[s.key]}
                     onChange={(e) => setCosts({ ...costs, [s.key]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-2">{t("profile.label")}</span>
          <Segmented label={t("profile.label")} value={profile} onChange={setProfile} options={profileOptions(r, means)} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile id="A · four-week cost (median)" label={t("as.costA")} value={cmp.costA ? eur(cmp.costA.median) : t("common.na")} badges={resultBadges(r)} />
          <StatTile id="B · four-week cost (median)" label={t("as.costB")} value={cmp.costB ? eur(cmp.costB.median) : t("common.na")} badges={resultBadges(r)} />
          <StatTile id="B vs A (negative = B cheaper)" label={t("as.diff")} value={cmp.savingCostPct ? signedPct(-cmp.savingCostPct.median) : t("common.na")}
                    badges={resultBadges(r)} />
        </div>
      </Card>

      <Card title={t("as.every")}
            subtitle={tr("as.everySub", { a: counts.assumption ?? 0,
              rest: (counts.sponsor ? t("as.everySponsor", { n: counts.sponsor }) : "") + (counts.public ? t("as.everyPublic", { n: counts.public }) : "") })}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-start text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="py-2 font-medium">{t("as.thParam")}</th><th className="font-medium">{t("as.thValue")}</th><th className="font-medium">{t("as.thUnit")}</th>
                <th className="font-medium">{t("as.thSource")}</th><th className="font-medium">{t("as.thNote")}</th></tr>
            </thead>
            <tbody>
              {r.assumptions.map((a) => (
                <tr key={a.key} className="border-t border-line align-top">
                  <td className="py-2 pe-3 font-medium text-ink">{tParam(a.key, humanKey(a.key))}</td>
                  <td className="tabular py-2 pe-3 text-ink">{valueText(a)}</td>
                  <td className="py-2 pe-3 text-ink-2">{tUnit(a.unit)}</td>
                  <td className="py-2 pe-3"><Badge kind={a.source_type === "assumption" ? "assumption" : a.source_type} /></td>
                  <td className="py-2 text-xs text-ink-2">{tNote(a.key, a.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t("as.sources")}>
        <ul className="flex flex-col gap-2 text-sm text-ink-2">
          {r.meta.data_sources.map((d) => (
            <li key={d.name} className="flex flex-wrap items-center gap-2">
              <Badge kind={d.source_type} />
              <span className="text-ink">{td(d.name)}</span>
              <span className="text-xs">{d.url ? <a className="underline" href={d.url} target="_blank" rel="noreferrer">{td(d.licence)}</a> : td(d.licence)}</span>
            </li>
          ))}
        </ul>
        {r.benchmarks.length === 0 && (
          <p className="mt-3 text-xs text-muted">{t("as.noBenchmarks")}</p>
        )}
      </Card>
    </div>
  );
}
