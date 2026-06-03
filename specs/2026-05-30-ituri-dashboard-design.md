# Design: Ituri genomic-epi dashboard (PearTree consumer app)

**Date:** 2026-05-30
**Status:** Approved — ready for implementation planning

## Problem

PearTree's same-page embed now emits selection/hover events outward and accepts
programmatic selection inward (`onNodeSelect`/`onNodeHover`/`getSelection`,
`setSelection`/`selectByAnnotation`). This project is a standalone web app that
*consumes* those APIs: an Ituri (DRC Ebola) genomic-epidemiology dashboard that
links an embedded phylogenetic tree, a map, and an external time-series chart.

## Scope

- **In scope:** a new, separate Vite + plain-JS app with three linked panels
  (tree, map, time-series), driven by the Ituri tree's `location` annotation and
  a placeholder time-series. Two-way tree↔map selection; tree→time-series
  date marker. Static (fitted-view) time-axis alignment.
- **Out of scope (now):** dynamic axis sync on tree pan/zoom (would need a new
  PearTree viewport API); the real time-series dataset (placeholder for now,
  one-file swap later); auth, deployment, multiple trees/datasets.

## Project setup

- **Location:** `/Users/user/Documents/work/ituri-dashboard` — its own git repo
  (separate from PearTree).
- **Tooling:** Vite, plain JS (no framework); Leaflet via npm; Vitest (bundled
  with Vite) for unit tests.
- **Consuming PearTree:** copy the prebuilt bundle `dist/peartree.bundle.min.js`
  (built in the PearTree repo via `npm run bundle`) into this app's
  `public/peartree.bundle.min.js`, and load it with a `<script>` tag in
  `index.html` so it exposes `window.PearTreeEmbed`. The app's own code is ESM
  driven by Vite and reads `window.PearTreeEmbed`. Updating PearTree later = copy
  a fresh bundle.
- The PearTree bundle injects its own CSS; no extra stylesheets needed for the
  tree.

## Layout & components

CSS-grid layout: left column = tree (top) + time-series (bottom); right column =
map (full height).

```
┌──────────────┬─────────────┐
│  tree        │             │
├──────────────┤   map       │
│  time-series │ (full ht)   │
└──────────────┴─────────────┘
```

Small, focused modules under `src/`:

| Module | Responsibility | Depends on |
|---|---|---|
| `tree-panel.js` | Embed PearTree (`window.PearTreeEmbed.embed`) locked to fit-to-window with explicit `paddingLeft/paddingRight`; expose `selectByLocation(loc)`, `clear()`, and `onSelect(cb)` over `onNodeSelect`. | `window.PearTreeEmbed` |
| `map-panel.js` | Leaflet map; one marker per location (from coords data, sized by tip count); `onLocationClick(cb)`; `highlight(locations)`; `clearHighlight()`. | Leaflet, `ituri-locations.json`, tip counts |
| `timeseries-panel.js` | Render the placeholder time-series in an SVG/canvas plot area; `setMarkers(dates)` draws dashed vertical lines; owns the plot rectangle and uses the shared scale. | `timeseries.json`, `time-scale.js` |
| `time-scale.js` | **Pure**: build a linear date↔x scale from `[minDate,maxDate]` + plot padding; `dateToX(date)`, `xToDate(x)`; `nodeToDate(descriptor, mostRecentDate)`. No DOM. | — |
| `coordinator.js` | Glue: subscribe to tree selection + map clicks; apply the echo-loop guard; update map + time-series. | the three panels |
| `main.js` | Load data files, instantiate panels, start the coordinator. | all |

## Data layer (`public/data/`)

Three static files, served as-is by Vite and `fetch`ed at runtime (so the
time-series data can be swapped without a rebuild):

1. `ituri-tips.json` — `[{ id, date, location }]` for all tips. Generated once
   from the Ituri `.ptree` (NEXUS) during implementation. Provides: the date
   domain `[minDate,maxDate]`, per-location tip counts (marker sizing), and
   `mostRecentDate` (for internal-node → date calibration).
