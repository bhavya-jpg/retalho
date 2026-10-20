import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "./components/Badge";
import { LogoMark, Wordmark } from "./components/Brand";
import { MotionToggle } from "./components/Motion";
import { AssumptionsTab } from "./tabs/AssumptionsTab";
import { CollectionTab } from "./tabs/CollectionTab";
import { CoverageTab } from "./tabs/CoverageTab";
import { Landing } from "./tabs/Landing";
import { NetworkTab } from "./tabs/NetworkTab";
import type { CostParams, DatasetIndex, Results } from "./types";

// URL fragments are the routes; existing tab fragments are unchanged, #inicio is the landing story.
const TABS = [
  { id: "rede", n: "01", pt: "Rede", en: "Network", title: "The collection network",
    lede: "Existing textile points, candidate sites and the depot, with today's coverage and the checks on every distance." },
  { id: "cobertura", n: "02", pt: "Cobertura", en: "Coverage", title: "Where new points should go",
    lede: "Add points one at a time and see who they reach. Existing points are always kept." },
  { id: "recolha", n: "03", pt: "Recolha", en: "Collection", title: "Fixed rounds or collection on demand",
    lede: "Four simulated weeks of both strategies on identical inputs, the routes they drive, and what route optimisation adds." },
  { id: "pressupostos", n: "04", pt: "Pressupostos", en: "Assumptions", title: "The assumptions behind every number",
    lede: "Change the cost rates and every euro figure updates. Each parameter shows its unit, its source and a note." },
] as const;
type TabId = "inicio" | (typeof TABS)[number]["id"];
const SHORT_LABEL: Record<string, string> = { public: "Public · OSM + INE", synthetic: "Synthetic demo", vitrus: "VITRUS data" };
const isTab = (h: string): h is TabId => h === "inicio" || TABS.some((t) => t.id === h);

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

const hashTab = (): TabId => { const h = window.location.hash.slice(1); return isTab(h) ? h : "inicio"; };

