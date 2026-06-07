# "Show beyond" Histogram Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Show beyond" toggle to the Sample-distribution histogram that extends its time axis to the latest plotted date in the current selection (Ct-filter-aware), keeping the chart and tree axes aligned by compressing only the tree canvas — never the toolbar.

**Architecture:** A pure, Ct-aware `extentFraction()` computes the effective max date and the fraction `f` the tree must shrink to. The timeseries panel renders to that effective max and calls `onExtentChange(f)`; `main.js` routes it to `tree.setWidthFraction(f)`, which insets PearTree's `#canvas-container` (sibling of the toolbar). PearTree's ResizeObserver refits and re-emits the transform the chart locks onto.

**Tech Stack:** Vanilla ES modules + Vite; PearTree embed (`window.PearTreeEmbed`); Vitest (`src/*.test.js`, `environment: node`).

Spec: `docs/superpowers/specs/2026-06-06-histogram-show-beyond-tree.md`.

---

## File structure

| File | New/Modify | Responsibility |
|---|---|---|
| `src/timeseries-panel.js` | Modify | Export pure `ctPass`/`extentFraction`/`STATUS_SET`; toggle + `showBeyond` state; `effMaxMs` + `applyExtent`; render to `effMax`; `onExtentChange` option |
| `src/timeseries-panel.test.js` | Create | Unit tests for `ctPass` + `extentFraction` (node, no DOM) |
| `src/tree-panel.js` | Modify | `setWidthFraction(f)` — inset `#canvas-container` |
| `src/main.js` | Modify | Wire `ts` `onExtentChange` → `tree.setWidthFraction` (late-bound) |
| `index.html` | Modify | "Show beyond" button in the panel header |
| `src/style.css` | Modify | `.dist-download.active` (toggle-on state) |

---

## Task 1: Pure Ct-aware extent helpers

Move `ctPass` to module scope (exported, pure) and add the exported `extentFraction`. Behaviour of the app is unchanged after this task (render still uses `t1`); only the internals are refactored and the new helper added + tested.

**Files:**
- Modify: `src/timeseries-panel.js`
- Test: `src/timeseries-panel.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/timeseries-panel.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { ctPass, extentFraction } from './timeseries-panel.js';

const T0 = +new Date('2026-04-05');   // tree root
const T1 = +new Date('2026-05-20');   // tree most-recent
const row = (date, status = 'Positive', ct = '24') => ({ date, status, ct });

describe('ctPass', () => {
  it('passes non-positives regardless of Ct', () => {
    expect(ctPass(row('2026-05-01', 'Negative', ''), 30)).toBe(true);
  });
  it('passes positives when the filter is off (ct null)', () => {
    expect(ctPass(row('2026-05-01', 'Positive', '40'), null)).toBe(true);
  });
  it('filters positives at/above the threshold or without a numeric Ct', () => {
    expect(ctPass(row('2026-05-01', 'Positive', '33'), 30)).toBe(false);
    expect(ctPass(row('2026-05-01', 'Positive', ''), 30)).toBe(false);
    expect(ctPass(row('2026-05-01', 'Positive', '24'), 30)).toBe(true);
  });
});

describe('extentFraction', () => {
  it('off → effMax=t1, f=1', () => {
    const r = [row('2026-06-03')];
    expect(extentFraction(r, T0, T1, false, null)).toEqual({ effMax: T1, f: 1 });
  });
  it('on with a later row → extends and shrinks proportionally', () => {
    const { effMax, f } = extentFraction([row('2026-06-03')], T0, T1, true, null);
    expect(effMax).toBe(+new Date('2026-06-03'));
    expect(f).toBeCloseTo((T1 - T0) / (+new Date('2026-06-03') - T0), 4);  // ~0.763
  });
  it('on but no row past t1 → f=1', () => {
    expect(extentFraction([row('2026-05-10')], T0, T1, true, null).f).toBe(1);
  });
  it('a beyond-tree positive hidden by the Ct filter does NOT extend', () => {
    expect(extentFraction([row('2026-06-03', 'Positive', '35')], T0, T1, true, 30).effMax).toBe(T1);
  });
  it('the same point extends when the filter is off / below threshold', () => {
    expect(extentFraction([row('2026-06-03', 'Positive', '35')], T0, T1, true, null).effMax)
      .toBe(+new Date('2026-06-03'));
  });
  it('a beyond-tree non-positive still extends (it is plotted)', () => {
    expect(extentFraction([row('2026-06-03', 'Negative', '')], T0, T1, true, 30).effMax)
      .toBe(+new Date('2026-06-03'));
  });
  it('ignores rows with a status not in STATUS', () => {
    expect(extentFraction([row('2026-06-03', 'Suspected', '')], T0, T1, true, null).effMax).toBe(T1);
  });
  it('clamps f to the floor for a far outlier', () => {
    const { f } = extentFraction([row('2027-01-01')], T0, T1, true, null);
    expect(f).toBe(0.4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/timeseries-panel.test.js`
