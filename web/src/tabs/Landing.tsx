// Landing story (#inicio). Every figure is read from results.json and carries its label.
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "../components/Badge";
import { JourneyDiagram, OrderDiagram, PipelineDiagram, WeaveGrid } from "../components/Diagrams";
import { HeroWeave } from "../components/HeroWeave";
import { CountUp, Selvedge } from "../components/Motion";
import { useMotion } from "../lib/motion";
import { Reveal, SectionHead, Swatch } from "../components/Textile";
import { benchmarkView } from "../lib/benchmark";
import { compareScenarios } from "../lib/cost";
import { boundsOf, makeProjection, outerRings, pathD, thin, type LonLat } from "../lib/geo";
import { fmt, pct, signedPct } from "../lib/format";
import { t, tOr, tr, useLang } from "../lib/i18n";
import { collectionWeave, sharedOrder } from "../lib/weave";
import type { CostParams, Results } from "../types";
import { resultBadges } from "./CollectionTab";

type Go = (tab: "rede" | "cobertura" | "recolha" | "pressupostos") => void;

function Arrow() {
  return <svg className="arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;
}

function Fact({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="seam-top pt-3">
      <p className="text-xl font-semibold text-ink tabular">{value}</p>
      <p className="eyebrow mt-1 normal-case tracking-normal hyphens-auto [overflow-wrap:anywhere]">{label}</p>
    </div>
  );
}

/** Static SVG of the real network: boundary, candidate sites, existing and proposed points. */
function CityFigure({ r }: { r: Results }) {
  const { live } = useMotion();
  const m = useMemo(() => {
    const rings = outerRings(r.network.boundary).map((ring) => thin(ring, 500));
    const P = makeProjection(boundsOf(rings.flat()), 560, 460, 10);
    const proposed = new Set(r.meta.collection_network?.proposed ?? []);
    const xy = (f: { geometry: { coordinates: [number, number] } }) => P(f.geometry.coordinates as LonLat);
    return {
      rings: rings.map((ring) => pathD(ring.map(P), true)),
      existing: r.network.containers.features.map(xy),
      proposed: r.network.candidates.features.filter((f) => proposed.has(f.properties.id)).map(xy),
      others: r.network.candidates.features.filter((f) => !proposed.has(f.properties.id)).map(xy),
    };
  }, [r]);
  return (
    <svg viewBox="0 0 560 460" className="h-auto w-full" role="img"
         aria-label={t("city.aria", { e: m.existing.length, p: m.proposed.length, o: m.others.length })}>
      {m.rings.map((d, i) => <path key={i} d={d} fill="var(--surface)" stroke="var(--ink-2)" strokeOpacity=".45" strokeWidth="1.2" />)}
      {m.others.map(([x, y], i) => <circle key={`o${i}`} cx={x} cy={y} r="2.4" fill="none" stroke="var(--candidate)" strokeWidth="1.1" />)}
      {m.proposed.map(([x, y], i) => (
        <g key={`p${i}`} className="pop" style={{ ["--pop-delay" as string]: `${i * 60}ms` }}>
          <circle cx={x} cy={y} r="13" fill="var(--accent)" opacity=".12" />
          {live && <circle cx={x} cy={y} r="6" fill="none" stroke="var(--accent)" strokeWidth="1.2" className="loop ripple"
                           style={{ ["--ripple-delay" as string]: `${(i * 0.37) % 3.2}s` }} />}
          <circle cx={x} cy={y} r="4.6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.8" />
        </g>
      ))}
      {m.existing.map(([x, y], i) => <circle key={`e${i}`} cx={x} cy={y} r="5" fill="var(--ink)" stroke="var(--surface)" strokeWidth="1.8" />)}
    </svg>
  );
}

