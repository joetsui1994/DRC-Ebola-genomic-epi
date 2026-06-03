# Ituri Genomic-Epi Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vite + plain-JS dashboard that embeds PearTree (via the prebuilt bundle) alongside a Leaflet map and a time-series chart, linked two-ways through PearTree's selection API, with a tree→time-series date marker on a statically-aligned time axis.

**Architecture:** Three panels (tree top-left, time-series bottom-left, map full-height right) in a CSS grid. The PearTree bundle exposes `window.PearTreeEmbed`. A pure `time-scale` module owns date↔x mapping and node→date conversion. A `coordinator` wires tree↔map↔time-series with an echo-loop guard. Static data files (tips, location coords, placeholder time-series) live in `public/data/`.

**Tech Stack:** Vite, vanilla JS (ESM), Leaflet (npm), Vitest (unit tests), the prebuilt `peartree.bundle.min.js`.

**Spec:** `specs/2026-05-30-ituri-dashboard-design.md`

---

## File structure

| Path | Responsibility |
|---|---|
| `package.json`, `vite.config.js` | Vite project + Vitest config |
| `index.html` | Grid layout, panel containers, loads the PearTree bundle then `src/main.js` |
| `public/peartree.bundle.min.js` | Copied PearTree bundle (build artifact) |
| `public/data/ituri-tips.json` | `[{id,date,location}]` (15 tips) |
| `public/data/ituri-locations.json` | `{location:{lat,lon}}` marker coords |
| `public/data/ituri-meta.json` | `{mostRecentDate, rootDate}` |
| `public/data/timeseries.json` | placeholder `[{date,value}]` |
| `src/time-scale.js` | **pure** date↔x scale + `nodeToDate` (unit-tested) |
| `src/time-scale.test.js` | Vitest tests for `time-scale.js` |
| `src/tree-panel.js` | embeds PearTree; `selectByLocation`, `onSelect`, `clear` |
| `src/map-panel.js` | Leaflet map; markers; `onLocationClick`, `highlight`, `clearHighlight` |
| `src/timeseries-panel.js` | draws the series + dashed date markers via the scale |
| `src/coordinator.js` | wires panels together + echo guard |
| `src/main.js` | loads data, builds panels, starts coordinator |
| `src/style.css` | grid + panel styling |

---

### Task 1: Project scaffold

**Files:** Create `package.json`, `vite.config.js`, `index.html`, `src/main.js` (stub), `src/style.css`, `.gitignore`; copy the PearTree bundle.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ituri-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "leaflet": "^1.9.4"
  }
}
```

- [ ] **Step 2: Create `vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  test: { environment: 'node' },
});
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
dist/
.DS_Store
```

- [ ] **Step 4: Create `src/style.css`**

```css
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }
body { font-family: system-ui, -apple-system, sans-serif; color: #1c2b2d; }

#app {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  grid-template-areas:
    "tree map"
    "timeseries map";
  gap: 6px;
  padding: 6px;
  height: 100vh;
}
#tree       { grid-area: tree; }
#timeseries { grid-area: timeseries; }
#map        { grid-area: map; }