Expected: FAIL — `ctPass`/`extentFraction` are not exported (import resolves but bindings are `undefined`).

- [ ] **Step 3: Add the exported helpers and refactor `ctPass`**

In `src/timeseries-panel.js`, add a module-scope `STATUS_SET` right after the existing `STATUS` array (near the top, after `const STATUS = [...]`):

```js
const STATUS_SET = new Set(STATUS);
```

Add these two exported pure functions at module scope (e.g. just below `STATUS_SET`):

```js
/** A row passes the Ct filter when: the filter is off (ct null), or it isn't a positive,
 *  or it's a positive with a numeric Ct strictly below the threshold. */
export function ctPass(r, ct) {
  if (ct == null || r.status !== 'Positive') return true;
  const v = parseFloat(r.ct);
  return Number.isFinite(v) && v < ct;
}

/** Latest *plotted* date for the given rows + the tree-width fraction it implies.
 *  Uses the same filter as the bars (status-valid AND ctPass), so a Ct-hidden point
 *  never extends the axis. rows: selection-filtered rows; t0/t1: domain ms; on: showBeyond;
 *  ct: current Ct threshold or null. Returns { effMax (ms), f∈[F_MIN,1] }. */
export function extentFraction(rows, t0, t1, on, ct = null, F_MIN = 0.4) {
  let effMax = t1;
  if (on) for (const r of rows) {
    if (!STATUS_SET.has(r.status) || !ctPass(r, ct)) continue;
    const t = +new Date(r.date);
    if (!isNaN(t) && t > effMax) effMax = t;
  }
  const f = effMax > t0 ? Math.max(F_MIN, Math.min(1, (t1 - t0) / (effMax - t0))) : 1;
  return { effMax, f };
}
```

Now delete the old closure `ctPass` inside `createTimeseriesPanel` (the block):

```js
  // A Positive row passes the Ct filter only if it has a numeric Ct below the threshold
  // (so no-Ct positives drop out while the filter is on). Non-positives always pass.
  function ctPass(r) {
    if (ctThreshold == null || r.status !== 'Positive') return true;
    const v = parseFloat(r.ct);
    return Number.isFinite(v) && v < ctThreshold;
  }
```

and update its one caller in `aggregate()` from `if (!ctPass(r)) continue;` to:

```js
      if (!ctPass(r, ctThreshold)) continue;                 // Ct filter (positives only)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/timeseries-panel.test.js && npm test`
Expected: PASS (new suite + all existing).

- [ ] **Step 5: Commit**

```bash
git add src/timeseries-panel.js src/timeseries-panel.test.js
git commit -m "Add pure Ct-aware ctPass + extentFraction helpers"
```

---

## Task 2: Tree canvas compression (`setWidthFraction`)

Add a method that compresses **only** PearTree's `#canvas-container` (a sibling of the toolbar), so the tree re-fits narrower while the toolbar keeps full width.