2. `ituri-locations.json` — `{ "<location>": { lat, lon }, … }` for the real
   `location` values in the tree (Bunia, Hoho, Katwa, Lumumba, ex-Bunia, …),
   with approximate DRC coordinates. Generated/curated during implementation.
3. `timeseries.json` — placeholder `[{ date, value }, …]` spanning the tree's
   date range. Swappable for real data in one file.

PearTree separately fetches the actual `.ptree`
(`https://artic-network.github.io/misc/Ituri_2026-05-28_HKY_EGC_rate1.2E-3.HIPSTR.ptree`)
to render the tree.

## Interactions & data flow

```
map marker click (location)
  → coordinator: set guard; tree.selectByLocation(loc)  [= selectByAnnotation('location', loc)]
  → PearTree highlights matching tips, fires peartree-node-select
  → tree onSelect handler runs (guard set → skip re-driving the map),
     updates time-series marker, clears guard

tree node selection (user click in tree)
  → onSelect({ target, selected, mrca }):
       map.highlight(distinct locations among `selected`)
       timeseries.setMarkers([ nodeToDate(target ?? mrca, mostRecentDate) ])
```

- **Echo guard:** a `programmatic` boolean set immediately before
  `tree.selectByLocation(...)` and cleared inside the `onSelect` handler. When
  set, the handler skips the `map.highlight(...)` step (the map already reflects
  the click) but still updates the time-series. Prevents the
  map→tree→event→map loop.
- **Clearing:** an empty selection (`selected` empty) → `map.clearHighlight()`
  and remove dashed markers.

## Node → date & axis alignment (technical crux)

- **Node date** (for the dashed line):
  - Tip → `descriptor.annotations.date`.
  - Internal node → `mostRecentDate − descriptor.annotations.height_mean`
    (the tree is time-scaled; heights are in years before the most recent tip).
    `mostRecentDate` comes from `ituri-tips.json`.
  - For a single clicked node, use `target`; for bulk/map-driven selections
    (`target === null`), fall back to `mrca`. If neither resolves to a date, draw
    no line and log a warning.
- **Static axis alignment:** the tree is locked to fit-to-window (no time
  pan/zoom expected for the aligned view), and the embed is given explicit
  `paddingLeft`/`paddingRight` (e.g. `20`). `time-scale.js` builds the
  time-series plot rectangle with the **same** left/right padding and the
  **same** date domain `[minDate,maxDate]` derived from `ituri-tips.json`. Both
  panels share the left column's width, so the x-axes line up. Pixel-perfect
  alignment is a known polish risk; the target is "visually aligned at the fitted
  view."

## Error handling & edge cases

- Tree fails to load (network/CORS) → map + time-series still render; the
  coordinator no-ops on selection until PearTree's `onTreeLoad` fires.
- Selected node with no resolvable date (missing `date`/`height_mean`) → no
  dashed line; `console.warn`.
- A `location` present in the tree but missing from `ituri-locations.json` → its
  map marker is skipped (logged once); selection still highlights tree tips.
- Empty/cleared selection → clear map highlight and remove dashed markers.
- `window.PearTreeEmbed` missing (bundle not loaded) → fail fast with a clear
  console error in `tree-panel.js`.

## Testing

- **Automated (Vitest):** unit-test the pure `time-scale.js`:
  - `dateToX`/`xToDate` round-trip and endpoints (minDate→left padding,
    maxDate→width−right padding);
  - `nodeToDate` for a tip (uses `annotations.date`) and an internal node
    (`mostRecentDate − height_mean`);
  - missing-date descriptor → returns `null`.
- **Manual:** `npm run dev`, then verify:
  1. Map marker click → matching tips highlight in the tree.
  2. Tree clade click → those locations highlight on the map AND a dashed
     vertical line appears on the time-series at the node's date.
  3. The dashed line sits at the correct date and the time-series x-axis is
     visually aligned with the tree's time axis at the fitted view.
  4. Clearing the selection clears the map highlight and the dashed line.
  5. No feedback loop when clicking map markers (echo guard works).
