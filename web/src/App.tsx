import { useEffect, useMemo, useState } from "react";
import { Badge } from "./components/Badge";
import { AssumptionsTab } from "./tabs/AssumptionsTab";
import { CollectionTab } from "./tabs/CollectionTab";
import { CoverageTab } from "./tabs/CoverageTab";
import { NetworkTab } from "./tabs/NetworkTab";
import type { CostParams, DatasetIndex, Results } from "./types";

const TABS = [
  { id: "rede", pt: "Rede", en: "Network" },
  { id: "cobertura", pt: "Cobertura", en: "Coverage" },
  { id: "recolha", pt: "Recolha", en: "Collection" },
  { id: "pressupostos", pt: "Pressupostos", en: "Assumptions" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; results: Results };

async function getJson<T>(file: string): Promise<T> {
  // The single-file offline build embeds every data file (scripts/offline.mjs).
  const embedded = (window as unknown as { __RETALHO_DATA__?: Record<string, unknown> }).__RETALHO_DATA__;
  if (embedded) {
    if (file in embedded) return embedded[file] as T;
    throw new Error(`${file} is not embedded in this offline copy.`);
  }
  const res = await fetch(`./${file}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${file} could not be loaded (HTTP ${res.status}).`);
  return res.json();
}

/** datasets.json lists the result files the pipeline exported; without it, fall back to results.json. */
function useDatasets(): DatasetIndex | null | undefined {
  const [index, setIndex] = useState<DatasetIndex | null | undefined>(undefined);
  useEffect(() => { getJson<DatasetIndex>("datasets.json").then(setIndex, () => setIndex(null)); }, []);
  return index;
}

function useResults(file: string | null): Load {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    if (!file) return;
    setLoad({ state: "loading" });
    getJson<Results>(file)
      .then((results) => {
        if (!results?.meta || !results?.scenarios) throw new Error(`${file} does not look like Retalho output.`);
        setLoad({ state: "ready", results });
      })
      .catch((e: Error) => setLoad({ state: "error", message: e.message }));
  }, [file]);
  return load;
}

function initialTab(): TabId {
  const h = window.location.hash.slice(1);
  return (TABS.find((t) => t.id === h)?.id ?? "rede") as TabId;
}