**Files:**
- Modify: `src/tree-panel.js`

- [ ] **Step 1: Add the `WIDTH_FLOOR` constant**

Near the top of `src/tree-panel.js`, after `export const TREE_PAD_RIGHT = 20;`, add:

```js
// Hard floor on how far the tree canvas may compress (defensive; the chart's
// extentFraction already clamps to 0.4). 1 = full width.
const WIDTH_FLOOR = 0.3;
```

- [ ] **Step 2: Add `setWidthFraction` to the returned API**

In the `return { ... }` object of `createTreePanel`, add this method (place it after `getViewTransform`):

```js
    /**
     * Compress the tree CANVAS to fraction f∈[WIDTH_FLOOR,1] of its width by insetting
     * PearTree's #canvas-container (a sibling of the toolbar, so the toolbar is untouched).
     * PearTree's own ResizeObserver refits the tree and re-emits the view transform, which
     * the time-series panel locks onto. f≈1 restores full width.
     */
    setWidthFraction(f) {
      const cc = document.getElementById('canvas-container');
      if (!cc) return;                                          // tree not embedded yet → no-op
      const frac = Math.max(WIDTH_FLOOR, Math.min(1, f || 1));
      cc.style.marginRight = frac >= 1 ? '' : `${((1 - frac) * 100).toFixed(3)}%`;
    },
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: succeeds. (No unit test — this is DOM/Leaflet-free but PearTree-runtime; verified manually in Task 5.)

- [ ] **Step 4: Commit**

```bash
git add src/tree-panel.js
git commit -m "Add tree.setWidthFraction (compress #canvas-container, toolbar untouched)"
```

---

## Task 3: Timeseries panel — toggle, effective max, render

Add the toggle + `showBeyond` state, the `onExtentChange` option, the `effMaxMs` + `applyExtent()` machinery, and switch the render's right extent from `t1` to `effMaxMs`.

**Files:**
- Modify: `index.html`
- Modify: `src/timeseries-panel.js`
- Modify: `src/style.css`

- [ ] **Step 1: Add the toggle button to the header (`index.html`)**

Find:
```html
      <div id="timeseries" class="panel"><h3>Sample distribution <span id="dist-scope" class="dist-scope"></span><span id="dist-note" class="dist-note"></span><button id="dist-download" class="dist-download" type="button" title="Download daily counts (CSV)">⤓ CSV</button></h3><div id="timeseries-body" class="panel-body"></div></div>
```
Replace with (adds `#dist-beyond` before the CSV button):
```html
      <div id="timeseries" class="panel"><h3>Sample distribution <span id="dist-scope" class="dist-scope"></span><span id="dist-note" class="dist-note"></span><button id="dist-beyond" class="dist-download" type="button" title="Show samples dated after the tree's latest tip">⤢ beyond</button><button id="dist-download" class="dist-download" type="button" title="Download daily counts (CSV)">⤓ CSV</button></h3><div id="timeseries-body" class="panel-body"></div></div>
```

- [ ] **Step 2: Add the `.active` toggle style (`src/style.css`)**

Find:
```css
.dist-download:hover { background: rgba(124, 29, 29, 0.16); }
```
Add immediately after it:
```css
.dist-download.active { background: var(--maroon); color: #fff; }
```

- [ ] **Step 3: Accept the `onExtentChange` option**

In `src/timeseries-panel.js`, change the constructor signature:
```js
export function createTimeseriesPanel(containerId, rows, domain, { onCtChange = () => {}, tips = [] } = {}) {
```
to:
```js
export function createTimeseriesPanel(containerId, rows, domain, { onCtChange = () => {}, tips = [], onExtentChange = () => {} } = {}) {
```

- [ ] **Step 4: Add `showBeyond` + `effMaxMs` + `applyExtent` state**

