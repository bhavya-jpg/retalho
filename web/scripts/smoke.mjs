// Smoke test: drives the built app in headless Chrome and checks the M9-M11 interactions.
// Usage: npm run build && npx vite preview --port 4173 & npm run smoke
// CHROME=/path/to/chrome and BASE=http://host:port/ override the defaults.
import { spawn } from "node:child_process";
const base = process.env.BASE ?? "http://localhost:4173/";
const chrome = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=9334", "--window-size=1440,1000", `--user-data-dir=${process.env.TMPDIR}/cdpi${Date.now()}`, base + "#pressupostos"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 40 && !ws; i++) { await sleep(250); try { const t = await (await fetch("http://127.0.0.1:9334/json")).json(); const p = t.find((x) => x.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} }
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d.result); };
const call = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const go = async (hash) => { await ev(`location.hash = "${hash}"; location.reload()`); await sleep(2500); };
const results = [];
const check = (name, ok, detail) => results.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);

await sleep(2500);
// M10: cost slider -> every € figure updates within 100 ms
const r1 = await ev(`(async () => {
  const tile = document.querySelector('[data-stat="A · four-week cost (median)"] [data-value]');
  const before = tile.textContent;
  const input = document.querySelector('input[type=range]');
  const t0 = performance.now();
  const changed = new Promise(res => new MutationObserver((_, o) => { o.disconnect(); res(performance.now() - t0); })
    .observe(tile, { subtree: true, characterData: true, childList: true }));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "1.2");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const ms = await changed;
  return { before, after: tile.textContent, ms };
})()`);
check("M10 €/km slider updates cost", r1.before !== r1.after && r1.ms < 100, `${r1.before} -> ${r1.after} in ${r1.ms.toFixed(1)} ms`);

// M9: A/B toggle redraws routes for the selected week
await go("recolha");
const r2 = await ev(`(async () => {
  const text = () => [...document.querySelectorAll("p")].find(p => p.textContent.startsWith("This week:")).textContent;
  const lines = () => document.querySelectorAll(".leaflet-overlay-pane path.leaflet-interactive").length;
  const a = { text: text(), lines: lines() };
  [...document.querySelectorAll('[role=radiogroup][aria-label=Scenario] button')].find(b => b.textContent === "B").click();
  await new Promise(r => setTimeout(r, 300));
  const b = { text: text(), lines: lines() };
  [...document.querySelectorAll('[role=radiogroup][aria-label=Week] button')].find(b => b.textContent === "W3").click();
  await new Promise(r => setTimeout(r, 300));
  return { a, b, w3: text() };
})()`);
check("M9 A/B toggle redraws routes", r2.a.text !== r2.b.text, `A: "${r2.a.text.slice(0, 60)}" | B: "${r2.b.text.slice(0, 60)}"`);
check("M9 week selector redraws routes", r2.b.text !== r2.w3, `B W3: "${r2.w3.slice(0, 60)}"`);

// M9: KPI values identical to the JSON (summary median km)
const r3 = await ev(`(async () => {
  const res = await (await fetch("./results.json")).json();
  const row = [...document.querySelectorAll("tr")].find(tr => tr.textContent.startsWith("Distance driven (km)"));
  return { shown: row.children[1].querySelector("span").textContent, json: res.scenarios.mid.A.summary.km.median };
})()`);
check("M9 table equals JSON", Number(r3.shown.replace(/,/g, "")) === Math.round(r3.json), `shown ${r3.shown}, json ${r3.json}`);

// M11: coverage slider updates sites and share from the JSON
await go("cobertura");
const r4 = await ev(`(async () => {
  const res = await (await fetch("./results.json")).json();
  const input = document.querySelector('input[type=range]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "10");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const shown = document.querySelector('[data-stat="Residents covered"] [data-value]').textContent;
  const orange = [...document.querySelectorAll(".leaflet-overlay-pane path")].filter(p => p.getAttribute("fill-opacity") === "1" && /eb6834|d95926/i.test(p.getAttribute("fill"))).length;
  return { shown, json: res.coverage.additions[10].share, orange, nSites: res.coverage.additions[10].site_ids.length };
})()`);
check("M11 slider +10 shows JSON coverage", r4.shown === (r4.json * 100).toFixed(1) + "%", `shown ${r4.shown}, json ${(r4.json * 100).toFixed(2)}%`);
check("M11 map shows exactly the proposed sites", r4.orange === r4.nSites, `${r4.orange} proposed markers, ${r4.nSites} in JSON`);

console.log(results.join("\n"));
chrome.kill(); process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
