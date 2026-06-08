# Time-window Brush Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A horizontal brush on the Sample-distribution histogram selects a time window that filters the map (choropleth counts + markers) and draws a shaded band over the tree, with click-to-clear.

**Architecture:** A pure `tallyZones(rows, window)` (extracted from `main.js`) feeds both the initial render and `map.setDateWindow()`. The histogram brush emits `onWindowChange(d0,d1|null)`; `main.js` routes it to `map.setDateWindow` and `tree.setTimeBand`. The tree band is a `pointer-events:none` overlay positioned by the tree's view transform.

**Tech Stack:** Vanilla ES modules + Vite; Leaflet; PearTree embed; Vitest (`src/*.test.js`, `environment: node`).

Spec: `docs/superpowers/specs/2026-06-08-time-window-brush.md`.

---

## File structure

| File | New/Modify | Responsibility |
|---|---|---|
| `src/zone-tally.js` | Create | Pure `tallyZones(rows, window)` → `{zoneCounts, zonePosCt}` |
| `src/zone-tally.test.js` | Create | Unit tests for `tallyZones` |
| `src/main.js` | Modify | Use `tallyZones`; pass `rows` to map + `meta` to tree; wire `onWindowChange` |
| `src/map-panel.js` | Modify | Dynamic counts; `rows`; `group.dates`; `setDateWindow()` |
| `src/tree-panel.js` | Modify | `meta` param; `setTimeBand()` overlay |
| `src/timeseries-panel.js` | Modify | `brushWindow()` helper; brush handlers; persistent band; `onWindowChange` option |
| `src/timeseries-panel.test.js` | Modify | Tests for `brushWindow` |
| `src/style.css` | Modify | `.tree-time-band`, `.dist-brush-live` |

---

## Task 1: Pure `tallyZones` helper + main.js refactor

**Files:**
- Create: `src/zone-tally.js`, `src/zone-tally.test.js`
- Modify: `src/main.js`

- [ ] **Step 1: Write the failing tests** — `src/zone-tally.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { tallyZones } from './zone-tally.js';

const D = (s) => +new Date(s);
const rows = [
  { health_zone: 'Bunia', status: 'Positive', date: '2026-05-01', ct: '24' },
  { health_zone: 'Bunia', status: 'Positive', date: '2026-06-01', ct: '30' },
  { health_zone: 'Bunia', status: 'Negative', date: '2026-05-01', ct: '' },
  { health_zone: 'Katwa', status: 'Positive', date: '2026-05-01', ct: '' },   // no Ct → not in posCt
  { health_zone: 'Bunia', status: 'Positive', date: '',           ct: '22' }, // undated
  { health_zone: '',      status: 'Positive', date: '2026-05-01', ct: '20' }, // no zone → dropped
  { health_zone: 'Bunia', status: 'Suspected', date: '2026-05-01', ct: '' },  // non-status → counts skip
];

describe('tallyZones', () => {
  it('full tally: counts by status + positive Ct lists, keyed by UPPER Nom', () => {
    const { zoneCounts, zonePosCt } = tallyZones(rows, null);
    expect(zoneCounts.get('BUNIA')).toEqual({ Positive: 3, Negative: 1, Invalid: 0, Unclassified: 0, total: 4 });
    expect(zoneCounts.get('KATWA')).toEqual({ Positive: 1, Negative: 0, Invalid: 0, Unclassified: 0, total: 1 });
    expect(zonePosCt.get('BUNIA').sort((a,b)=>a-b)).toEqual([22, 24, 30]); // 3 positives w/ numeric Ct
    expect(zonePosCt.has('KATWA')).toBe(false);                            // Katwa positive had no Ct
  });
  it('window excludes out-of-window AND undated rows (inclusive bounds)', () => {
    const { zoneCounts, zonePosCt } = tallyZones(rows, { d0: D('2026-05-01'), d1: D('2026-05-31') });
    expect(zoneCounts.get('BUNIA')).toEqual({ Positive: 1, Negative: 1, Invalid: 0, Unclassified: 0, total: 2 });
    expect(zonePosCt.get('BUNIA')).toEqual([24]);                          // 30 (Jun) + 22 (undated) excluded
  });
  it('empty window yields empty maps', () => {
    const { zoneCounts } = tallyZones(rows, { d0: D('2027-01-01'), d1: D('2027-02-01') });
    expect(zoneCounts.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/zone-tally.test.js` → FAIL (module not found).

