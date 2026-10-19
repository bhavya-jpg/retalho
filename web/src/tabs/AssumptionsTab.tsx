import { useMemo } from "react";
import { Badge } from "../components/Badge";
import { Card, Segmented, StatTile } from "../components/StatTile";
import { compareScenarios } from "../lib/cost";
import { eur, fmt, humanKey, signedPct } from "../lib/format";
import type { Assumption, CostParams, Results } from "../types";
import { profileMeans, resultBadges } from "./CollectionTab";

type Props = {
  r: Results; costs: CostParams; setCosts: (c: CostParams) => void; defaults: CostParams;
  profile: string; setProfile: (p: string) => void;
};

const SLIDERS: { key: keyof CostParams; label: string; unit: string; max: number; step: number; digits: number }[] = [
  { key: "cost_per_km", label: "Vehicle cost per km", unit: "€/km", max: 3, step: 0.05, digits: 2 },
  { key: "crew_cost_per_h", label: "Crew cost per hour", unit: "€/h", max: 100, step: 1, digits: 0 },
  { key: "fixed_cost_per_truck_day", label: "Fixed cost per truck-day", unit: "€/day", max: 300, step: 5, digits: 0 },
];

function valueText(a: Assumption): string {
  if (a.value === null) return "unknown";
  if (a.key === "fill_rate_profiles" && typeof a.value === "object") {
    return Object.entries(a.value as Record<string, { mean: number; spread: number }>)
      .map(([k, v]) => `${k}: ${fmt(v.mean * 100)}% ± ${fmt(v.spread * 100)}`).join(" · ");
  }
  return typeof a.value === "number" ? fmt(a.value, Number.isInteger(a.value) ? 0 : 2) : String(a.value);
}

export function AssumptionsTab({ r, costs, setCosts, defaults, profile, setProfile }: Props) {
  const { A, B } = r.scenarios[profile];
  const cmp = useMemo(() => compareScenarios(A, B, costs), [A, B, costs]);
  const means = profileMeans(r);
  const changed = SLIDERS.some((s) => costs[s.key] !== defaults[s.key]);
  const counts = r.assumptions.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.source_type]: (acc[a.source_type] ?? 0) + 1 }), {});

  return (
    <div className="flex flex-col gap-4">
      <Card title="Cost assumptions"
            subtitle="Move a slider and every € figure in the app updates. Costs are arithmetic on simulated km, hours and truck-days."
            actions={changed && (
              <button onClick={() => setCosts(defaults)} className="rounded-md border border-line px-3 py-1 text-sm text-ink-2 hover:text-ink">
                Reset to file values
              </button>
            )}>
        <div className="grid gap-4 md:grid-cols-3">
          {SLIDERS.map((s) => (
            <label key={s.key} className="flex flex-col gap-1 text-sm text-ink-2">
              <span className="flex justify-between">
                <span>{s.label}</span>
                <span className="tabular font-semibold text-ink">{fmt(costs[s.key], s.digits)} {s.unit}</span>
              </span>
              <input type="range" min={0} max={s.max} step={s.step} value={costs[s.key]}
                     onChange={(e) => setCosts({ ...costs, [s.key]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-2">Fill-rate profile</span>
          <Segmented label="Fill-rate profile" value={profile} onChange={setProfile}
                     options={Object.keys(r.scenarios).map((p) => ({ value: p, label: `${p} (${fmt((means[p] ?? 0) * 100)}%)` }))} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatTile label="A · four-week cost (median)" value={cmp.costA ? eur(cmp.costA.median) : "n/a"} badges={resultBadges(r)} />
          <StatTile label="B · four-week cost (median)" value={cmp.costB ? eur(cmp.costB.median) : "n/a"} badges={resultBadges(r)} />
          <StatTile label="B vs A (negative = B cheaper)" value={cmp.savingCostPct ? signedPct(-cmp.savingCostPct.median) : "n/a"}
                    badges={resultBadges(r)} />
        </div>
      </Card>

      <Card title="Every assumption"
            subtitle={<>From config/assumptions.yaml. {counts.assumption ?? 0} are placeholders still waiting for a confirmed value
              {counts.sponsor ? `, ${counts.sponsor} from VITRUS` : ""}{counts.public ? `, ${counts.public} from public data` : ""}.</>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="py-2 font-medium">Parameter</th><th className="font-medium">Value</th><th className="font-medium">Unit</th>
                <th className="font-medium">Source</th><th className="font-medium">Note</th></tr>
            </thead>
            <tbody>
              {r.assumptions.map((a) => (
                <tr key={a.key} className="border-t border-line align-top">
                  <td className="py-2 pr-3 font-medium text-ink">{humanKey(a.key)}</td>
                  <td className="tabular py-2 pr-3 text-ink">{valueText(a)}</td>
                  <td className="py-2 pr-3 text-ink-2">{a.unit}</td>
                  <td className="py-2 pr-3"><Badge kind={a.source_type === "assumption" ? "assumption" : a.source_type} /></td>
                  <td className="py-2 text-xs text-ink-2">{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Data sources">
        <ul className="flex flex-col gap-2 text-sm text-ink-2">
          {r.meta.data_sources.map((d) => (
            <li key={d.name} className="flex flex-wrap items-center gap-2">
              <Badge kind={d.source_type} />
              <span className="text-ink">{d.name}</span>
              <span className="text-xs">{d.url ? <a className="underline" href={d.url} target="_blank" rel="noreferrer">{d.licence}</a> : d.licence}</span>
            </li>
          ))}
        </ul>
        {r.benchmarks.length === 0 && (
          <p className="mt-3 text-xs text-muted">No external benchmarks are shown: none has been verified against its source yet.</p>
        )}
      </Card>
    </div>
  );
}