export default function App() {
  const index = useDatasets();
  const [source, setSource] = useState<string | null>(null);
  const active = index?.datasets.find((d) => d.source === (source ?? index.default));
  const file = index === undefined ? null : active ? active.file : "results.json";
  const load = useResults(file);
  const [tab, setTab] = useState<TabId>(initialTab);
  useEffect(() => { history.replaceState(null, "", `#${tab}`); }, [tab]);

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-3 px-4 pt-5">
          <div>
            <h1 className="text-xl font-semibold text-ink">Retalho</h1>
            <p className="text-sm text-ink-2">Textile collection planning for Guimarães: where to put points, and how to collect them</p>
          </div>
          {index && index.datasets.length > 1 && (
            <label className="flex items-center gap-2 pb-1 text-sm text-ink-2">
              Data
              <select value={active?.source} onChange={(e) => setSource(e.target.value)}
                      className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink">
                {index.datasets.map((d) => <option key={d.source} value={d.source}>{d.label}</option>)}
              </select>
            </label>
          )}
          {load.state === "ready" && (
            <div className="flex flex-wrap gap-1.5 pb-1">
              {load.results.meta.data_source === "synthetic" && <Badge kind="synthetic" />}
              {load.results.meta.distance_provider === "approx" ? <Badge kind="approx" /> : <Badge kind="simulated" />}
            </div>
          )}
        </div>
        <nav className="mx-auto mt-3 flex max-w-7xl gap-1 overflow-x-auto px-4" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                    className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                      tab === t.id ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"
                    }`}>
              {t.pt} <span className="font-normal text-muted">· {t.en}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-5">
        {load.state === "loading" && <p className="py-20 text-center text-ink-2">Loading results…</p>}
        {load.state === "error" && (
          <div role="alert" className="mx-auto max-w-xl rounded-lg border border-line bg-surface p-6">
            <h2 className="font-semibold text-critical">Results unavailable</h2>
            <p className="mt-2 text-sm text-ink-2">{load.message}</p>
            <p className="mt-2 text-sm text-ink-2">
              Generate them with <code className="rounded bg-surface-2 px-1">make all</code>, which writes
              <code className="rounded bg-surface-2 px-1">web/public/results.json</code>, then reload.
            </p>
          </div>
        )}
        {load.state === "ready" && <Dashboard key={load.results.meta.data_source} r={load.results} tab={tab} />}
      </main>
    </div>
  );
}

function Dashboard({ r, tab }: { r: Results; tab: TabId }) {
  const defaults = useMemo<CostParams>(() => {
    const v = (k: string) => Number(r.assumptions.find((a) => a.key === k)?.value ?? 0);
    return { cost_per_km: v("cost_per_km"), crew_cost_per_h: v("crew_cost_per_h"), fixed_cost_per_truck_day: v("fixed_cost_per_truck_day") };
  }, [r]);
  const [costs, setCosts] = useState(defaults);
  const profiles = Object.keys(r.scenarios);
  const [profile, setProfile] = useState(profiles.includes("mid") ? "mid" : profiles[0]);

  return (
    <div className="flex flex-col gap-4">
      <ProvenanceBanner r={r} />
      {r.meta.distance_provider === "approx" && (
        <div className="rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          <b>Approximate distances.</b> {r.meta.distance_label}. Road distances were not available when these results were built.
        </div>
      )}
      {tab === "rede" && <NetworkTab r={r} />}
      {tab === "cobertura" && <CoverageTab r={r} />}
      {tab === "recolha" && <CollectionTab r={r} profile={profile} setProfile={setProfile} costs={costs} />}
      {tab === "pressupostos" && (
        <AssumptionsTab r={r} costs={costs} setCosts={setCosts} defaults={defaults} profile={profile} setProfile={setProfile} />
      )}
      <footer className="mt-6 border-t border-line pt-3 text-xs text-muted">
        Results generated {new Date(r.meta.generated_at).toLocaleString("en-GB")} · commit {r.meta.git_commit} ·{" "}
        {r.meta.seeds.length} runs × {r.meta.horizon_weeks} weeks · Map data © OpenStreetMap contributors
      </footer>
    </div>
  );
}

/** Says exactly which inputs are real, which are assumed, and what that means for the figures. */
function ProvenanceBanner({ r }: { r: Results }) {
  if (r.meta.data_source === "synthetic") {
    return (
      <div className="rounded-lg bg-warn-bg px-4 py-3 text-sm text-warn-ink">
        <b>Synthetic data.</b> Container locations, population, depot and boundary are generated, not VITRUS or official
        data. Every result shown is simulated on them and illustrates the method only.
      </div>
    );
  }
  const containers = r.network.containers.features;
  const osm = containers.some((f) => f.properties.source_type === "public");
  const assumedDepot = r.network.depot.source_type === "synthetic";
  const net = r.meta.collection_network;
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
      <b className="text-ink">{r.meta.data_source === "public" ? "Public data." : "VITRUS data."}</b>{" "}
      {r.meta.data_sources.filter((d) => d.source_type !== "synthetic").map((d) => d.name).join("; ")}.
      {osm && <> OpenStreetMap lists only {containers.length} textile container{containers.length === 1 ? "" : "s"} in the
        municipality, likely fewer than are in use; VITRUS&apos;s own list would replace them.</>}
      {assumedDepot && <> The depot location is assumed.</>}
      {net && net.n_new > 0 && <> Collection is simulated on the planned network: existing points plus the {net.n_new} sites
        proposed on the Coverage tab.</>}
      {" "}Fill rates, fleet and costs are assumptions (see Pressupostos).
    </div>
  );
}