- [ ] **Step 3: Create `src/zone-tally.js`:**

```js
// src/zone-tally.js
// Tally line-list rows into per-zone status counts + positive-Ct lists, optionally
// restricted to a time window. Pure (no DOM); shared by the initial render and the
// brush's windowed recompute. Rows carry a canonical health_zone (parseLinelist applies it).
const ZONE_STATUS = ['Positive', 'Negative', 'Invalid', 'Unclassified'];
const up = (s) => (s || '').toUpperCase().trim();

/**
 * @param {{health_zone:string,status:string,date:string,ct:string}[]} rows
 * @param {{d0:number,d1:number}|null} window  inclusive ms bounds, or null for all rows
 * @returns {{ zoneCounts: Map<string,object>, zonePosCt: Map<string,number[]> }}  keyed by UPPER Nom
 */
export function tallyZones(rows, window = null) {
  const zoneCounts = new Map();
  const zonePosCt = new Map();
  for (const r of rows) {
    if (window) {
      const t = +new Date(r.date);
      if (isNaN(t) || t < window.d0 || t > window.d1) continue;   // undated / out-of-window dropped
    }
    const z = up(r.health_zone);
    if (!z) continue;
    if (ZONE_STATUS.includes(r.status)) {
      let o = zoneCounts.get(z);
      if (!o) { o = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0, total: 0 }; zoneCounts.set(z, o); }
      o[r.status]++; o.total++;
    }
    if (r.status === 'Positive') {
      const v = parseFloat(r.ct);
      if (Number.isFinite(v)) {
        if (!zonePosCt.has(z)) zonePosCt.set(z, []);
        zonePosCt.get(z).push(v);
      }
    }
  }
  return { zoneCounts, zonePosCt };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/zone-tally.test.js && npm test` → PASS.

- [ ] **Step 5: Refactor `main.js` to use it.** Replace the two inline tally loops:

Find (the `zoneCounts` loop AND the `zonePosCt` loop — the whole block):
```js
const ZONE_STATUS = ['Positive', 'Negative', 'Invalid', 'Unclassified'];
const zoneCounts = new Map();
for (const r of linelist) {
  const z = (r.health_zone || '').toUpperCase().trim();
  if (!z || !ZONE_STATUS.includes(r.status)) continue;
  if (!zoneCounts.has(z)) zoneCounts.set(z, { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0, total: 0 });
  const o = zoneCounts.get(z); o[r.status]++; o.total++;
}

// Per-zone Positive Ct values, for the map's Ct-filtered Positive metric.
const zonePosCt = new Map();
for (const r of linelist) {
  if (r.status !== 'Positive') continue;
  const v = parseFloat(r.ct);
  if (!Number.isFinite(v)) continue;
  const z = (r.health_zone || '').toUpperCase().trim();
  if (!z) continue;
  if (!zonePosCt.has(z)) zonePosCt.set(z, []);
  zonePosCt.get(z).push(v);
}
```
Replace with:
```js
// Per-zone status counts + positive-Ct lists for the choropleth (full dataset; the brush
// re-tallies a window via map.setDateWindow).
const { zoneCounts, zonePosCt } = tallyZones(linelist);
```
And add the import at the top with the others:
```js
import { tallyZones } from './zone-tally.js';
```

- [ ] **Step 6: Verify** — `npm run build && npm test` → build OK, tests pass (the map looks identical — same initial tallies).

- [ ] **Step 7: Commit**
```bash
git add src/zone-tally.js src/zone-tally.test.js src/main.js
git commit -m "Extract tallyZones helper; main uses it for the initial choropleth"
```

---

## Task 2: Map — dynamic counts + `setDateWindow`

**Files:** Modify `src/map-panel.js`

- [ ] **Step 1: Import `tallyZones`** at the top of `src/map-panel.js` (after the existing imports):
```js
import { tallyZones } from './zone-tally.js';
```

