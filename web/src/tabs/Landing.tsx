// Landing story (#inicio). Every figure is read from results.json and carries its label.
import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "../components/Badge";
import { JourneyDiagram, OrderDiagram, PipelineDiagram, WeaveGrid } from "../components/Diagrams";
import { HeroWeave } from "../components/HeroWeave";
import { CountUp, MotionToggle, Selvedge } from "../components/Motion";
import { useMotion } from "../lib/motion";
import { Reveal, SectionHead, Swatch } from "../components/Textile";
import { benchmarkView } from "../lib/benchmark";
import { compareScenarios } from "../lib/cost";
import { boundsOf, makeProjection, outerRings, pathD, thin, type LonLat } from "../lib/geo";
import { fmt, pct, signedPct } from "../lib/format";
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
      <p className="eyebrow mt-1 normal-case tracking-normal">{label}</p>
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
         aria-label={`Map of the municipality with ${m.existing.length} existing textile points, ${m.proposed.length} proposed sites and ${m.others.length} other candidate sites.`}>
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

  return (
    <div className="flex flex-col">
      {/* ------------------------------------------------ hero */}
      <section className="relative -mx-4 overflow-hidden px-4 pb-12 pt-10 sm:pt-14" aria-labelledby="hero-title">
        <div className="weave-fine pointer-events-none absolute inset-0 opacity-70 [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-[var(--w-content)] items-center gap-10 lg:grid-cols-[1.02fr_1fr]">
          <div>
            <Reveal><p className="eyebrow">Textile collection planning · Guimarães, Portugal</p></Reveal>
            <Reveal delay={80}>
              <h1 id="hero-title" className="font-display mt-5 text-[clamp(2.9rem,6.6vw,5.6rem)] leading-[0.95] text-ink">
                Give every thread a <em className="text-terracotta-ink">better route</em>.
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-6 max-w-[54ch] text-[17px] leading-relaxed text-ink-2">
                Retalho plans where textile drop-off points should be across Guimarães and how to collect them. It compares
                fixed weekly rounds with demand-based collection over four weeks, and shows every assumption behind the numbers.
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-8 flex flex-wrap gap-3">
              <a href="#recolha" className="btn btn-primary" onClick={(e) => { e.preventDefault(); go("recolha"); }}>
                Explore collection planning <Arrow />
              </a>
              <button type="button" className="btn btn-ghost" onClick={() => scrollTo("material")}>See how it works</button>
            </Reveal>
            <Reveal delay={320} className="mt-10 grid max-w-xl grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <Fact value={<CountUp value={cov.population_total} format={(x) => fmt(x)} />} label={synthetic ? "residents (synthetic)" : "residents · INE 2021"} />
              <Fact value={<CountUp value={r.network.candidates.features.length} format={(x) => fmt(x)} />} label="candidate sites" />
              <Fact value={<CountUp value={r.network.containers.features.length} format={(x) => fmt(x)} />} label={synthetic ? "textile points (synthetic)" : "mapped textile points"} />
              <Fact value={`4 × ${r.meta.seeds.length}`} label="weeks × simulated runs" />
            </Reveal>
          </div>
          <div className="relative">
            <HeroWeave r={r} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <MotionToggle />
              <p className="text-right text-[11px] text-muted">
                Real boundary, points and one simulated route ({synthetic ? "synthetic data" : "OSM · INE"}). The moving dot follows that route.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Selvedge items={["Drop-off points", "Collection routes", "Four-week plans", "Coverage", "Operating costs", "Assumptions, visible"]} />

      {/* ------------------------------------------------ 01 material */}
      <section id="material" className="mx-auto w-full max-w-[var(--w-content)] scroll-mt-28 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <SectionHead index="01" eyebrow="The material" title={<>A <em>retalho</em> is a fabric remnant. Remnants still have somewhere to go.</>}
            lede={<>Discarded textiles are material that can be collected and redirected, if the collection network reaches people
              and runs efficiently. Retalho is a planning tool for that network: where textile points should be, and how often and in
              what order they should be emptied.</>} />
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
            <SectionHead index="02" eyebrow="The city" title="Points across the municipality, judged by who can reach them."
              lede={<>A resident counts as covered within {fmt(cov.radius_m)} m, straight line, of a textile point. The optimiser
                adds the sites that cover the most residents while keeping every existing point.</>} />
            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
              <Reveal><p className="font-display text-5xl text-ink tabular"><CountUp value={cov.existing.share} format={(x) => pct(x, 0)} /></p>
                <p className="mt-1 text-sm text-ink-2">today{synthetic ? "" : ", OSM-mapped points only"}</p>
                <div className="mt-2 flex flex-wrap gap-1">{(synthetic ? ["synthetic"] : ["measured"]).map((b) => <Badge key={b} kind={b as never} />)}</div></Reveal>
              <Reveal delay={90}><p className="font-display text-5xl text-ink tabular"><CountUp value={withNew.share} format={(x) => pct(x, 0)} /></p>
                <p className="mt-1 text-sm text-ink-2">with +{withNew.n_new} proposed sites</p>
                <div className="mt-2"><Badge kind="simulated" /></div></Reveal>
              <Reveal delay={180}><p className="font-display text-5xl text-ink tabular"><CountUp value={cov.all_candidates.share} format={(x) => pct(x, 0)} /></p>
                <p className="mt-1 text-sm text-ink-2">ceiling, every candidate</p>
                <div className="mt-2"><Badge kind="simulated" /></div></Reveal>
            </div>
            <a href="#cobertura" className="btn btn-ghost mt-8" onClick={(e) => { e.preventDefault(); go("cobertura"); }}>Plan new points <Arrow /></a>
          </div>
          <Reveal delay={100} className="panel p-3 sm:p-5">
            <CityFigure r={r} />
            <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-ink" />Existing textile point</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-accent" />Proposed (+{withNew.n_new})</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border border-[var(--candidate)]" />Other candidate site</li>
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------ 03 strategies */}
      <section className="mx-auto w-full max-w-[var(--w-content)] py-16 sm:py-24">
        <SectionHead index="03" eyebrow="The strategies" title="Two ways to collect, drawn as cloth."
          lede={<>Each row is a container, each column a week; a filled thread is a collection. <b className="text-ink">A</b> empties
            every container every week. <b className="text-ink">B</b> empties a container only when its projected fill would reach{" "}
            {fmt(r.meta.threshold_T * 100)}% before the next run. Both are routed by the same optimiser on the same roads.</>} />
        {weaves ? (
          <div className="mt-10 grid gap-8 md:grid-cols-2">
            <Reveal className="panel p-5"><p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><span className="h-2.5 w-2.5 rounded-full bg-series-a" />A · fixed weekly</p>
              <WeaveGrid weave={weaves.wa} order={weaves.order} colour="var(--series-a)" label="Scenario A, every container every week"
                playhead highlightId={hoverRow} onRowHover={setHoverRow} /></Reveal>
            <Reveal delay={120} className="panel p-5"><p className="mb-3 flex items-center gap-2 text-sm font-medium text-ink"><span className="h-2.5 w-2.5 rounded-full bg-series-b" />B · demand-based</p>
              <WeaveGrid weave={weaves.wb} order={weaves.order} colour="var(--series-b)" label="Scenario B, only when needed"
                playhead highlightId={hoverRow} onRowHover={setHoverRow} /></Reveal>
          </div>
        ) : <p className="mt-8 text-sm text-muted">The collection pattern is unavailable for this dataset.</p>}
        <p className="mt-4 text-xs text-muted">
          Hover a row to follow one container in both strategies. One simulated run (run 1, {profile} fill ≈ {fmt((means[profile]?.mean ?? 0) * 100)}% per week), on {net?.n_new ? `the planned network: ${net.existing.length} existing + ${net.n_new} proposed points` : "the existing points"}. Fill rates are assumptions.
        </p>
      </section>

      {/* ------------------------------------------------ 04 evidence */}
      <section className="-mx-4 border-y border-line bg-surface px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-[var(--w-content)]">
          <SectionHead index="04" eyebrow="The evidence" title="Measured the same way for both strategies."
            lede={<>Four weeks, {r.meta.seeds.length} runs with different random fill, identical inputs for A and B. Distance is road distance;
              costs combine km, crew hours and truck-days at the assumed rates, recomputed live when you change them.</>} />
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            <Reveal className="seam-top pt-5">
              <p className="eyebrow">B vs A · operating cost</p>
              <p className="font-display mt-2 text-5xl text-ink tabular">{cmp.savingCostPct ? <CountUp value={-cmp.savingCostPct.median} format={(x) => signedPct(x)} /> : "n/a"}</p>
              <p className="mt-2 text-sm text-ink-2">median, range {cmp.savingCostPct ? `${signedPct(-cmp.savingCostPct.max)} to ${signedPct(-cmp.savingCostPct.min)}` : "n/a"}; negative means B is cheaper</p>
            </Reveal>
            <Reveal delay={90} className="seam-top pt-5">
              <p className="eyebrow">B vs A · overflow</p>
              <p className="font-display mt-2 text-5xl text-ink tabular">{cmp.extraOverflowDaysB ? `${cmp.extraOverflowDaysB.median > 0 ? "+" : ""}${fmt(cmp.extraOverflowDaysB.median)}` : "n/a"}</p>
              <p className="mt-2 text-sm text-ink-2">container-days over four weeks, median. A cheaper strategy does not count as better if it overflows more.</p>
            </Reveal>
            <Reveal delay={180} className="seam-top pt-5">
              <p className="eyebrow">Routing vs nearest-stop</p>
              <p className="font-display mt-2 text-5xl text-ink tabular">{bv?.improvement.cost ? <CountUp value={-bv.improvement.cost.median} format={(x) => signedPct(x)} /> : "n/a"}</p>
              <p className="mt-2 text-sm text-ink-2">operating cost of optimised routes (Scenario A), median; lower in {bv?.better ?? 0} of {bv?.valid ?? 0} runs</p>
            </Reveal>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">{badges.map((b) => <Badge key={b} kind={b} />)}
            <span className="text-xs text-muted">Simulation on {synthetic ? "synthetic" : "public"} data with assumed fill rates and costs, {profile} fill profile. Not measured VITRUS operations.</span>
          </div>
          <div className="mt-12 grid items-center gap-8 lg:grid-cols-[1fr_1.2fr]">
            <p className="max-w-[52ch] text-ink-2">The benchmark replays the same four weeks with a simple nearest-stop router. Same containers emptied,
              same kilograms, trucks, shifts and cost rates; only the visiting order and the split into truck-days differ. It is a
              baseline, not the best possible alternative.</p>
            <Reveal className="panel p-5"><OrderDiagram /></Reveal>
          </div>
          <a href="#recolha" className="btn btn-primary mt-10" onClick={(e) => { e.preventDefault(); go("recolha"); }}>Compare the strategies <Arrow /></a>
        </div>
      </section>

      {/* ------------------------------------------------ 05 transparency */}
      <section className="mx-auto w-full max-w-[var(--w-content)] py-16 sm:py-24">
        <SectionHead index="05" eyebrow="The transparency" title="Every number shows where it came from."
          lede={<>Inputs are labelled by source, results by how they were produced. Of {r.assumptions.length} model parameters,{" "}
            <b className="text-ink">{counts.assumption ?? 0} are still assumptions</b> awaiting confirmed values{counts.public ? `, ${counts.public} are calibrated from public data` : ""}{counts.sponsor ? `, ${counts.sponsor} come from VITRUS` : ""}.</>} />
        <div className="panel mt-10 p-6 sm:p-8"><PipelineDiagram /></div>
        <div className="mt-8 grid gap-6 md:grid-cols-[1.2fr_1fr]">
          <Reveal className="flex flex-wrap gap-2">
            {(["measured", "simulated", "assumption", "public", "synthetic", "straight-line", "approx"] as const).map((b) => <Badge key={b} kind={b} />)}
            <p className="w-full text-sm text-ink-2">Hover any badge in the planner for its meaning.</p>
          </Reveal>
          <Reveal delay={100} className="seam rounded-[var(--r-md)] p-5 text-sm text-ink-2">
            <p className="font-medium text-ink">VITRUS data has not been supplied yet.</p>
            <p className="mt-1">Container locations, the depot, fill rates and costs are public estimates, synthetic or assumed. The intake
              procedure in <span className="mono text-[12.5px]">docs/VITRUS_DATA.md</span> replaces them without changing the method.</p>
          </Reveal>
        </div>
        <a href="#pressupostos" className="btn btn-ghost mt-8" onClick={(e) => { e.preventDefault(); go("pressupostos"); }}>Inspect the assumptions <Arrow /></a>
      </section>

      {/* ------------------------------------------------ 06 next step */}
      <section className="weave -mx-4 border-t border-line px-4 py-16 sm:py-20">
        <div className="mx-auto flex max-w-[var(--w-content)] flex-col items-start gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHead index="06" eyebrow="The next step" title="Open the planner." size="md"
            lede="Four views, one dataset: the network, coverage, collection and the assumptions behind them." />
          <nav aria-label="Open a planner section" className="flex flex-wrap gap-2">
            {([["rede", "01 Rede · Network"], ["cobertura", "02 Cobertura · Coverage"], ["recolha", "03 Recolha · Collection"], ["pressupostos", "04 Pressupostos · Assumptions"]] as const).map(([t, l]) => (
              <a key={t} href={`#${t}`} className="btn btn-ghost bg-surface" onClick={(e) => { e.preventDefault(); go(t); }}>{l}</a>
            ))}
          </nav>
        </div>
      </section>
    </div>
  );
}