In `src/timeseries-panel.js`, find:
```js
  const t0 = +new Date(domain.minDate);
  const t1 = +new Date(domain.maxDate);
```
Add immediately after:
```js
  let showBeyond = false;            // toggle: extend the axis past the tree's latest date
  let effMaxMs = t1;                 // current effective right-edge date (ms); = t1 when off
  let extentRaf = 0;                 // rAF handle, coalesces tree-resize requests

  // Recompute the effective max + tree fraction from the current selection/Ct, push the
  // fraction to the tree (coalesced), and re-render. Render runs synchronously so the chart
  // updates even when f doesn't change (e.g. toggling off); the tree refit (if any) re-renders
  // again via setTransform once PearTree reports its new transform.
  function applyExtent() {
    const r = extentFraction(filteredRows(), t0, t1, showBeyond, ctThreshold);
    effMaxMs = r.effMax;
    if (extentRaf) cancelAnimationFrame(extentRaf);
    extentRaf = requestAnimationFrame(() => { extentRaf = 0; onExtentChange(r.f); });
    render();
  }
```

- [ ] **Step 5: Add the toggle-button wiring**

In `src/timeseries-panel.js`, find:
```js
  const downloadEl = document.getElementById('dist-download');
  if (downloadEl) downloadEl.onclick = downloadCsv;
```
Add immediately after:
```js
  const beyondEl = document.getElementById('dist-beyond');
  if (beyondEl) beyondEl.onclick = () => {
    showBeyond = !showBeyond;
    beyondEl.classList.toggle('active', showBeyond);
    applyExtent();
  };
```

- [ ] **Step 6: Route the row-changing handlers through `applyExtent`**

In `src/timeseries-panel.js`, make these four replacements (each changes a `render()` call to `applyExtent()` so the extent is recomputed whenever the plotted rows change):

1. The Ct input handler — find:
```js
    onCtChange(ctThreshold);   // keep the map's Positive metric in sync
    render();
```
replace with:
```js
    onCtChange(ctThreshold);   // keep the map's Positive metric in sync
    applyExtent();
```

2. Zone button — find `btnZone.onclick = () => { mode = 'zone'; updateToggleUI(); render(); };`
replace with `btnZone.onclick = () => { mode = 'zone'; updateToggleUI(); applyExtent(); };`

3. Area button — find `btnArea.onclick = () => { if (sel.areas.length === 0) return; mode = 'area'; updateToggleUI(); render(); };`
replace with `btnArea.onclick = () => { if (sel.areas.length === 0) return; mode = 'area'; updateToggleUI(); applyExtent(); };`

4. `setSelection` — find:
```js
      if (mode === 'area' && sel.areas.length === 0) mode = 'zone';   // no areas → fall back to zone
      updateToggleUI();
      render();
```
replace with:
```js
      if (mode === 'area' && sel.areas.length === 0) mode = 'zone';   // no areas → fall back to zone
      updateToggleUI();
      applyExtent();
```

- [ ] **Step 7: Use `effMaxMs` as the render right-extent**

In `src/timeseries-panel.js` `render()`, find:
```js
    const xMax = scale.dateToX(domain.maxDate);
```
replace with:
```js
    const xMax = scale.dateToX(new Date(effMaxMs));   // extends past the tree when showBeyond
```

And find the tick loop header:
```js
    for (const { date, fmt } of timeTicks(Math.abs(xMax - xMin), t0, t1)) {
```
replace with:
```js
    for (const { date, fmt } of timeTicks(Math.abs(xMax - xMin), t0, effMaxMs)) {
```

- [ ] **Step 8: Extend `aggregate()` and `updateNote()` to `effMaxMs`**

In `aggregate()`, find:
```js
      if (isNaN(t) || t < t0 || t > t1) continue;            // clip to the aligned axis
```
replace with:
```js
      if (isNaN(t) || t < t0 || t > effMaxMs) continue;      // clip to the (possibly extended) axis
```