- [ ] **Step 2: Add scope state.** Find:
```js
  let zonePosCt = new Map();         // upper Nom → positive-sample Ct values (for live re-counting)
```
Add immediately after:
```js
  let zoneCounts = new Map();        // upper Nom → {status counts} (dynamic; windowed by the brush)
  let linelistRows = [];             // retained for windowed re-tally (set in addZoneLayer)
  let applyCounts = null;            // recompute breaks + redraw after a re-tally (set in addZoneLayer)
```

- [ ] **Step 3: Store per-group tip dates.** Find the marker-group build:
```js
    if (!g) { g = { key, level: area ? 'area' : 'zone', lat: t.lat, lon: t.lon, tipIds: [] }; groups.set(key, g); }
    g.tipIds.push(t.id);
```
Replace with:
```js
    if (!g) { g = { key, level: area ? 'area' : 'zone', lat: t.lat, lon: t.lon, tipIds: [], dates: [] }; groups.set(key, g); }
    g.tipIds.push(t.id); g.dates.push(t.date);
```

- [ ] **Step 4: Make `addZoneLayer` seed the scope vars + retain rows.** Find:
```js
    addZoneLayer(geojson, zoneCounts = new Map(), posCt = new Map()) {
      const ZERO = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0, total: 0 };
      const countsOf = (f) => zoneCounts.get(upper(f.properties.Nom)) || ZERO;
      const intFmt = (x) => String(Math.round(x));
      zonePosCt = posCt;
```
Replace with (param renamed so it no longer shadows the scope `zoneCounts`; `rows` added):
```js
    addZoneLayer(geojson, seedCounts = new Map(), posCt = new Map(), rows = []) {
      const ZERO = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0, total: 0 };
      const countsOf = (f) => zoneCounts.get(upper(f.properties.Nom)) || ZERO;   // reads scope zoneCounts
      const intFmt = (x) => String(Math.round(x));
      zoneCounts = seedCounts; zonePosCt = posCt; linelistRows = rows;
```

- [ ] **Step 5: Expose the recompute hook.** Find the existing `applyCtThreshold = () => {...}` block:
```js
      applyCtThreshold = () => {
        recomputeBreaks(METRICS.Positive);
        if (metric === 'Positive') { restyle(); renderLegend(); }
      };
```
Add immediately after it:
```js
      // After a windowed re-tally: reclass every count metric and redraw.
      applyCounts = () => {
        for (const cfg of Object.values(METRICS)) recomputeBreaks(cfg);
        restyle(); renderLegend();
      };
```

- [ ] **Step 6: Add `setDateWindow` to the returned API.** Find:
```js
    /** Update per-zone to-sequence counts (upper Nom -> count) and redraw if shown. */
    setToSequence(byZone) { toSeqByZone = byZone || new Map(); applyToSeq?.(); },
```
Add immediately after:
```js
    /** Filter the choropleth + markers to a time window (inclusive ms bounds), or null = all.
     *  Re-tallies the line-list rows, reclasses, and shows/resizes markers by in-window count. */
    setDateWindow(d0, d1) {
      const win = (d0 != null && d1 != null) ? { d0: +d0, d1: +d1 } : null;
      const t = tallyZones(linelistRows, win);
      zoneCounts = t.zoneCounts; zonePosCt = t.zonePosCt;
      applyCounts?.();
      for (const { group, marker } of markers) {
        let n = group.tipIds.length;
        if (win) {
          n = 0;
          for (const ds of group.dates) { const tt = +new Date(ds); if (!isNaN(tt) && tt >= win.d0 && tt <= win.d1) n++; }
        }
        if (n === 0) { marker.setStyle({ opacity: 0, fillOpacity: 0 }); marker.options.interactive = false; }
        else {
          marker.setStyle({ opacity: 1, fillOpacity: BASE_STYLE.fillOpacity });
          marker.options.interactive = true;
          marker.setRadius(6 + 3 * Math.sqrt(n));
        }
      }
    },
```

- [ ] **Step 7: Verify** — `npm run build && npm test` → build OK, tests pass. (`setDateWindow` isn't called until Task 5; `addZoneLayer`'s new `rows` arg defaults `[]`, so the current call still works and the map is unchanged.)