export function Landing({ r, costs, go }: { r: Results; costs: CostParams; go: Go }) {
  const profile = r.scenarios.mid ? "mid" : Object.keys(r.scenarios)[0];
  const { A, B } = r.scenarios[profile];
  const net = r.meta.collection_network;
  const cov = r.coverage;
  const nNew = net?.n_new ?? 0;
  const withNew = cov.additions.find((x) => x.n_new === nNew) ?? cov.additions[cov.additions.length - 1];
  const ids = useMemo(() => [...(net?.existing ?? []), ...(net?.proposed ?? [])], [net]);
  const weaves = useMemo(() => {
    try {
      const wa = collectionWeave(A.per_seed[0], ids), wb = collectionWeave(B.per_seed[0], ids);
      return { wa, wb, order: sharedOrder(wb) };
    } catch { return null; }
  }, [A, B, ids]);
  const cmp = useMemo(() => compareScenarios(A, B, costs), [A, B, costs]);
  const [hoverRow, setHoverRow] = useState<string | null>(null);
  const bench = r.optimisation_benchmark?.scenarios[profile]?.A;
  const bv = useMemo(() => (bench ? benchmarkView(bench.per_seed, costs) : null), [bench, costs]);
  const counts = r.assumptions.reduce<Record<string, number>>((a, x) => ({ ...a, [x.source_type]: (a[x.source_type] ?? 0) + 1 }), {});
  const means = (r.assumptions.find((a) => a.key === "fill_rate_profiles")?.value ?? {}) as Record<string, { mean: number }>;
  const synthetic = r.meta.data_source === "synthetic";
  const badges = resultBadges(r);
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start" });
  useLang(); // re-render on language change
  const profileName = tOr(`profile.${profile}`, profile);

  return (
    <div className="flex flex-col">
      {/* ------------------------------------------------ hero */}
      <section className="relative -mx-4 overflow-hidden px-4 pb-12 pt-10 sm:pt-14" aria-labelledby="hero-title">
        <div className="weave-fine pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-[var(--w-content)] items-center gap-10 lg:grid-cols-[1.02fr_1fr]">
          <div>
            <Reveal><p className="eyebrow">{t("land.eyebrow")}</p></Reveal>
            <Reveal delay={80}>
              <h1 id="hero-title" className="font-display mt-5 text-[clamp(2.9rem,6.6vw,5.6rem)] leading-[0.95] text-ink">
                {tr("land.h1", { em: (c) => <em className="text-terracotta-ink">{c}</em> })}
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-ink-2">
                {t("land.intro")}
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-8 flex flex-wrap gap-3">
              <a href="#recolha" className="btn btn-primary" onClick={(e) => { e.preventDefault(); go("recolha"); }}>
                {t("land.ctaExplore")} <Arrow />
              </a>
              <button type="button" className="btn btn-ghost" onClick={() => scrollTo("material")}>{t("land.ctaHow")}</button>
            </Reveal>
            <Reveal delay={320} className="mt-10 grid max-w-xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Fact value={<CountUp value={cov.population_total} format={(x) => fmt(x)} />} label={synthetic ? t("land.fact.residentsSyn") : t("land.fact.residents")} />
              <Fact value={<CountUp value={r.network.candidates.features.length} format={(x) => fmt(x)} />} label={t("land.fact.candidates")} />
              <Fact value={<CountUp value={r.network.containers.features.length} format={(x) => fmt(x)} />} label={synthetic ? t("land.fact.pointsSyn") : t("land.fact.points")} />
              <Fact value={`4 × ${r.meta.seeds.length}`} label={t("land.fact.weeksRuns")} />
            </Reveal>
          </div>
          <div className="relative">
            <HeroWeave r={r} />
            <div className="mt-2">
              <p className="text-end text-[11px] text-muted">
                {t("land.heroCaption", { src: synthetic ? t("land.heroSrcSyn") : "OSM · INE" })}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Selvedge items={([1, 2, 3, 4, 5, 6] as const).map((n) => t(`sel.${n}`))} />

      {/* ------------------------------------------------ 01 material */}
      <section id="material" className="mx-auto w-full max-w-[var(--w-content)] scroll-mt-28 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <SectionHead index="01" eyebrow={t("mat.eyebrow")} title={tr("mat.title")} lede={t("mat.lede")} />
          <Reveal delay={120} className="flex flex-wrap items-end gap-x-4 gap-y-6 lg:justify-end">
            {(["cotton", "linen", "denim", "knit", "recycled"] as const).map((k, i) => (
              <div key={k} style={{ transform: `rotate(${[-3, 2, -1.5, 3, -2][i]}deg)` }}><Swatch kind={k} size={i % 2 ? 80 : 92} labelled className="w-[58px] sm:w-auto" /></div>
            ))}
          </Reveal>
        </div>
        <div className="panel mt-12 p-6 sm:p-8"><JourneyDiagram /></div>
      </section>

      {/* ------------------------------------------------ 02 city */}
      <section className="weave -mx-4 border-y border-line px-4 py-16 sm:py-24">
        <div className="mx-auto grid max-w-[var(--w-content)] items-center gap-10 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <SectionHead index="02" eyebrow={t("city.eyebrow")} title={t("city.title")}
              lede={t("city.lede", { r: fmt(cov.radius_m) })} />
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Reveal><p className="font-display text-5xl text-ink tabular"><CountUp value={cov.existing.share} format={(x) => pct(x, 0)} /></p>
                <p className="mt-1 text-sm text-ink-2">{synthetic ? t("city.today") : t("city.todayOsm")}</p>
                <div className="mt-2 flex flex-wrap gap-1">{(synthetic ? ["synthetic"] : ["measured"]).map((b) => <Badge key={b} kind={b as never} />)}</div></Reveal>
              <Reveal delay={90}><p className="font-display text-5xl text-ink tabular"><CountUp value={withNew.share} format={(x) => pct(x, 0)} /></p>
                <p className="mt-1 text-sm text-ink-2">{t("city.withNew", { n: withNew.n_new })}</p>
                <div className="mt-2"><Badge kind="simulated" /></div></Reveal>
              <Reveal delay={180}><p className="font-display text-5xl text-ink tabular"><CountUp value={cov.all_candidates.share} format={(x) => pct(x, 0)} /></p>
                <p className="mt-1 text-sm text-ink-2">{t("city.ceiling")}</p>
                <div className="mt-2"><Badge kind="simulated" /></div></Reveal>
            </div>
            <a href="#cobertura" className="btn btn-ghost mt-8" onClick={(e) => { e.preventDefault(); go("cobertura"); }}>{t("city.plan")} <Arrow /></a>
          </div>
          <Reveal delay={100} className="panel p-3 sm:p-5">
            <CityFigure r={r} />
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink" />{t("city.legendExisting")}</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent" />{t("city.legendProposed", { n: withNew.n_new })}</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-[var(--candidate)]" />{t("city.legendOther")}</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ 03 strategies */}
      <section className="mx-auto w-full max-w-[var(--w-content)] py-16 sm:py-24">
        <SectionHead index="03" eyebrow={t("strat.eyebrow")} title={t("strat.title")}
          lede={tr("strat.lede", { t: fmt(r.meta.threshold_T * 100) })} />
        {weaves ? (
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <Reveal className="panel p-5"><p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><span className="h-2.5 w-2.5 rounded-full bg-series-a" />{t("common.aFixedWeekly")}</p>
              <WeaveGrid weave={weaves.wa} order={weaves.order} colour="var(--series-a)" label={t("strat.weaveA")}
                playhead highlightId={hoverRow} onRowHover={setHoverRow} /></Reveal>
            <Reveal delay={120} className="panel p-5"><p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><span className="h-2.5 w-2.5 rounded-full bg-series-b" />{t("common.bDemand")}</p>
              <WeaveGrid weave={weaves.wb} order={weaves.order} colour="var(--series-b)" label={t("strat.weaveB")}
                playhead highlightId={hoverRow} onRowHover={setHoverRow} /></Reveal>
          </div>
        ) : <p className="mt-8 text-sm text-muted">{t("strat.unavailable")}</p>}
        <p className="mt-4 text-xs text-muted">
          {t("strat.note", { profile: profileName, pct: fmt((means[profile]?.mean ?? 0) * 100),
            network: net?.n_new ? t("strat.planned", { e: net.existing.length, n: net.n_new }) : t("strat.existingOnly") })}
        </p>
      </section>

      {/* ------------------------------------------------ 04 evidence */}
      <section className="-mx-4 border-y border-line bg-surface px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-[var(--w-content)]">
          <SectionHead index="04" eyebrow={t("ev.eyebrow")} title={t("ev.title")} lede={t("ev.lede", { n: r.meta.seeds.length })} />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <Reveal className="seam-top pt-5">
              <p className="eyebrow">{t("ev.cost")}</p>
              <p className="font-display mt-2 text-5xl text-ink tabular">{cmp.savingCostPct ? <CountUp value={-cmp.savingCostPct.median} format={(x) => signedPct(x)} /> : t("common.na")}</p>
              <p className="mt-2 text-sm text-ink-2">{t("ev.costSub", cmp.savingCostPct ? { min: signedPct(-cmp.savingCostPct.max), max: signedPct(-cmp.savingCostPct.min) } : { min: t("common.na"), max: t("common.na") })}</p>
            </Reveal>
            <Reveal delay={90} className="seam-top pt-5">
              <p className="eyebrow">{t("ev.overflow")}</p>
              <p className="font-display mt-2 text-5xl text-ink tabular">{cmp.extraOverflowDaysB ? `${cmp.extraOverflowDaysB.median > 0 ? "+" : ""}${fmt(cmp.extraOverflowDaysB.median)}` : t("common.na")}</p>
              <p className="mt-2 text-sm text-ink-2">{t("ev.overflowSub")}</p>
            </Reveal>
            <Reveal delay={180} className="seam-top pt-5">
              <p className="eyebrow">{t("ev.bench")}</p>
              <p className="font-display mt-2 text-5xl text-ink tabular">{bv?.improvement.cost ? <CountUp value={-bv.improvement.cost.median} format={(x) => signedPct(x)} /> : t("common.na")}</p>
              <p className="mt-2 text-sm text-ink-2">{t("ev.benchSub", { better: bv?.better ?? 0, valid: bv?.valid ?? 0 })}</p>
            </Reveal>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">{badges.map((b) => <Badge key={b} kind={b} />)}
            <span className="text-xs text-muted">{t(synthetic ? "ev.noteSynthetic" : "ev.notePublic", { profile: profileName })}</span>
          </div>
          <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1fr_1.2fr]">
            <p className="max-w-[52ch] text-ink-2">{t("ev.benchText")}</p>
            <Reveal className="panel p-5"><OrderDiagram /></Reveal>
          </div>
          <a href="#recolha" className="btn btn-primary mt-10" onClick={(e) => { e.preventDefault(); go("recolha"); }}>{t("ev.compare")} <Arrow /></a>
        </div>
      </section>

      {/* ------------------------------------------------ 05 transparency */}
      <section className="mx-auto w-full max-w-[var(--w-content)] py-16 sm:py-24">
        <SectionHead index="05" eyebrow={t("tr.eyebrow")} title={t("tr.title")}
          lede={tr("tr.lede", { n: r.assumptions.length, a: counts.assumption ?? 0,
            rest: (counts.public ? t("tr.public", { n: counts.public }) : "") + (counts.sponsor ? t("tr.sponsor", { n: counts.sponsor }) : "") })} />
        <div className="panel mt-10 p-6 sm:p-8"><PipelineDiagram /></div>
        <div className="mt-8 grid gap-6 md:grid-cols-[1.2fr_1fr]">
          <Reveal className="flex flex-wrap gap-2">
            {(["measured", "simulated", "assumption", "public", "synthetic", "straight-line", "approx"] as const).map((b) => <Badge key={b} kind={b} />)}
            <p className="w-full text-sm text-ink-2">{t("tr.hover")}</p>
          </Reveal>
          <Reveal delay={100} className="seam rounded-[var(--r-md)] p-5 text-sm text-ink-2">
            <p className="font-medium text-ink">{t("tr.vitrusTitle")}</p>
            <p className="mt-1">{tr("tr.vitrusBody", { code: (c) => <span className="mono text-[12.5px]">{c}</span> })}</p>
          </Reveal>
        </div>
        <a href="#pressupostos" className="btn btn-ghost mt-8" onClick={(e) => { e.preventDefault(); go("pressupostos"); }}>{t("tr.inspect")} <Arrow /></a>
      </section>

      {/* ------------------------------------------------ 06 next step */}
      <section className="weave -mx-4 border-t border-line px-4 py-16 sm:py-20">
        <div className="mx-auto flex max-w-[var(--w-content)] flex-col items-start gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHead index="06" eyebrow={t("next.eyebrow")} title={t("next.title")} size="md" lede={t("next.lede")} />
          <nav aria-label={t("next.nav")} className="flex flex-wrap gap-2">
            {([["rede", "01"], ["cobertura", "02"], ["recolha", "03"], ["pressupostos", "04"]] as const).map(([id, n]) => (
              <a key={id} href={`#${id}`} className="btn btn-ghost bg-surface" onClick={(e) => { e.preventDefault(); go(id); }}>{n} {t(`tab.${id}`)}</a>
            ))}
          </nav>
        </div>
      </section>
    </div>
  );
}