export default function App() {
  const index = useDatasets();
  const [source, setSource] = useState<string | null>(null);
  const active = index?.datasets.find((d) => d.source === (source ?? index.default));
  const file = index === undefined ? null : active ? active.file : "results.json";
  const load = useResults(file);
  const [tab, setTab] = useState<TabId>(hashTab);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => { history.replaceState(null, "", `#${tab}`); }, [tab]);
  useEffect(() => {
    const onHash = () => setTab(hashTab());
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("hashchange", onHash); window.removeEventListener("scroll", onScroll); };
  }, []);
  const go = (t: TabId) => {
    setTab(t);
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };
  const current = TABS.find((t) => t.id === tab);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[1300] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className={`sticky top-0 z-[var(--z-header)] border-b transition-[background-color,border-color,box-shadow] duration-[var(--dur-2)] ${
        scrolled ? "border-line bg-[color-mix(in_srgb,var(--page)_88%,transparent)] shadow-[var(--shadow-1)] backdrop-blur" : "border-transparent bg-page"}`}>
        <div className="mx-auto flex max-w-[var(--w-content)] items-center gap-4 px-4 py-3">
          <a href="#inicio" onClick={(e) => { e.preventDefault(); go("inicio"); }} aria-label="Retalho, home" className="shrink-0">
            <Wordmark size={22} />
          </a>
          <nav aria-label="Planner sections" className="-mx-1 hidden flex-1 items-center justify-center gap-1 md:flex">
            <NavLinks tab={tab} go={go} />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {index && index.datasets.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <span className="eyebrow hidden lg:inline">Data</span>
                <select value={active?.source} onChange={(e) => setSource(e.target.value)} aria-label="Dataset"
                        className="h-9 max-w-[11rem] rounded-[var(--r-pill)] border border-line-strong bg-surface px-3 text-[13px] text-ink transition-colors duration-[var(--dur-1)] hover:border-ink sm:max-w-none">
                  {index.datasets.map((d) => <option key={d.source} value={d.source} title={d.label}>{SHORT_LABEL[d.source] ?? d.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
        <nav aria-label="Planner sections (compact)" className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          <NavLinks tab={tab} go={go} />
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-[var(--w-content)] px-4 pb-10">
        {load.state === "loading" && <Loading />}
        {load.state === "error" && (
          <div role="alert" className="panel mx-auto mt-16 max-w-xl p-6">
            <p className="eyebrow text-critical">Results unavailable</p>
            <p className="mt-2 text-ink">{load.message}</p>
            <p className="mt-2 text-sm text-ink-2">
              Generate them with <code className="mono rounded bg-surface-2 px-1">make all</code>, which writes{" "}
              <code className="mono rounded bg-surface-2 px-1">web/public/results.json</code>, then reload.
            </p>
          </div>
        )}
        {load.state === "ready" && (
          <Dashboard key={load.results.meta.data_source} r={load.results} tab={tab} go={go} current={current} />
        )}
      </main>
      {load.state === "ready" && <Footer r={load.results} />}
    </div>
  );
}

function NavLinks({ tab, go }: { tab: TabId; go: (t: TabId) => void }) {
  // One ink pill slides to the active link (falls back to a per-link background before it is measured).
  const wrap = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLElement>('[aria-current="page"]');
      setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [tab]);
  return (
    <div ref={wrap} className="relative flex items-center gap-1">
      {pill && (
        <span aria-hidden className="absolute inset-y-0 rounded-[var(--r-pill)] bg-ink transition-[left,width] duration-[var(--dur-2)] ease-[var(--ease-out)]"
              style={{ left: pill.left, width: pill.width }} />
      )}
      {TABS.map((t) => {
        const on = tab === t.id;
        return (
          <a key={t.id} href={`#${t.id}`} aria-current={on ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(t.id); }}
             className={`relative z-10 whitespace-nowrap rounded-[var(--r-pill)] px-3 py-1.5 text-[13.5px] transition-colors duration-[var(--dur-2)] ${
               on ? `text-page ${pill ? "" : "bg-ink"}` : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
            <span className={`mono mr-1.5 text-[10.5px] ${on ? "opacity-70" : "text-muted"}`}>{t.n}</span>{t.pt}
            <span className={`ml-1 hidden lg:inline ${on ? "opacity-70" : "text-muted"}`}>· {t.en}</span>
          </a>
        );
      })}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid place-items-center py-32" role="status" aria-live="polite">
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        {[16, 28, 40, 52].map((x) => <line key={x} x1={x} y1="8" x2={x} y2="56" stroke="var(--flax)" strokeWidth="4" strokeLinecap="round" />)}
        <path d="M6 32 H58" stroke="var(--terracotta)" strokeWidth="4" strokeLinecap="round" pathLength={1}
              style={{ strokeDasharray: 1, animation: "retalho-weft 1.2s var(--ease-in-out) infinite alternate" }} />
      </svg>
      <p className="eyebrow mt-4">Loading results</p>
      <style>{"@keyframes retalho-weft { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }"}</style>
    </div>
  );
}

function Dashboard({ r, tab, go, current }: { r: Results; tab: TabId; go: (t: TabId) => void; current?: (typeof TABS)[number] }) {
  const defaults = useMemo<CostParams>(() => {
    const v = (k: string) => Number(r.assumptions.find((a) => a.key === k)?.value ?? 0);
    return { cost_per_km: v("cost_per_km"), crew_cost_per_h: v("crew_cost_per_h"), fixed_cost_per_truck_day: v("fixed_cost_per_truck_day") };
  }, [r]);
  const [costs, setCosts] = useState(defaults);
  const profiles = Object.keys(r.scenarios);
  const [profile, setProfile] = useState(profiles.includes("mid") ? "mid" : profiles[0]);

  if (tab === "inicio") return <div key="inicio" className="tab-enter"><Landing r={r} costs={costs} go={go} /></div>;
  return (
    <div key={tab} className="tab-enter flex flex-col gap-5 pt-8">
      {current && (
        <div className="grid gap-4 border-b border-line pb-6 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="eyebrow"><span className="text-terracotta-ink">{current.n}</span> · {current.pt} · {current.en}</p>
            <h1 className="font-display mt-2 text-[clamp(1.9rem,3.4vw,2.8rem)] leading-[1.05] text-ink">{current.title}</h1>
            <p className="mt-2 max-w-[70ch] text-ink-2">{current.lede}</p>
          </div>
          <div className="flex flex-wrap gap-1.5 md:justify-end">
            {r.meta.data_source === "synthetic" && <Badge kind="synthetic" />}
            {r.meta.distance_provider === "approx" ? <Badge kind="approx" /> : <Badge kind="public" />}
          </div>
        </div>
      )}
      <ProvenanceBanner r={r} />
      {r.meta.distance_provider === "approx" && (
        <div className="rounded-[var(--r-md)] bg-warn-bg px-4 py-3 text-sm text-warn-ink">
          <b>Approximate distances.</b> {r.meta.distance_label}. Road distances were not available when these results were built.
        </div>
      )}
      {tab === "rede" && <NetworkTab r={r} />}
      {tab === "cobertura" && <CoverageTab r={r} />}
      {tab === "recolha" && <CollectionTab r={r} profile={profile} setProfile={setProfile} costs={costs} />}
      {tab === "pressupostos" && (
        <AssumptionsTab r={r} costs={costs} setCosts={setCosts} defaults={defaults} profile={profile} setProfile={setProfile} />
      )}
    </div>
  );
}

/** Says exactly which inputs are real, which are assumed, and what that means for the figures. */
function ProvenanceBanner({ r }: { r: Results }) {
  const icon = (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className="mt-0.5 shrink-0">
      <circle cx="9" cy="9" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 8v5M9 5.2v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
  if (r.meta.data_source === "synthetic") {
    return (
      <div className="flex gap-3 rounded-[var(--r-md)] bg-warn-bg px-4 py-3 text-sm text-warn-ink" role="note">
        {icon}<p><b>Synthetic data.</b> Container locations, population, depot and boundary are generated, not VITRUS or official
        data. Every result shown is simulated on them and illustrates the method only.</p>
      </div>
    );
  }
  const containers = r.network.containers.features;
  const osm = containers.some((f) => f.properties.source_type === "public");
  const assumedDepot = r.network.depot.source_type === "synthetic";
  const net = r.meta.collection_network;
  return (
    <div className="seam flex gap-3 rounded-[var(--r-md)] bg-surface px-4 py-3 text-sm text-ink-2" role="note">
      <span className="text-accent-text">{icon}</span>
      <p>
        <b className="text-ink">{r.meta.data_source === "public" ? "Public data." : "VITRUS data."}</b>{" "}
        {r.meta.data_sources.filter((d) => d.source_type !== "synthetic").map((d) => d.name).join("; ")}.
        {osm && <> OpenStreetMap lists only {containers.length} textile container{containers.length === 1 ? "" : "s"} in the
          municipality, likely fewer than are in use; VITRUS&apos;s own list would replace them.</>}
        {assumedDepot && <> The depot location is assumed.</>}
        {net && net.n_new > 0 && <> Collection is simulated on the planned network: existing points plus the {net.n_new} sites
          proposed on the Coverage tab.</>}
        {" "}Fill rates, fleet and costs are assumptions (see Pressupostos).
      </p>
    </div>
  );
}

function Footer({ r }: { r: Results }) {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[var(--w-content)] gap-6 px-4 py-10 text-sm text-ink-2 md:grid-cols-[1.2fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5"><LogoMark size={26} /><span className="font-display text-xl text-ink">Retalho</span></div>
          <p className="mt-3 max-w-[40ch]">Textile collection planning for Guimarães: where drop-off points should be, how to collect them, and every assumption behind the numbers.</p>
        </div>
        <div>
          <p className="eyebrow">These results</p>
          <p className="mono mt-2 text-[12.5px] leading-6 text-ink-2">
            generated {new Date(r.meta.generated_at).toLocaleString("en-GB")}<br />
            source commit {r.meta.git_commit}<br />
            {r.meta.seeds.length} runs × {r.meta.horizon_weeks} weeks · {r.meta.data_source} data
          </p>
          <MotionToggle className="mt-4" />
        </div>
        <div>
          <p className="eyebrow">Data</p>
          <p className="mt-2">Map and road data © OpenStreetMap contributors (ODbL). Population and boundary: INE, Censos 2021.{" "}
            <a className="link-underline text-ink" href="https://github.com/bhavya-jpg/retalho" target="_blank" rel="noreferrer">Source on GitHub</a>.</p>
        </div>
      </div>
    </footer>
  );
}
