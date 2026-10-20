// Full QA pass: drives the real UI in headless Chrome and compares what is displayed with values
// recomputed independently from the results JSON. Fails on any console error, page exception,
// failed request or HTTP >= 400.
// Usage: npm run qa -- <base-url-ending-in-/>   e.g. https://bhavya-jpg.github.io/retalho/
// CHROME=/path/to/chrome overrides the browser.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const base = process.argv[2] ?? process.env.BASE ?? "http://localhost:4173/";
const port = 9600 + Math.floor(Math.random() * 300);
const ciFlags = process.env.CI ? ["--no-sandbox", "--disable-dev-shm-usage"] : [];
const chrome = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`,
  "--window-size=1440,1000", ...ciFlags, `--user-data-dir=${join(tmpdir(), `retalho-qa-${Date.now()}`)}`, "about:blank"]);
chrome.on("error", (e) => { console.error(`Could not start Chrome (${e.message}); set CHROME=/path/to/chrome`); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let ws;
for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
await new Promise((r) => (ws.onopen = r)); let id = 1; const pending = new Map();
const errors = [], failed = [], bad = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.method === "Runtime.exceptionThrown") errors.push("exception: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 200));
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning", "assert"].includes(d.params.type)) errors.push(`console.${d.params.type}: ` + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  if (d.method === "Log.entryAdded" && ["error", "warning"].includes(d.params.entry.level)) errors.push(`log.${d.params.entry.level}: ${d.params.entry.text.slice(0, 160)} ${d.params.entry.url || ""}`);
  if (d.method === "Network.loadingFailed" && !d.params.canceled) failed.push(`${d.params.errorText} ${reqs.get(d.params.requestId) || ""}`);
  if (d.method === "Network.requestWillBeSent") reqs.set(d.params.requestId, d.params.request.url);
  if (d.method === "Network.responseReceived" && d.params.response.status >= 400) bad.push(`${d.params.response.status} ${d.params.response.url}`);
  pending.get(d.id)?.(d.result); };
const reqs = new Map();
const call = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => { const r = await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
await call("Network.enable"); await call("Runtime.enable"); await call("Log.enable");
await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
const results = []; const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
const go = async (hash) => { await ev(`(() => { const a = [...document.querySelectorAll('header a[href="#${hash}"]')][0]; if (a) a.click(); else location.hash = "${hash}"; })()`); await sleep(1800); };
const waitFor = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await sleep(250); } return false; };

await call("Page.navigate", { url: base }); await waitFor(`!!document.querySelector("h1")`);
// ---- helpers inside the page: same maths as the app, recomputed independently from the JSON
const installQa = async () => { await ev(`window.qa = {
  fmt: (x, d = 0) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }).format(x),
  med: (v) => { const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
  cost: (t, p) => t.km * p.cost_per_km + t.crew_h * p.crew_cost_per_h + t.truck_days * p.fixed_cost_per_truck_day,
  get: async (f) => (await fetch("./" + f, { cache: "no-store" })).json(),
  text: (sel) => document.querySelector(sel)?.textContent.trim() ?? null,
}; true`); };
await installQa();

// 1-2. base path and JSON
check("loads under base path", await ev(`location.pathname`) === new URL(base).pathname, await ev("location.href"));
const idx = await ev(`qa.get("datasets.json")`);
check("datasets.json lists datasets", idx.datasets.length === 2 && idx.default === "public", JSON.stringify(idx.datasets.map((d) => d.source)));
for (const d of idx.datasets) {
  const meta = await ev(`qa.get("${d.file}").then(r => ({ commit: r.meta.git_commit, src: r.meta.data_source, keys: Object.keys(r).join(","), geo: Object.keys(r.route_geometry?.geometries || {}).length, bench: !!r.optimisation_benchmark }))`);
  check(`${d.file} loads`, meta.src === d.source && meta.geo > 0 && meta.bench, JSON.stringify(meta));
  check(`${d.file} provenance commit`, meta.commit === "bdefe0f", meta.commit);
}
const R = "window.__R";
await ev(`qa.get("results-public.json").then(r => { ${R} = r; return true; })`);
const P = await ev(`(() => { const v = k => ${R}.assumptions.find(a => a.key === k).value; return { cost_per_km: v("cost_per_km"), crew_cost_per_h: v("crew_cost_per_h"), fixed_cost_per_truck_day: v("fixed_cost_per_truck_day") }; })()`);

// landing
check("landing h1", (await ev(`qa.text("h1")`)) === "Give every thread a better route.", await ev(`qa.text("h1")`));
check("landing has no event branding", !(await ev(`/hack4|hackathon|challenge 5|texvitrus/i.test(document.body.innerText)`)));
check("landing residents figure", (await ev(`document.body.innerText.includes(qa.fmt(${R}.coverage.population_total))`)));

// 3. tabs via nav links
const tabs = { rede: "The collection network", cobertura: "Where new points should go", recolha: "Fixed rounds or collection on demand", pressupostos: "The assumptions behind every number" };
for (const [h, title] of Object.entries(tabs)) {
  await go(h);
  check(`tab #${h} renders`, (await ev(`location.hash`)) === `#${h}` && (await ev(`qa.text("main h1")`)) === title, await ev(`qa.text("main h1")`));
}
await call("Page.reload"); await waitFor(`!!document.querySelector("main h1")`); await installQa();
await ev(`qa.get("results-public.json").then(r => { ${R} = r; return true; })`);
check("refresh keeps the tab (#pressupostos)", (await ev(`qa.text("main h1")`)) === tabs.pressupostos);