- [ ] **Step 8: Commit**
```bash
git add src/map-panel.js
git commit -m "Map: dynamic zone counts + setDateWindow (windowed choropleth + markers)"
```

---

## Task 3: Tree — shaded time band overlay

**Files:** Modify `src/tree-panel.js`, `src/style.css`

- [ ] **Step 1: Add the band CSS** to `src/style.css` (append at end):
```css
/* Time-window band overlaid on the tree canvas (positioned by the view transform). */
.tree-time-band {
  position: absolute; top: 0; bottom: 0; z-index: 2; pointer-events: none;
  background: rgba(124, 29, 29, 0.10); border-left: 1px solid rgba(124, 29, 29, 0.45);
  border-right: 1px solid rgba(124, 29, 29, 0.45); display: none;
}
```

- [ ] **Step 2: Accept `meta`** in `createTreePanel`. Find:
```js
export async function createTreePanel(containerId) {
```
Replace with:
```js
export async function createTreePanel(containerId, meta = null) {
```

- [ ] **Step 3: Add the band element + positioning, before `return {`.** Find (the legend-toggle block ends just before `return {`):
```js
  legendBtn?.addEventListener('click', () => setLegend(!legendOn));

  return {
```
Insert between them:
```js
  // Shaded time-window band overlaid on the canvas. Positioned with the SAME date→x mapping
  // the histogram uses (root → offsetX, mostRecent → offsetX + maxX·scaleX), so it lines up
  // with the histogram's brush band. Repositioned on every view change; clamped to the tree's
  // date range so a "beyond" brush stops at the tree edge. pointer-events:none keeps the tree
  // clickable. Attached to #canvas-wrapper so its x-origin matches the transform.
  const t0 = meta ? +new Date(meta.rootDate) : 0;
  const t1 = meta ? +new Date(meta.mostRecentDate) : 0;
  let band = null, bandWin = null;     // { d0, d1 } in ms, or null
  function ensureBand() {
    if (band) return band;
    const wrap = document.getElementById('canvas-wrapper');
    if (!wrap) return null;
    band = document.createElement('div'); band.className = 'tree-time-band';
    wrap.appendChild(band);
    return band;
  }
  function positionBand() {
    const el = ensureBand();
    if (!el) return;
    const vt = tree.getViewTransform?.();
    if (!bandWin || !vt || !vt.maxX || t1 <= t0) { el.style.display = 'none'; return; }
    const x0 = vt.offsetX, span = vt.maxX * vt.scaleX;
    const dToX = (ms) => x0 + ((Math.max(t0, Math.min(t1, ms)) - t0) / (t1 - t0)) * span;
    const xL = dToX(bandWin.d0), xR = dToX(bandWin.d1);
    if (xR - xL < 0.5) { el.style.display = 'none'; return; }
    el.style.display = ''; el.style.left = `${xL}px`; el.style.width = `${xR - xL}px`;
  }
  tree.onViewChange(() => positionBand());   // track pan / zoom / resize
```

- [ ] **Step 4: Add `setTimeBand` to the returned API.** Find:
```js
    /** Snapshot the current view transform, or null. */
    getViewTransform() { return tree.getViewTransform(); },
```
Add immediately after:
```js
    /** Show/move the time-window band (inclusive ms bounds), or null to hide it. */
    setTimeBand(d0, d1) {
      bandWin = (d0 != null && d1 != null) ? { d0: +d0, d1: +d1 } : null;
      positionBand();
    },
```