.panel { border: 1px solid #ccd; border-radius: 6px; overflow: hidden; position: relative; }
.panel > h3 { margin: 0; padding: 4px 8px; font-size: 12px; color: #556; background: #f4f6f7; border-bottom: 1px solid #e3e7e9; }
.panel-body { position: absolute; top: 26px; left: 0; right: 0; bottom: 0; }
#map .panel-body { top: 26px; }
```

- [ ] **Step 5: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ituri Genomic-Epi Dashboard</title>
  <!-- PearTree bundle: exposes window.PearTreeEmbed (loads before the module) -->
  <script src="/peartree.bundle.min.js"></script>
</head>
<body>
  <div id="app">
    <div id="tree" class="panel"><h3>Phylogeny</h3><div id="tree-body" class="panel-body"></div></div>
    <div id="timeseries" class="panel"><h3>Time series</h3><div id="timeseries-body" class="panel-body"></div></div>
    <div id="map" class="panel"><h3>Locations</h3><div id="map-body" class="panel-body"></div></div>
  </div>
  <script type="module" src="/src/main.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `src/main.js` (stub)**

```js
import './style.css';

console.log('Ituri dashboard booting…', window.PearTreeEmbed ? 'PearTreeEmbed present' : 'PearTreeEmbed MISSING');
```

- [ ] **Step 7: Install deps and copy the PearTree bundle**

Run (from the project root `/Users/user/Documents/work/ituri-dashboard`):
```bash
npm install
mkdir -p public/data
cp ../peartree/dist/peartree.bundle.min.js public/peartree.bundle.min.js
```
Expected: `npm install` completes; `public/peartree.bundle.min.js` exists (~1.5 MB).
(If the bundle is missing, build it first: `cd ../peartree && npm run bundle`.)

- [ ] **Step 8: Smoke-test the dev server**

Run: `npm run dev` (then stop it with Ctrl-C after checking).
Expected: Vite serves on `http://localhost:5173`; opening it shows three empty bordered panels and the console logs `PearTreeEmbed present`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Scaffold Vite app: grid layout, panels, PearTree bundle"
```

---

### Task 2: Static data files

**Files:** Create the four JSON files in `public/data/`.

- [ ] **Step 1: Create `public/data/ituri-tips.json`**

```json
[
  { "id": "PP_006Y8ME", "date": "2026-05-06", "location": "Katwa" },
  { "id": "PP_006Y8R6", "date": "2026-05-16", "location": "Bunia" },
  { "id": "PP_006Y8S4", "date": "2026-05-16", "location": "Bunia" },
  { "id": "PP_00711R7", "date": "2026-05-03", "location": "Hoho" },
  { "id": "PP_00711S5", "date": "2026-05-03", "location": "Hoho" },
  { "id": "PP_006XHL9", "date": "2026-05-07", "location": "Bunia" },
  { "id": "PP_006Y8NC", "date": "2026-05-06", "location": "Bunia" },
  { "id": "PP_006Y8PA", "date": "2026-05-06", "location": "Bunia" },
  { "id": "PP_006Y8Q8", "date": "2026-05-06", "location": "Bunia" },
  { "id": "PP_00711T3", "date": "2026-05-03", "location": "Lumumba" },
  { "id": "PP_006XCJJ", "date": "2026-05-14", "location": "ex-Bunia" },
  { "id": "PP_00711U1", "date": "2026-05-03", "location": "Hoho" },
  { "id": "PP_00711VZ", "date": "2026-05-03", "location": "Hoho" },
  { "id": "PP_006XHKB", "date": "2026-05-03", "location": "Bunia" },
  { "id": "PP_006XXY5", "date": "2026-05-20", "location": "ex-Bunia" }
]
```

- [ ] **Step 2: Create `public/data/ituri-locations.json`**

> Coordinates are approximate (DRC Ituri / North Kivu) and meant to be refined later.

```json
{
  "Bunia":    { "lat": 1.5667, "lon": 30.2500 },
  "ex-Bunia": { "lat": 1.5900, "lon": 30.2700 },
  "Hoho":     { "lat": 0.5500, "lon": 29.4500 },
  "Lumumba":  { "lat": 0.4900, "lon": 29.4700 },
  "Katwa":    { "lat": 0.1200, "lon": 29.3000 }
}
```

- [ ] **Step 3: Create `public/data/ituri-meta.json`**

```json
{ "mostRecentDate": "2026-05-20", "rootDate": "2026-03-19" }
```

- [ ] **Step 4: Create `public/data/timeseries.json`** (placeholder epi-curve spanning the tree's domain)

```json
[
  { "date": "2026-03-22", "value": 1 },
  { "date": "2026-03-29", "value": 3 },
  { "date": "2026-04-05", "value": 6 },
  { "date": "2026-04-12", "value": 11 },
  { "date": "2026-04-19", "value": 18 },
  { "date": "2026-04-26", "value": 22 },
  { "date": "2026-05-03", "value": 17 },
  { "date": "2026-05-10", "value": 12 },
  { "date": "2026-05-17", "value": 7 }
]
```

- [ ] **Step 5: Commit**

```bash
git add public/data
git commit -m "Add Ituri tip data, location coords, meta, placeholder time-series"
```

---

### Task 3: Pure `time-scale.js` (TDD)

**Files:** Create `src/time-scale.js`, `src/time-scale.test.js`.

- [ ] **Step 1: Write the failing tests** — create `src/time-scale.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createTimeScale, nodeToDate, MS_PER_YEAR } from './time-scale.js';

describe('createTimeScale', () => {
  const s = createTimeScale({
    minDate: '2026-03-19', maxDate: '2026-05-20',
    width: 420, padLeft: 20, padRight: 20,
  });

  it('maps minDate to the left padding and maxDate to width - right padding', () => {
    expect(s.dateToX('2026-03-19')).toBeCloseTo(20, 6);
    expect(s.dateToX('2026-05-20')).toBeCloseTo(400, 6);
  });

  it('maps the midpoint date to the plot-area centre', () => {
    const mid = new Date((new Date('2026-03-19').getTime() + new Date('2026-05-20').getTime()) / 2);
    expect(s.dateToX(mid)).toBeCloseTo(210, 6);
  });

  it('xToDate is the inverse of dateToX', () => {
    const d = new Date('2026-04-15');
    expect(s.xToDate(s.dateToX(d)).getTime()).toBeCloseTo(d.getTime(), -2);
  });
});

describe('nodeToDate', () => {
  const mostRecent = '2026-05-20';

  it('uses the date annotation for a tip', () => {
    const d = nodeToDate({ isTip: true, annotations: { date: '2026-05-06', height_mean: 0.04 } }, mostRecent);
    expect(d.getTime()).toBe(new Date('2026-05-06').getTime());
  });

  it('uses mostRecentDate - height_mean (years) for an internal node', () => {
    const h = 0.1694922804893305;
    const d = nodeToDate({ isTip: false, annotations: { height_mean: h } }, mostRecent);
    const expected = new Date(new Date(mostRecent).getTime() - h * MS_PER_YEAR).getTime();
    expect(d.getTime()).toBeCloseTo(expected, -2);
  });

  it('returns null when no date can be resolved', () => {
    expect(nodeToDate({ isTip: false, annotations: {} }, mostRecent)).toBeNull();
    expect(nodeToDate(null, mostRecent)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot import from `./time-scale.js` (module/exports missing).

- [ ] **Step 3: Implement `src/time-scale.js`**

```js
// Pure date↔x scaling and phylogeny-node → calendar-date conversion.
// No DOM access; unit-tested in time-scale.test.js.

export const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * Build a linear scale from a calendar-date domain to a horizontal pixel range.
 * The pixel range is [padLeft, width - padRight], matching a plot area that has
 * the given left/right padding inside a panel of the given width.
 * @param {{minDate:string|Date, maxDate:string|Date, width:number, padLeft:number, padRight:number}} opts
 */
export function createTimeScale({ minDate, maxDate, width, padLeft, padRight }) {
  const t0 = ms(minDate);
  const t1 = ms(maxDate);
  const x0 = padLeft;
  const x1 = width - padRight;
  const span = t1 - t0 || 1;
  return {
    dateToX(date) { return x0 + ((ms(date) - t0) / span) * (x1 - x0); },
    xToDate(x)    { return new Date(t0 + ((x - x0) / (x1 - x0)) * span); },
    get range()   { return [x0, x1]; },
    get domain()  { return [new Date(t0), new Date(t1)]; },
  };
}

/**
 * Convert a PearTree node descriptor to a calendar Date, or null if unresolvable.
 * - Tip:           uses annotations.date (ISO string).
 * - Internal node: mostRecentDate − annotations.height_mean (years).
 * @param {object|null} descriptor  a PearTree node descriptor (from onNodeSelect)
 * @param {string|Date} mostRecentDate
 * @returns {Date|null}
 */
export function nodeToDate(descriptor, mostRecentDate) {
  if (!descriptor || !descriptor.annotations) return null;
  const a = descriptor.annotations;
  if (descriptor.isTip && a.date) return new Date(a.date);
  const h = parseFloat(a.height_mean);
  if (Number.isFinite(h)) return new Date(ms(mostRecentDate) - h * MS_PER_YEAR);
  return a.date ? new Date(a.date) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `time-scale` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/time-scale.js src/time-scale.test.js
git commit -m "Add pure time-scale module (date↔x + nodeToDate) with tests"
```

---

### Task 4: `tree-panel.js`

**Files:** Create `src/tree-panel.js`.

- [ ] **Step 1: Implement `src/tree-panel.js`**

```js
// Embeds PearTree via the global bundle (window.PearTreeEmbed) and exposes a
// small, app-facing interface. Locks the tree to fit-to-window with explicit
// paddings so its time axis aligns with the time-series panel.

const TREE_URL = 'https://artic-network.github.io/misc/Ituri_2026-05-28_HKY_EGC_rate1.2E-3.HIPSTR.ptree';

export const TREE_PAD_LEFT = 20;
export const TREE_PAD_RIGHT = 20;

/**
 * @param {string} containerId  id of the element to embed into
 * @returns {Promise<{selectByLocation, clear, onSelect}>}
 */
export async function createTreePanel(containerId) {
  if (!window.PearTreeEmbed) {
    throw new Error('PearTreeEmbed not found — is public/peartree.bundle.min.js loaded?');
  }
  const tree = await window.PearTreeEmbed.embed({
    container: containerId,
    treeUrl: TREE_URL,
    filename: 'Ituri.ptree',
    settings: {
      tipLabelShow: 'names',
      axisShow: 'time',
      nodeSize: '3',
      paddingLeft: String(TREE_PAD_LEFT),
      paddingRight: String(TREE_PAD_RIGHT),
      rootStubLength: '0',
      rootStemPct: '0',
    },
  });

  // Fit the whole tree once loaded (static-alignment baseline).
  tree.onTreeLoad(() => tree.fitToWindow());

  return {
    /** Highlight all tips whose location === loc. Returns match count. */
    selectByLocation(loc) { return tree.selectByAnnotation('location', loc); },
    /** Clear the selection. */
    clear() { tree.setSelection([]); },
    /** Subscribe to selection changes: cb({ target, selected, mrca }). */
    onSelect(cb) { return tree.onNodeSelect(cb); },
  };
}
```

- [ ] **Step 2: Wire a temporary smoke check into `src/main.js`**

Replace `src/main.js` with:

```js
import './style.css';
import { createTreePanel } from './tree-panel.js';

const tree = await createTreePanel('tree-body');
tree.onSelect((p) => console.log('tree select:', p.selected.length, 'tips; target:', p.target?.id ?? null));
window.__tree = tree;
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`, open `http://localhost:5173`.
Expected: the Ituri tree renders in the top-left panel; clicking a tip/clade logs `tree select: N tips…`; in the console, `__tree.selectByLocation('Bunia')` highlights the Bunia tips and returns `7`.

- [ ] **Step 4: Commit**

```bash
git add src/tree-panel.js src/main.js
git commit -m "Add tree panel embedding PearTree with fit-to-window + paddings"
```

---

### Task 5: `map-panel.js`

**Files:** Create `src/map-panel.js`.

- [ ] **Step 1: Implement `src/map-panel.js`**

```js
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// A Leaflet map with one circle marker per location. Marker radius scales with
// tip count. Clicking a marker emits its location; highlight() restyles markers.

const BASE_STYLE      = { color: '#2b6', fillColor: '#2b6', fillOpacity: 0.5, weight: 1 };
const HIGHLIGHT_STYLE = { color: '#d33', fillColor: '#f55', fillOpacity: 0.85, weight: 2 };

/**
 * @param {string} containerId
 * @param {Record<string,{lat:number,lon:number}>} locations
 * @param {Record<string,number>} counts  tip count per location (for marker size)
 */
export function createMapPanel(containerId, locations, counts) {
  const map = L.map(containerId, { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 12,
  }).addTo(map);

  const markers = new Map();          // location -> L.CircleMarker
  const latlngs = [];
  for (const [loc, { lat, lon }] of Object.entries(locations)) {
    const n = counts[loc] || 1;
    const m = L.circleMarker([lat, lon], { ...BASE_STYLE, radius: 6 + 3 * Math.sqrt(n) })
      .addTo(map)
      .bindTooltip(`${loc} (${counts[loc] || 0})`);
    markers.set(loc, m);
    latlngs.push([lat, lon]);
  }
  if (latlngs.length) map.fitBounds(latlngs, { padding: [30, 30] });

  let clickHandler = null;
  for (const [loc, m] of markers) m.on('click', () => clickHandler && clickHandler(loc));

  return {
    /** cb(location) when a marker is clicked. */
    onLocationClick(cb) { clickHandler = cb; },
    /** Highlight the given locations; reset the rest. */
    highlight(locs) {
      const set = new Set(locs);
      for (const [loc, m] of markers) m.setStyle(set.has(loc) ? HIGHLIGHT_STYLE : BASE_STYLE);
    },
    clearHighlight() { for (const m of markers.values()) m.setStyle(BASE_STYLE); },
  };
}
```

- [ ] **Step 2: Temporary smoke check** — replace `src/main.js` with:

```js
import './style.css';
import { createMapPanel } from './map-panel.js';

const [locations] = await Promise.all([
  fetch('/data/ituri-locations.json').then(r => r.json()),
]);
const counts = { Bunia: 7, 'ex-Bunia': 2, Hoho: 4, Lumumba: 1, Katwa: 1 };
const map = createMapPanel('map-body', locations, counts);
map.onLocationClick((loc) => console.log('map click:', loc));
window.__map = map;
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`.
Expected: the right panel shows an OpenStreetMap with 5 circle markers (Bunia largest); clicking one logs `map click: <loc>`; `__map.highlight(['Bunia'])` in the console turns the Bunia marker red.

- [ ] **Step 4: Commit**

```bash
git add src/map-panel.js src/main.js
git commit -m "Add Leaflet map panel with location markers + highlight"
```

---

### Task 6: `timeseries-panel.js`

**Files:** Create `src/timeseries-panel.js`.

- [ ] **Step 1: Implement `src/timeseries-panel.js`**

```js
import { createTimeScale } from './time-scale.js';

// Renders the placeholder time-series as an SVG line, sharing a date→x scale
// with the tree panel. setMarkers(dates) draws dashed vertical lines (one per
// selected-node date), aligned to the same time axis.

const SVNS = 'http://www.w3.org/2000/svg';
const PAD = { left: 20, right: 20, top: 8, bottom: 22 };

const el = (name, attrs) => {
  const n = document.createElementNS(SVNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * @param {string} containerId
 * @param {{date:string,value:number}[]} series
 * @param {{minDate:string,maxDate:string}} domain  shared time domain (root → most-recent)
 */
export function createTimeseriesPanel(containerId, series, domain) {
  const host = document.getElementById(containerId);
  const W = host.clientWidth || 400;
  const H = host.clientHeight || 200;

  const svg = el('svg', { width: W, height: H });
  host.appendChild(svg);

  const scale = createTimeScale({
    minDate: domain.minDate, maxDate: domain.maxDate,
    width: W, padLeft: PAD.left, padRight: PAD.right,
  });

  const yMax = Math.max(1, ...series.map(d => d.value));
  const yToPx = (v) => (H - PAD.bottom) - (v / yMax) * (H - PAD.top - PAD.bottom);

  // axis baseline
  svg.appendChild(el('line', {
    x1: PAD.left, y1: H - PAD.bottom, x2: W - PAD.right, y2: H - PAD.bottom,
    stroke: '#999', 'stroke-width': 1,
  }));

  // series polyline
  const pts = series.map(d => `${scale.dateToX(d.date)},${yToPx(d.value)}`).join(' ');
  svg.appendChild(el('polyline', { points: pts, fill: 'none', stroke: '#3a7', 'stroke-width': 2 }));

  // layer for dashed markers (cleared/redrawn on selection)
  const markerLayer = el('g', {});
  svg.appendChild(markerLayer);

  return {
    /** Draw a dashed vertical line for each Date in `dates` (empty array clears). */
    setMarkers(dates) {
      markerLayer.replaceChildren();
      for (const d of dates) {
        if (!d) continue;
        const x = scale.dateToX(d);
        markerLayer.appendChild(el('line', {
          x1: x, y1: PAD.top, x2: x, y2: H - PAD.bottom,
          stroke: '#d33', 'stroke-width': 1.5, 'stroke-dasharray': '4 3',
        }));
      }
    },
  };
}
```

- [ ] **Step 2: Temporary smoke check** — replace `src/main.js` with:

```js
import './style.css';
import { createTimeseriesPanel } from './timeseries-panel.js';

const [series, meta] = await Promise.all([
  fetch('/data/timeseries.json').then(r => r.json()),
  fetch('/data/ituri-meta.json').then(r => r.json()),
]);
const ts = createTimeseriesPanel('timeseries-body', series, { minDate: meta.rootDate, maxDate: meta.mostRecentDate });
ts.setMarkers([new Date('2026-05-06')]);
window.__ts = ts;
```

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`.
Expected: the bottom-left panel shows a green line (rise then fall) with an x-axis baseline and one red dashed vertical line near early-May; `__ts.setMarkers([])` clears it.

- [ ] **Step 4: Commit**

```bash
git add src/timeseries-panel.js src/main.js
git commit -m "Add time-series panel (SVG line + dashed date markers)"
```

---

### Task 7: `coordinator.js` + full wire-up

**Files:** Create `src/coordinator.js`; finalize `src/main.js`.

- [ ] **Step 1: Implement `src/coordinator.js`**

```js
import { nodeToDate } from './time-scale.js';

// Wires the three panels together. Holds the echo-loop guard so a map-driven
// selection does not bounce back and re-drive the map.

/**
 * @param {object} tree   from createTreePanel
 * @param {object} map    from createMapPanel
 * @param {object} ts     from createTimeseriesPanel
 * @param {{mostRecentDate:string}} meta
 */
export function startCoordinator(tree, map, ts, meta) {
  let programmatic = false;   // true while we are driving the tree from the map

  // map → tree
  map.onLocationClick((loc) => {
    programmatic = true;
    tree.selectByLocation(loc);
  });

  // tree → map + time-series
  tree.onSelect(({ target, selected, mrca }) => {
    // time-series: dashed line at the selected node's date
    const node = target || mrca || null;
    const d = nodeToDate(node, meta.mostRecentDate);
    ts.setMarkers(d ? [d] : []);

    // map: highlight the locations present in the selection (skip when the map
    // itself triggered this selection — it is already showing the click).
    if (!programmatic) {
      const locs = new Set(selected.map(n => n.annotations?.location).filter(Boolean));
      map.highlight([...locs]);
    }
    programmatic = false;

    if (selected.length === 0) { map.clearHighlight(); ts.setMarkers([]); }
  });
}
```

- [ ] **Step 2: Finalize `src/main.js`**

```js
import './style.css';
import { createTreePanel } from './tree-panel.js';
import { createMapPanel } from './map-panel.js';
import { createTimeseriesPanel } from './timeseries-panel.js';
import { startCoordinator } from './coordinator.js';

const [tips, locations, meta, series] = await Promise.all([
  fetch('/data/ituri-tips.json').then(r => r.json()),
  fetch('/data/ituri-locations.json').then(r => r.json()),
  fetch('/data/ituri-meta.json').then(r => r.json()),
  fetch('/data/timeseries.json').then(r => r.json()),
]);

// tip counts per location (marker sizing)
const counts = {};
for (const t of tips) counts[t.location] = (counts[t.location] || 0) + 1;

const map = createMapPanel('map-body', locations, counts);
const ts  = createTimeseriesPanel('timeseries-body', series, { minDate: meta.rootDate, maxDate: meta.mostRecentDate });
const tree = await createTreePanel('tree-body');

startCoordinator(tree, map, ts, meta);
```

- [ ] **Step 3: Run unit tests (ensure nothing regressed)**

Run: `npm test`
Expected: PASS — the `time-scale` tests still green.

- [ ] **Step 4: Full manual verification**

Run: `npm run dev`, open `http://localhost:5173`. Confirm:
1. All three panels populate: tree (top-left), time-series line (bottom-left), map with 5 markers (right).
2. Click a **map marker** (e.g. Bunia) → the Bunia tips highlight in the tree; the map keeps Bunia visibly clicked (no flicker/loop).
3. Click an **internal node** in the tree → its descendant tips' locations highlight on the map AND a red dashed line appears on the time-series at the node's date.
4. Click a **single tip** → a dashed line appears at that tip's `date`; the time-series x-axis is visually aligned with the tree's time axis at the fitted view.
5. Click empty space in the tree → map highlight clears and the dashed line disappears.

- [ ] **Step 5: Commit**

```bash
git add src/coordinator.js src/main.js
git commit -m "Wire panels together via coordinator (two-way + date marker)"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Task 1 → project setup + layout + bundle consumption; Task 2 → data layer (tips/locations/meta/timeseries); Task 3 → pure time-scale + nodeToDate (Vitest); Task 4 → tree-panel (fit-to-window, paddings, selectByLocation/onSelect/clear); Task 5 → map-panel (markers, click, highlight); Task 6 → timeseries-panel (line + dashed markers, shared scale); Task 7 → coordinator (two-way, echo guard, node→date marker) + manual verification matching the spec's checklist. All spec sections covered.
- **Static alignment caveat (spec §5):** the time-series uses the same `[rootDate, mostRecentDate]` domain and 20px left/right padding as the tree embed, with `rootStubLength:0`/`rootStemPct:0` to minimise offset. Alignment is approximate, as the spec acknowledges.
- **Type/name consistency:** `createTreePanel`/`createMapPanel`/`createTimeseriesPanel`/`startCoordinator`; panel container ids `tree-body`/`map-body`/`timeseries-body`; `time-scale.js` exports `createTimeScale`, `nodeToDate`, `MS_PER_YEAR` — all used consistently across tasks.
- **Echo guard:** set in the map click handler, cleared at the end of the tree `onSelect` handler; the handler skips `map.highlight` while `programmatic` is true.
- **Leaflet icon note:** uses `circleMarker` (no marker-image assets), avoiding the well-known Vite/Leaflet icon-path pitfall.
