# Design research for the Retalho redesign

Internal notes, written before implementation, 20 Oct 2026.

## What was inspected, and how

Each page was loaded in headless Chrome with a normal desktop user agent. The script waited 7 s, scrolled the whole page to trigger lazy content, then captured the first screen and the full page at **1440 px** and **390 px** wide. A second script measured motion on the live page from computed styles and stylesheet rules: transitions, keyframes, `prefers-reduced-motion` rules, canvases and video.

| Site | Desktop | Mobile | Notes |
|---|---|---|---|
| awwwards.com (home) | ✓ | ✓ | page about 12,900 px tall; Inter Tight; h1 127 px |
| awwwards.com/websites/experimental/ | ✓ | ✓ | gallery of about 60 award entries |
| awwwards.com/websites/animation/ | ✓ | ✓ | |
| awwwards.com/websites/clean/ | ✓ | ✓ | |
| elevenlabs.io | ✓ | ✓ | Waldenburg display face + Inter; canvas #FDFCFC |
| circulose.com (textile circularity) | ✓ | — | Neue Haas Grotesk + Space Mono |

The screenshots (about 30 JPEGs) were kept in the session's scratch folder. They are **not committed**, because they are other companies' copyrighted pages. Motion could not be judged from stills, so the motion figures below come from the measurement script, not from watching animations.

## Measured motion

| Site | Elements with transitions | Most common durations | Animating while idle | Reduced-motion rules |
|---|---|---|---|---|
| ElevenLabs | 365 / 3,729 | **150 ms** (241), 300 ms (74), 200 ms (36) | 0 | 2 |
| Awwwards | 204 / 1,465 | **300 ms** (171), 600 ms (26) | 0 | 0 |
| Circulose | 115 / 901 | **200 ms** (94), 400 ms | 1 | 45 |

The common thread: **nothing loops at rest.** Motion is a short response to interaction (150–300 ms), with a slower tier (about 600 ms) reserved for reveals.

## Strongest principles observed

1. **One canvas, one ink.** ElevenLabs uses a warm off-white canvas and near-black ink, and colour comes almost entirely from the *material* imagery: grainy, tactile orbs drawn in `<canvas>`. A technical product feels premium because the colour is the material, not the chrome.
2. **Asymmetric editorial hero.** A short headline on the left, a supporting paragraph on the right on a shared baseline, and a pair of rounded buttons (solid and outline). No centred slogan floating over a gradient.
3. **Scale contrast.** Awwwards sets display type at about 127 px next to 14 px labels. Hierarchy comes from the gap between sizes, not from many mid-sized headings.
4. **Metadata as typography.** Dates, scores and categories sit in small boxed chips or monospace text (Awwwards' boxed date, Circulose's Space Mono). Technical facts get their own voice.
5. **A repeated section rhythm.** Small eyebrow, two-line headline and paragraph, then content. ElevenLabs repeats this for every product, so a long page stays easy to scan.
6. **Real product UI framed as artwork.** ElevenLabs shows its actual interface in soft panels, not illustrations of a fictional product.
7. **Material honesty.** Circulose leads with footage of denim pulp in a recycling plant: the textile *is* the image.
8. **Mobile recomposition.** At 390 px, ElevenLabs stacks headline, paragraph and buttons, collapses the navigation to one button and a menu, and turns tabs into scrollable pills.
9. **Restraint in the gallery.** Across the Awwwards experimental and animation entries, the sites that read best have one strong idea, one accent colour and a lot of space.

## What Retalho will adapt

| Principle | Retalho version |
|---|---|
| Colour carried by material | Colour comes from textile swatches and the data (routes, strategies). The chrome stays cotton and ink. |
| Asymmetric editorial hero | Serif headline on the left; on the right an SVG where woven threads unravel into the **real** Guimarães network (actual boundary, collection points and one OSRM route from `results.json`). |
| Metadata voice | IBM Plex Mono for ids, units, provenance and section numbers ("01 / Material"). |
| Section rhythm | Numbered sections: eyebrow, short serif headline, plain-language paragraph, then real data. |
| Real product as artwork | Landing sections use actual results: the collection pattern, coverage and benchmark figures, each labelled Simulated or Measured. |
| Material honesty | The four-week collection schedule drawn as a **weave**: rows are containers, columns are weeks, a filled cell is a collection. Scenario A is a plain weave; B is sparse. It is real data that looks like cloth. |
| Short, interaction-driven motion | 150 ms for micro-interactions, 300 ms for state changes, about 600–900 ms once for reveals and thread drawing. Nothing loops. Full reduced-motion support. |
| Mobile recomposition | Hero stacks; nav becomes a compact bar plus a scrollable tab row; tables keep their own horizontal scroll. |

## What Retalho will NOT use

- **Giant, full-bleed or decorative-only visuals inside the planning tool.** The map and tables must stay dense and legible.
- **WebGL or canvas orbs, video backgrounds, scroll-jacking or parallax.** Costly, distracting, and not about textiles.
- **Huge all-caps hero type over imagery.** It reads as fashion or e-commerce, which Retalho is not.
- **Cookie-style overlays and promotional banners.** The site sets no cookies and has nothing to promote.
- **Animating every element on scroll.** Only headings, the hero thread, diagrams and selected figures reveal.
- **Any other company's typefaces, layouts, illustrations or marks.**

## Proposed direction: "Tecido urbano" (urban fabric)

*Working idea: the city's streets as warp, collection routes as weft.* "Retalho" is Portuguese for a fabric remnant or offcut; the brand treats remnants as material with a next destination, not as waste.

- **Canvas.** Natural cotton (`#F3EFE6`) and warm ivory surfaces, deep ink type, flax hairlines, and a faint woven grid behind key moments only.
- **Data colours, chosen by validation not taste.** Indigo dye for Scenario A (fixed rounds), terracotta for Scenario B (demand-based), forest green for "Retalho optimised" in the benchmark, flax and olive for baselines and other neutral roles.
- **Type.** Instrument Serif for display (editorial, used sparingly), IBM Plex Sans for the interface, IBM Plex Mono for technical metadata. All open-source and self-hosted, so the site works offline and under `/retalho/`.
- **Graphic language.**
  - thread lines that draw once
  - stitched seams (dashed rules) for callouts and selected items
  - original SVG swatches (cotton, linen, denim, knit)
  - a logo of a small woven square whose last thread leaves as a route and ends in a collection point
- **One reserved meaning: dashed lines on the map mean "approximate geometry".** Decorative stitching must never appear on the map.
