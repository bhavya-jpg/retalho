// Build a single self-contained HTML file for the pitch laptop (PLAN.md M14).
// Chrome blocks module scripts and fetch() on file:// pages, so the built JS, CSS and every
// dataset listed in dist/datasets.json are inlined; the app reads window.__RETALHO_DATA__.
// Only the base-map tiles need the network, and the map works without them.
// Usage (after `npm run build`): node scripts/offline.mjs  ->  dist-offline/retalho-offline.html
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dist = new URL("../dist/", import.meta.url);
const outDir = new URL("../dist-offline/", import.meta.url);
const read = (f) => readFileSync(new URL(f, dist), "utf-8");

let html = read("index.html");
const js = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/);
const css = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/);
if (!js || !css) throw new Error("dist/index.html does not have the expected script/style tags; rebuild first");

const files = {};
let index;
try {
  index = JSON.parse(read("datasets.json"));
  files["datasets.json"] = index;
  for (const d of index.datasets) files[d.file] = JSON.parse(read(d.file));
} catch {
  files["results.json"] = JSON.parse(read("results.json"));
}
// "<" escaped so no data string can close the <script> element.
const data = JSON.stringify(files).replace(/</g, "\\u003c");

html = html
  .replace(css[0], () => `<style>${read(css[1])}</style>`)
  .replace(js[0], () => `<script>window.__RETALHO_DATA__=${data}</script>\n` +
    `<script type="module">${read(js[1]).replace(/<\/script/gi, "<\\/script")}</script>`);

mkdirSync(outDir, { recursive: true });
const out = new URL("retalho-offline.html", outDir);
writeFileSync(out, html);
const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`Wrote ${out.pathname} (${kb} KB, ${Object.keys(files).length - (index ? 1 : 0)} dataset(s) embedded)`);