// network map markers
await go("rede"); await waitFor(`document.querySelectorAll("path.pt-candidate").length > 0`);
const nm = await ev(`({ e: document.querySelectorAll("path.pt-existing").length, c: document.querySelectorAll("path.pt-candidate").length,
  ne: ${R}.network.containers.features.length, nc: ${R}.network.candidates.features.length })`);
check("network map: one marker per point", nm.e === nm.ne && nm.c === nm.nc, JSON.stringify(nm));
await ev(`document.querySelector("path.pt-existing").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`); await sleep(400);
check("network tooltip shows the point id", await ev(`(document.querySelector(".leaflet-tooltip")?.textContent || "").includes(${R}.network.containers.features[0].properties.id)`));

// coverage slider
await go("cobertura");
for (const n of [0, 5, 15]) {
  await ev(`(() => { const i = document.querySelector('main input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "${n}"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(500);
  const c = await ev(`({ shown: qa.text('[data-stat="Residents covered"] [data-value]'), want: qa.fmt(${R}.coverage.additions[${n}].share * 100, 1) + "%",
    markers: document.querySelectorAll("path.pt-proposed").length })`);
  check(`coverage +${n}: share and proposed markers`, c.shown === c.want && c.markers === n, JSON.stringify(c));
}

// collection: tiles per profile
await go("recolha");
for (const [prof, label] of [["low", "low"], ["mid", "mid"], ["high", "high"]]) {
  await ev(`[...document.querySelectorAll('[role=radiogroup][aria-label="Fill-rate profile"] button')].find(b => b.textContent.startsWith("${label}")).click()`); await sleep(500);
  const t = await ev(`(() => { const { A, B } = ${R}.scenarios["${prof}"]; const p = ${JSON.stringify(P)};
    const sv = A.per_seed.map((a, i) => { const ca = qa.cost(a.totals, p), cb = qa.cost(B.per_seed[i].totals, p); return (ca - cb) / ca * 100; });
    const m = qa.med(sv); const want = m > 0 ? qa.fmt(m, 1) + "% lower" : m < 0 ? qa.fmt(-m, 1) + "% higher" : "no change";
    const km = qa.fmt(A.summary.km.median);
    const row = [...document.querySelectorAll("tr")].find(tr => tr.textContent.startsWith("Distance driven (km)"));
    return { shown: qa.text('[data-stat="Operating cost, B vs A"] [data-value]'), want, kmShown: row?.children[1].querySelector("span").textContent, km }; })()`);
  check(`collection ${prof}: B vs A cost tile and km table`, t.shown === t.want && t.kmShown === t.km, JSON.stringify(t));
}
// both strategies, weeks, runs: "This week" equals JSON
let weekOk = 0, weekN = 0, streetOk = true;
for (const sc of ["A", "B"]) {
  await ev(`[...document.querySelectorAll('[role=radiogroup][aria-label=Scenario] button')].find(b => b.textContent === "${sc}").click()`); await sleep(300);
  for (const run of [0, 4]) {
    await ev(`(() => { const s = document.querySelector('select[aria-label=Run]'); s.value = "${run}"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(300);
    for (const w of [1, 2, 3, 4]) {
      await ev(`[...document.querySelectorAll('[role=radiogroup][aria-label=Week] button')].find(b => b.textContent === "W${w}").click()`); await sleep(350);
      const x = await ev(`(() => { const wk = ${R}.scenarios.high.${sc}.per_seed[${run}].weeks[${w - 1}];
        const p = [...document.querySelectorAll("p")].find(p => p.textContent.startsWith("This week:")).textContent;
        return { ok: p.includes(wk.stops + " stops") && p.includes(qa.fmt(wk.km, 1) + " km"), routes: wk.routes.length,
                 street: document.querySelectorAll("path.rt-street").length, approx: document.querySelectorAll("path.rt-approx").length }; })()`);
      weekN++; if (x.ok) weekOk++; if (x.street !== x.routes || x.approx !== 0) streetOk = false;
    }
  }
}
check("both strategies × weeks × runs match JSON (high profile)", weekOk === weekN, `${weekOk}/${weekN}`);
check("every route drawn with street geometry, none approximate", streetOk);
// stop selection + tooltip
await ev(`[...document.querySelectorAll('[role=radiogroup][aria-label=Week] button')].find(b => b.textContent === "W1").click()`); await sleep(300);
const firstStop = await ev(`(() => { const b = document.querySelector('aside button[aria-pressed]'); b.click(); return b.getAttribute("title"); })()`); await sleep(400);
check("stop chip selects a stop (panel + map halo)", (await ev(`!!document.querySelector("path.pt-halo") && [...document.querySelectorAll("aside p")].some(p => /OSM-|TX-|CAND-/.test(p.textContent))`)), firstStop);
await ev(`document.querySelector("path.pt-served").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))`); await sleep(400);
check("route stop tooltip shows schedule", await ev(`/Collected in run/.test(document.querySelector(".leaflet-tooltip")?.textContent || "")`));
check("map truck animates on the routes map", await ev(`(async () => { const a = document.querySelector("path.truck")?.getAttribute("d"); await new Promise(r => setTimeout(r, 900)); return !!a && a !== document.querySelector("path.truck")?.getAttribute("d"); })()`));
// benchmark
for (const pol of ["A", "B"]) {
  await ev(`[...document.querySelectorAll('[role=radiogroup][aria-label=Scenario] button')].find(b => b.textContent.startsWith("${pol} ·")).click()`); await sleep(400);
  const b = await ev(`(() => { const rows = ${R}.optimisation_benchmark.scenarios.high.${pol}.per_seed.filter(x => x.valid);
    const m = qa.med(rows.map(x => x.improvement_cost_pct)); const want = (m > 0 ? "+" : m < 0 ? "−" : "") + qa.fmt(Math.abs(m), 1) + "%";
    const row = [...document.querySelectorAll("tr")].find(tr => tr.textContent.startsWith("Operating cost") && tr.children.length === 5);
    return { shown: row?.children[4].querySelector("span span")?.textContent, want,
             disclaimer: document.body.innerText.includes("it is not a measured VITRUS saving") }; })()`);
  check(`benchmark ${pol}: cost improvement equals JSON, labelled simulated`, b.shown === b.want && b.disclaimer, JSON.stringify(b));
}
// weekly chart + break-even table views
const wk = await ev(`(() => { const d = [...document.querySelectorAll("details")].find(x => x.closest("section")?.textContent.includes("Distance per week")); d.open = true;
  const cells = [...d.querySelectorAll("tbody tr")].map(tr => [...tr.children].map(td => td.textContent));
  const { A, B } = ${R}.scenarios.high; const want = A.per_seed[0].weeks.map((_, w) => [qa.fmt(qa.med(A.per_seed.map(s => s.weeks[w].km)), 1), qa.fmt(qa.med(B.per_seed.map(s => s.weeks[w].km)), 1)]);
  return { ok: cells.every((c, i) => c[1] === want[i][0] && c[2] === want[i][1]), cells: cells.length }; })()`);
check("weekly distance chart values equal JSON medians", wk.ok && wk.cells === 4, JSON.stringify(wk));
const be = await ev(`(() => { const d = [...document.querySelectorAll("details")].find(x => x.closest("section")?.textContent.includes("Break-even")); d.open = true;
  const shown = [...d.querySelectorAll("tbody tr")].map(tr => tr.children[1].textContent);
  const pp = ${JSON.stringify(P)};
  const want = ${R}.breakeven.points.map(p => { const m = qa.med(p.per_seed.map(s => { const a = qa.cost(s.A, pp), b = qa.cost(s.B, pp); return (a - b) / a * 100; }));
    return (m > 0 ? "+" : m < 0 ? "−" : "") + qa.fmt(Math.abs(m), 1) + "%"; });
  return { ok: JSON.stringify(shown) === JSON.stringify(want), shown, want }; })()`);
check("break-even table equals pipeline sweep", be.ok, be.ok ? `${be.shown.length} points` : JSON.stringify(be));
await ev(`[...document.querySelectorAll('[role=radiogroup][aria-label="Saving measure"] button')].find(b => b.textContent === "Per tonne").click()`); await sleep(300);
check("break-even per-tonne toggle switches the measure", await ev(`document.body.innerText.includes("B's saving in cost per tonne")`));

// assumptions
await go("pressupostos");
const as = await ev(`(() => { const rows = [...document.querySelectorAll("table")].find(t => t.textContent.includes("Parameter")).querySelectorAll("tbody tr");
  return { rows: rows.length, want: ${R}.assumptions.length, cap: [...rows].find(r => r.textContent.startsWith("Container capacity"))?.children[1].textContent,
           capWant: qa.fmt(${R}.assumptions.find(a => a.key === "container_capacity_kg").value) }; })()`);
check("assumptions table lists every parameter with its value", as.rows === as.want && as.cap === as.capWant, JSON.stringify(as));
const before = await ev(`qa.text('[data-stat="A · four-week cost (median)"] [data-value]')`);
await ev(`(() => { const i = document.querySelector('main input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "1.2"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
const after = await ev(`qa.text('[data-stat="A · four-week cost (median)"] [data-value]')`);
const wantAfter = await ev(`(() => { const prof = [...document.querySelectorAll('[role=radiogroup][aria-label="Fill-rate profile"] button')].find(b => b.getAttribute("aria-checked") === "true").textContent.split(" ")[0];
  const p = { ...${JSON.stringify(P)}, cost_per_km: 1.2 }; return "€" + qa.fmt(qa.med(${R}.scenarios[prof].A.per_seed.map(s => qa.cost(s.totals, p)))); })()`);
check("cost slider recomputes A cost exactly", after === wantAfter && after !== before, `${before} -> ${after} (want ${wantAfter})`);
await ev(`[...document.querySelectorAll("button")].find(b => b.textContent.includes("Reset to file values")).click()`); await sleep(300);
check("reset restores file values", (await ev(`qa.text('[data-stat="A · four-week cost (median)"] [data-value]')`)) === before);

// dataset switch
await ev(`(() => { const s = document.querySelector('select[aria-label=Dataset]'); s.value = "synthetic"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await waitFor(`document.body.innerText.includes("Synthetic data.")`);
await go("rede"); await sleep(800);
check("dataset switch to synthetic", (await ev(`qa.text('[data-stat="Existing textile points"] [data-value]')`)) === "30" && (await ev(`document.body.innerText.includes("Synthetic data.")`)));
await ev(`(() => { const s = document.querySelector('select[aria-label=Dataset]'); s.value = "public"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(1500);
check("dataset switch back to public", (await ev(`qa.text('[data-stat="Existing textile points"] [data-value]')`)) === "2");

// 8. animations do not block interaction: controls are the topmost element at their centre
await go("recolha");
const hit = await ev(`[...document.querySelectorAll("main button, header a, main select")].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.top > 70 && r.bottom < innerHeight; })
  .map(e => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e === t || e.contains(t); })`);
check("no animation layer covers visible controls", hit.length > 0 && hit.every(Boolean), `${hit.filter(Boolean).length}/${hit.length}`);

console.log(results.join("\n"));
console.log(`\nconsole/page errors: ${errors.length}${errors.length ? "\n  " + errors.join("\n  ") : ""}`);
console.log(`failed requests: ${failed.length}${failed.length ? "\n  " + [...new Set(failed)].join("\n  ") : ""}`);
console.log(`HTTP >= 400: ${bad.length}${bad.length ? "\n  " + [...new Set(bad)].join("\n  ") : ""}`);
chrome.kill(); process.exit(results.some((r) => r.startsWith("FAIL")) || errors.length || bad.length ? 1 : 0);