- [ ] **Step 5: Verify** — `npm run build && npm test` → build OK, tests pass. (`setTimeBand` isn't called until Task 5; `createTreePanel` still works with the new optional `meta`.)

- [ ] **Step 6: Commit**
```bash
git add src/tree-panel.js src/style.css
git commit -m "Tree: setTimeBand overlay (canvas band positioned by the view transform)"
```

---

## Task 4: Histogram — the brush

**Files:** Modify `src/timeseries-panel.js`, `src/timeseries-panel.test.js`, `src/style.css`

- [ ] **Step 1: Write the failing test** for the pure brush helper — append to `src/timeseries-panel.test.js`:
```js
import { brushWindow } from './timeseries-panel.js';

describe('brushWindow', () => {
  const scale = { xToDate: (x) => new Date(+new Date('2026-04-05') + x * 86400000) };  // 1px = 1 day
  it('returns null for a click (drag below the px threshold)', () => {
    expect(brushWindow(100, 102, scale, 3)).toBeNull();
  });
  it('orders the window regardless of drag direction', () => {
    const a = brushWindow(10, 40, scale, 3);
    const b = brushWindow(40, 10, scale, 3);
    expect(a).toEqual(b);
    expect(a.d0).toBe(+scale.xToDate(10));
    expect(a.d1).toBe(+scale.xToDate(40));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/timeseries-panel.test.js` → FAIL (`brushWindow` undefined).

- [ ] **Step 3: Add the `brushWindow` export** to `src/timeseries-panel.js` (module scope, next to `extentFraction`):
```js
/** Convert a drag's start/end x (svg px) to an ordered time window, or null if the drag was
 *  too short to be a brush (a click → clear). `scale` exposes xToDate. */
export function brushWindow(x0, x1, scale, minPx = 3) {
  if (Math.abs(x1 - x0) < minPx) return null;
  return { d0: +scale.xToDate(Math.min(x0, x1)), d1: +scale.xToDate(Math.max(x0, x1)) };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/timeseries-panel.test.js` → PASS.

- [ ] **Step 5: Add the `onWindowChange` option + window state.** Change the constructor signature:
```js
export function createTimeseriesPanel(containerId, rows, domain, { onCtChange = () => {}, tips = [], onExtentChange = () => {} } = {}) {
```
to:
```js
export function createTimeseriesPanel(containerId, rows, domain, { onCtChange = () => {}, tips = [], onExtentChange = () => {}, onWindowChange = () => {} } = {}) {
```
Find `let showBeyond = false;` and add after it:
```js
  let win = null;                    // brushed time window { d0, d1 } in ms, or null
```

- [ ] **Step 6: Draw the persistent band in `render()`.** Find (just before the bars loop):
```js
    for (const [dateStr, counts] of byDay) {
      const x = scale.dateToX(dateStr) - barW / 2;
```
Insert immediately BEFORE that loop:
```js
    // Brushed time-window band (behind the bars; persists across re-renders, tracks the scale).
    if (win) {
      const bx0 = scale.dateToX(new Date(win.d0)), bx1 = scale.dateToX(new Date(win.d1));
      svg.appendChild(el('rect', { x: Math.min(bx0, bx1), y: PAD.top, width: Math.max(1, Math.abs(bx1 - bx0)),
        height: baseY - PAD.top, fill: 'rgba(124,29,29,0.10)', stroke: 'rgba(124,29,29,0.45)', 'stroke-width': 1 }));
    }
```

- [ ] **Step 7: Wire the brush on the persistent `holder`.** Find:
```js
  render();
  const ro = new ResizeObserver(() => render());
  ro.observe(host);
```
Insert BEFORE `render();`:
```js
  // Horizontal brush: drag on the chart to pick a time window; a click (tiny drag) clears it.
  // Listeners live on `holder` (persistent) since the svg is rebuilt each render; a live <rect>
  // is drawn directly during the drag (no re-render), finalised on mouseup.
  let drag = null;   // { x0, rect } while dragging
  const relX = (ev) => ev.clientX - holder.getBoundingClientRect().left;
  holder.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 || !scale) return;
    hideTip();
    const svgEl = holder.querySelector('svg');
    const rect = svgEl ? el('rect', { x: relX(ev), y: PAD.top, width: 0, height: H - PAD.bottom - PAD.top,
      fill: 'rgba(124,29,29,0.10)', stroke: 'rgba(124,29,29,0.45)', 'stroke-width': 1, 'pointer-events': 'none' }) : null;
    if (rect && svgEl) svgEl.appendChild(rect);
    drag = { x0: relX(ev), rect };
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const x = relX(ev), xl = Math.min(drag.x0, x), w = Math.abs(x - drag.x0);
    if (drag.rect) { drag.rect.setAttribute('x', xl); drag.rect.setAttribute('width', Math.max(0, w)); }
  });
  window.addEventListener('mouseup', (ev) => {
    if (!drag) return;
    const next = brushWindow(drag.x0, relX(ev), scale);
    drag = null;
    win = next;
    onWindowChange(next ? next.d0 : null, next ? next.d1 : null);
    render();   // draw the persistent band (or none) and drop the live rect
  });
```

- [ ] **Step 8: Verify** — `npm run build && npm test` → build OK, tests pass. (Brushing now shows a band on the histogram; the map/tree aren't wired until Task 5 — `onWindowChange` defaults to no-op.)

- [ ] **Step 9: Commit**
```bash
git add src/timeseries-panel.js src/timeseries-panel.test.js
git commit -m "Histogram: horizontal time-window brush (band + onWindowChange, click clears)"
```

---

## Task 5: Wire the brush to the map + tree

**Files:** Modify `src/main.js`

- [ ] **Step 1: Pass `rows` to the map.** Find:
```js
    map.addZoneLayer(zones, zoneCounts, zonePosCt);
```
Replace with:
```js
    map.addZoneLayer(zones, zoneCounts, zonePosCt, linelist);
```

- [ ] **Step 2: Pass `meta` to the tree + wire `onWindowChange`.** Find:
```js
const ts  = createTimeseriesPanel('timeseries-body', linelist, { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, { onCtChange: (t) => map.setCtThreshold(t), tips: seqTips, onExtentChange: (f) => treePanel?.setWidthFraction(f) });
tsPanel = ts;   // late-bind for the map → distribution Ct sync
const tree = await createTreePanel('tree-body');
```
Replace with:
```js
const ts  = createTimeseriesPanel('timeseries-body', linelist, { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, {
  onCtChange: (t) => map.setCtThreshold(t), tips: seqTips,
  onExtentChange: (f) => treePanel?.setWidthFraction(f),
  onWindowChange: (d0, d1) => { map.setDateWindow(d0, d1); treePanel?.setTimeBand(d0, d1); },
});
tsPanel = ts;   // late-bind for the map → distribution Ct sync
const tree = await createTreePanel('tree-body', meta);
```

- [ ] **Step 3: Verify** — `npm run build && npm test` → build OK, tests pass.

- [ ] **Step 4: Commit**
```bash
git add src/main.js
git commit -m "Wire histogram brush to map.setDateWindow + tree.setTimeBand"
```

---

## Task 6: Final verification

**Files:** none.

- [ ] **Step 1: Automated** — `npm test && npm run build` → all pass; build OK.

- [ ] **Step 2: Manual (`npm run dev`):**
  1. Drag a window on the histogram → a translucent band appears there; the **choropleth re-colours** to in-window counts; **markers** hide/resize to in-window sequences; a matching **band appears on the tree**, vertically aligned with the histogram band.
  2. **Pan/zoom** the tree (and resize the window) → the tree band tracks the axis.
  3. **Click** (no drag) on the histogram → window clears; map + tree band restore to the full dataset.
  4. **Compose:** with the window set, change the **Ct<** filter (Positive metric) → reflects in-window positives below Ct; select a **zone** → its outline/highlight still works alongside the window.
  5. **Beyond:** toggle "⤢ beyond", brush into the post-tree region → the map filters to the full window; the **tree band clamps** at the tree's right edge.

- [ ] **Step 3: Complete the branch** with **superpowers:finishing-a-development-branch**.

---

## Notes for the implementer

- The histogram band (in `render()`) and the tree band use the **same date→x mapping** (the tree's view transform), which is why they line up; do not anchor either to anything else.
- `setDateWindow`/`setTimeBand` take a single `null` (either arg) to mean "clear" — `main.js` passes `(null, null)` on a clear; both methods treat a missing bound as no-window.
- Marker hide uses `opacity:0`/`fillOpacity:0` + `interactive:false` (not removal) so the selection/highlight code (`highlight`, `clearHighlight`) keeps working on the surviving markers.
- `tallyZones` is the single source of truth for counts; never re-introduce an inline tally.
- Internal coupling: the tree band attaches to PearTree's `#canvas-wrapper` (same style of coupling as the existing `#tree-canvas`/`#canvas-container`/`#legend-annotation` usage).