In `updateNote()`, find:
```js
      else if (t > t1) after++;
```
replace with:
```js
      else if (t > effMaxMs) after++;
```
And find:
```js
    if (after) parts.push(`${after} after ${fmtDay(t1)}`);
```
replace with:
```js
    if (after) parts.push(`${after} after ${fmtDay(effMaxMs)}`);
```

(Leave `seqByDate()` clipping at `t1` — tree tips never post-date `most-recent`.)

- [ ] **Step 9: Verify build + tests**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass. (Standalone, `tree.setWidthFraction` isn't wired yet — toggling will extend the axis but the tree won't compress until Task 4; that's expected mid-plan.)

- [ ] **Step 10: Commit**

```bash
git add index.html src/timeseries-panel.js src/style.css
git commit -m "Add 'Show beyond' toggle: extend chart axis to the selection's latest date"
```

---

## Task 4: Wire the chart extent to the tree

Connect `ts`'s `onExtentChange` to `tree.setWidthFraction` so toggling/selecting compresses the tree canvas and the axes stay aligned.

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Late-bind the tree and pass `onExtentChange`**

In `src/main.js`, find:
```js
const ts  = createTimeseriesPanel('timeseries-body', linelist, { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, { onCtChange: (t) => map.setCtThreshold(t), tips: seqTips });
const tree = await createTreePanel('tree-body');
```
replace with (a mutable holder lets `ts`, created first, call the tree once it exists):
```js
let treePanel = null;
const ts  = createTimeseriesPanel('timeseries-body', linelist, { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, { onCtChange: (t) => map.setCtThreshold(t), tips: seqTips, onExtentChange: (f) => treePanel?.setWidthFraction(f) });
const tree = await createTreePanel('tree-body');
treePanel = tree;
```

- [ ] **Step 2: Verify build**

Run: `npm run build && npm test`
Expected: build succeeds; tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/main.js
git commit -m "Wire chart 'show beyond' extent to tree.setWidthFraction"
```

---

## Task 5: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Automated**

Run: `npm test && npm run build`
Expected: all suites pass; build succeeds.

- [ ] **Step 2: Manual pass (`npm run dev`)**

Confirm:
1. "⤢ beyond" button appears in the Sample-distribution header; off by default; the chart looks unchanged (axis ends at the tree's latest date).
2. Toggle **on** with no selection → the chart axis extends to early June, post-May-20 bars appear, the **tree canvas compresses to ~76%** while the **PearTree toolbar stays full width**, and the two time axes still line up over the shared period. The "N not shown … after …" note drops its "after" bucket.
3. Select a zone → extent + tree width track that zone's latest date (the tree re-fits on each selection — expected).
4. Turn the **Ct< filter** on to a value that hides the latest beyond-tree positive → the axis/tree retract to exclude it (no empty tail).
5. Toggle **off** → tree returns to full width; axis clamps to the tree's latest date.
6. Resize the window → alignment holds in both states.

- [ ] **Step 3: Complete the branch**

Then complete with **superpowers:finishing-a-development-branch**.

---

## Notes for the implementer

- The chart's x-scale is unchanged: `buildScale()` still anchors `domain.maxDate → the tree's right content edge` and **extrapolates** later dates. Compressing the tree moves that edge left, so the extrapolated beyond-bars fall into the freed space — already aligned. Do **not** re-anchor the scale to `effMax`.
- `setWidthFraction` and `extentFraction` both clamp, with different floors on purpose: `extentFraction` enforces the real `F_MIN = 0.4`; `setWidthFraction`'s `WIDTH_FLOOR = 0.3` is just a defensive bound.
- One-frame flash is expected: `applyExtent` renders synchronously against the *current* transform, then the tree refit re-renders via `setTransform`. Don't try to remove the synchronous render — it's what updates the chart when `f` doesn't change (e.g. toggling off at full width).
- Internal-coupling note: `setWidthFraction` targets PearTree's global `#canvas-container`, the same style of coupling as the existing `#tree-canvas` dblclick handler and `#legend-annotation` toggle.
