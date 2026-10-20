import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Badge } from "./components/Badge";
import { LogoMark, Wordmark } from "./components/Brand";
import { AssumptionsTab } from "./tabs/AssumptionsTab";
import { CollectionTab } from "./tabs/CollectionTab";
import { CoverageTab } from "./tabs/CoverageTab";
import { Landing } from "./tabs/Landing";
import { fmtDate } from "./lib/format";
import { applyLang, getLang, LANGS, LangContext, plural, t, td, tOr, tr, useLang, type Lang } from "./lib/i18n";
import { NetworkTab } from "./tabs/NetworkTab";
import type { CostParams, DatasetIndex, Results } from "./types";

// URL fragments are the routes; existing tab fragments are unchanged, #inicio is the landing story.
// Names, titles and ledes are in the dictionaries under tab.<id>, tab.<id>.title and tab.<id>.lede.
const TABS = [
  { id: "rede", n: "01" }, { id: "cobertura", n: "02" }, { id: "recolha", n: "03" }, { id: "pressupostos", n: "04" },
] as const;
type TabId = "inicio" | (typeof TABS)[number]["id"];
const isTab = (h: string): h is TabId => h === "inicio" || TABS.some((t) => t.id === h);

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; results: Results };

async function getJson<T>(file: string): Promise<T> {
  // The single-file offline build embeds every data file (scripts/offline.mjs).
  const embedded = (window as unknown as { __RETALHO_DATA__?: Record<string, unknown> }).__RETALHO_DATA__;
  if (embedded) {
    if (file in embedded) return embedded[file] as T;
    throw new Error(t("err.notEmbedded", { file }));
  }
  const res = await fetch(`./${file}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(t("err.http", { file, status: res.status }));
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
        if (!results?.meta || !results?.scenarios) throw new Error(t("err.notRetalho", { file }));
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
  const [lang, setLangState] = useState<Lang>(getLang);
  const setLang = (l: Lang) => { applyLang(l, true); setLangState(l); };

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
    <LangContext.Provider value={{ lang, setLang }}>
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[1300] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        {t("app.skip")}
      </a>
      <header className={`sticky top-0 z-[var(--z-header)] border-b transition-[background-color,border-color,box-shadow] duration-[var(--dur-2)] ${
        scrolled ? "border-line bg-[color-mix(in_srgb,var(--page)_88%,transparent)] shadow-[var(--shadow-1)] backdrop-blur" : "border-transparent bg-page"}`}>
        <div className="mx-auto flex max-w-[var(--w-content)] items-center gap-4 px-4 py-3">
          <a href="#inicio" onClick={(e) => { e.preventDefault(); go("inicio"); }} aria-label={t("app.home")} className="shrink-0">
            <Wordmark size={22} />
          </a>
          <nav aria-label={t("app.nav")} className="-mx-1 hidden flex-1 items-center justify-center gap-1 md:flex">
            <NavLinks tab={tab} go={go} />
          </nav>
          <div className="ms-auto flex items-center gap-2">
            {index && index.datasets.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <span className="eyebrow hidden xl:inline">{t("app.data")}</span>
                <select value={active?.source} onChange={(e) => setSource(e.target.value)} aria-label={t("app.dataset")}
                        className="h-9 max-w-[8rem] rounded-[var(--r-pill)] border border-line-strong bg-surface px-3 text-[13px] text-ink transition-colors duration-[var(--dur-1)] hover:border-ink sm:max-w-none">
                  {index.datasets.map((d) => <option key={d.source} value={d.source} title={td(d.label)}>{tOr(`dataset.${d.source}`, td(d.label))}</option>)}
                </select>
              </label>
            )}
            <LanguageSelect />
          </div>
        </div>
        <nav aria-label={t("app.navCompact")} className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          <NavLinks tab={tab} go={go} />
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-[var(--w-content)] px-4 pb-10">
        {load.state === "loading" && <Loading />}
        {load.state === "error" && (
          <div role="alert" className="panel mx-auto mt-16 max-w-xl p-6">
            <p className="eyebrow text-critical">{t("err.title")}</p>
            <p className="mt-2 text-ink">{load.message}</p>
            <p className="mt-2 text-sm text-ink-2">{tr("err.howto")}</p>
          </div>
        )}
        {load.state === "ready" && (
          <Dashboard key={load.results.meta.data_source} r={load.results} tab={tab} go={go} current={current} />
        )}
      </main>
      {load.state === "ready" && <Footer r={load.results} />}
    </div>
    </LangContext.Provider>
  );
}

/** Interface language, by native name. Choosing one remembers it in this browser. */
function LanguageSelect() {
  const { lang, setLang } = useLang();
  return (
    <label className="relative flex items-center">
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden className="pointer-events-none absolute start-2.5 text-ink-2">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M1.5 8h13M8 1.5c-2.2 2.4-2.2 10.6 0 13M8 1.5c2.2 2.4 2.2 10.6 0 13" fill="none" stroke="currentColor" strokeWidth="1.1" />
      </svg>
      {/* On phones the closed control shows only the language code; the list still shows native names. */}
      <span aria-hidden className="mono pointer-events-none absolute start-8 text-[12px] uppercase text-ink sm:hidden">{lang}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("app.language")}
              className="h-9 w-[4.5rem] rounded-[var(--r-pill)] border border-line-strong bg-surface ps-8 pe-1 text-[13px] text-transparent transition-colors duration-[var(--dur-1)] hover:border-ink sm:w-auto sm:max-w-[8.5rem] sm:pe-2 sm:text-ink">
        {LANGS.map((l) => <option key={l.code} value={l.code} lang={l.code} className="text-ink">{l.name}</option>)}
      </select>
    </label>
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
      {TABS.map((x) => {
        const on = tab === x.id;
        return (
          <a key={x.id} href={`#${x.id}`} aria-current={on ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(x.id); }}
             className={`relative z-10 whitespace-nowrap rounded-[var(--r-pill)] px-3 py-1.5 text-[13.5px] transition-colors duration-[var(--dur-2)] ${
               on ? `text-page ${pill ? "" : "bg-ink"}` : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}>
            <span className={`mono me-1.5 text-[10.5px] ${on ? "opacity-70" : "text-muted"}`}>{x.n}</span>{t(`tab.${x.id}`)}
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
      <p className="eyebrow mt-4">{t("app.loading")}</p>
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
            <p className="eyebrow"><span className="text-terracotta-ink">{current.n}</span> · {t(`tab.${current.id}`)}</p>
            <h1 className="font-display mt-2 text-[clamp(1.9rem,3.4vw,2.8rem)] leading-[1.05] text-ink">{t(`tab.${current.id}.title`)}</h1>
            <p className="mt-2 max-w-[70ch] text-ink-2">{t(`tab.${current.id}.lede`)}</p>
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
          {tr("prov.approx", { b: (c) => <b>{c}</b>, label: td(r.meta.distance_label) })}
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
        {icon}<p>{tr("prov.synthetic", { b: (c) => <b>{c}</b> })}</p>
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
        <b className="text-ink">{r.meta.data_source === "public" ? t("prov.public") : t("prov.vitrus")}</b>{" "}
        {r.meta.data_sources.filter((d) => d.source_type !== "synthetic").map((d) => td(d.name)).join("; ")}.
        {osm && <> {t(plural("prov.osm", containers.length), { n: containers.length })}</>}
        {assumedDepot && <> {t("prov.depot")}</>}
        {net && net.n_new > 0 && <> {t("prov.network", { n: net.n_new })}</>}
        {" "}{t("prov.assumptions")}
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
          <p className="mt-3 max-w-[40ch]">{t("footer.about")}</p>
        </div>
        <div>
          <p className="eyebrow">{t("footer.results")}</p>
          <p className="mono mt-2 text-[12.5px] leading-6 text-ink-2">
            {t("footer.generated", { date: fmtDate(r.meta.generated_at) })}<br />
            <span dir="ltr">{t("footer.commit", { commit: r.meta.git_commit })}</span><br />
            {t("footer.runs", { runs: r.meta.seeds.length, weeks: r.meta.horizon_weeks, source: tOr(`source.${r.meta.data_source}`, r.meta.data_source) })}
          </p>
        </div>
        <div>
          <p className="eyebrow">{t("footer.data")}</p>
          <p className="mt-2">{tr("footer.credits", {
            link: (c) => <a className="link-underline text-ink" href="https://github.com/bhavya-jpg/retalho" target="_blank" rel="noreferrer">{c}</a> })}</p>
        </div>
      </div>
    </footer>
  );
}
