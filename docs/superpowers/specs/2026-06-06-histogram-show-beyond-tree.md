# "Show beyond" — extend the sample-distribution axis past the tree date

**Goal:** Add a toggle to the Sample-distribution histogram that reveals sample data dated *after* the phylogeny's most-recent tip, extending the chart's time axis while keeping the chart and tree time axes aligned — by compressing only the tree canvas (never the toolbar).

**Architecture:** The histogram's x-axis is locked to PearTree's view transform (root → most-recent maps to the canvas's left → right content edge). To show later dates without breaking alignment, the tree canvas is made narrower so its most-recent date sits inboard, freeing space on the right that the histogram's (already-extrapolating) scale fills. The compression targets PearTree's `#canvas-container` — a sibling of the toolbar — so the toolbar keeps full width.

**Tech stack:** Vanilla ES modules + Vite; PearTree embed (`window.PearTreeEmbed`); Vitest (`src/*.test.js`, `environment: node`).

---

## Background — how alignment works today

- `createTimeseriesPanel(containerId, rows, domain, …)` is given `domain = { minDate: meta.rootDate, maxDate: meta.mostRecentDate }`. Constants `t0 = +new Date(domain.minDate)`, `t1 = +new Date(domain.maxDate)`.
- The chart locks to the tree via `tree.onViewChange((t) => ts.setTransform(t))`. `buildScale()` anchors `domain.minDate → transform.offsetX` and `domain.maxDate → transform.offsetX + transform.maxX·transform.scaleX` (the tree's right **content** edge), via `scaleFromAnchors` — which does **not** clamp, so dates after `maxDate` extrapolate to x **beyond** the tree's right edge.
- Because the tree fills its canvas, that right edge is ~the panel's right edge, so extrapolated (post-`maxDate`) bars land off-screen. `aggregate()` also hard-clips rows to `[t0, t1]` (`if (t < t0 || t > t1) continue`), and `updateNote()` reports the excluded rows as "N after `<date>`".
- PearTree embed DOM (from `pearcore-embed.css`): `.pt-embed-wrap` is a **column** flex of `toolbar` / `#canvas-container` / `status-bar`. `#canvas-container` is `flex:1; display:flex` and already shrinks for pinned panels. PearTree's `ResizeObserver` watches `canvas.parentElement` (`#canvas-wrapper`, inside `#canvas-container`) and refits on size change, emitting `onViewChange`.

**Data fact (for sizing intuition):** tree spans ~45 d (2026-04-05 → 2026-05-20); the line-list runs ~14 d past that (to 2026-06-03; 636 samples beyond). So full extension compresses the tree to ~76% width — modest.

---

## Behaviour

- A **"Show beyond"** toggle button sits in the Sample-distribution panel header (beside the CSV button). **Off by default**; state lives in the timeseries panel.
- **Extent is dynamic = the latest date in the current selection's data.** When on, the chart extends to `effMax = max(t1, latest plotted-row date for the current selection)`; selecting a different zone/area recomputes it (the tree re-fits each time — an accepted, brief reflow). With no selection, the extent is the latest date across all rows.
- When on, the tree canvas compresses so `most-recent` sits at fraction `f = (t1 − t0) / (effMax − t0)` of the usable width; the freed right strip shows the post-`most-recent` bars, axes still aligned. The **toolbar is untouched** (only `#canvas-container` shrinks).
- When off, or when the selection has no data after `most-recent` (`effMax === t1`), the tree is restored to full width and the axis clamps to `most-recent` (today's behaviour).

---

## Components & interfaces

### 1. `src/tree-panel.js` — `setWidthFraction(f)`
Add to the returned API:

```js
/** Compress the tree CANVAS (not the toolbar) to fraction f∈[F_MIN,1] of its width by
 *  insetting PearTree's #canvas-container; PearTree's ResizeObserver refits + emits
 *  onViewChange, which the chart locks onto. f≈1 restores full width. */
setWidthFraction(f) {
  const cc = document.getElementById('canvas-container');
  if (!cc) return;                                   // tree not embedded yet → no-op
  const frac = Math.max(F_MIN, Math.min(1, f || 1)); // F_MIN guards against extreme squish
  cc.style.marginRight = ((1 - frac) * 100) + '%';   // % is relative to .pt-embed-wrap width
}
```
- `F_MIN` = `0.4` (module const). Targets the global id `#canvas-container` (same internal-coupling style as the existing `#tree-canvas` dblclick handler and `#legend-annotation` toggle).
- Margin-right (not width) keeps `#canvas-container`'s `flex:1` intact; the `#canvas-wrapper` inside shrinks → PearTree's RO fires.

### 2. `src/timeseries-panel.js`
**State:** `let showBeyond = false;`

**Pure extent helper (unit-tested) — Ct-filter-aware:**
```js
// Latest *plotted* date for the current selection, and the resulting tree fraction.
// Uses the SAME row filter as aggregate() — status-valid AND ctPass — so a point the
// Ct filter hides never extends the axis (no empty tail).
// rows: selection-filtered rows; t0/t1: domain ms; on: showBeyond; ct: current Ct< threshold or null.
export function extentFraction(rows, t0, t1, on, ct = null, F_MIN = 0.4) {
  let effMax = t1;
  if (on) for (const r of rows) {
    if (!STATUS_SET.has(r.status) || !ctPass(r, ct)) continue;   // identical filter to aggregate()
    const t = +new Date(r.date);
    if (!isNaN(t) && t > effMax) effMax = t;
  }
  const f = effMax > t0 ? Math.max(F_MIN, Math.min(1, (t1 - t0) / (effMax - t0))) : 1;
  return { effMax, f };
}
```
- `STATUS_SET` = `new Set(STATUS)`. Exported for the test; called internally with `filteredRows()` and the panel's current `ctThreshold`.
- **Refactor `ctPass` to a pure module function `ctPass(r, ct)`** (today it's a closure over `ctThreshold`) so both `aggregate()` and `extentFraction()` share one definition — guaranteeing the extent and the bars use an identical filter.

**Wiring:** a constructor option `onExtentChange(f)` (default no-op). The panel keeps the current `effMax` in a closure var. A single `applyExtent()` recomputes `{ effMax, f }` from `filteredRows()` **and the panel's current `ctThreshold`**, and calls `onExtentChange(f)`; it's invoked from: the toggle handler, `setSelection()`, and the **Ct-filter change** handler (so hiding/revealing a beyond-tree point re-extends/retracts the axis + tree). To avoid thrashing the tree refit on rapid changes, `onExtentChange` calls are coalesced with `requestAnimationFrame` (one per frame).

**Render changes** (`effMax` replaces `t1` as the right extent; the *scale* is unchanged — it still anchors `domain.maxDate → treeRightEdge` and extrapolates):
- `aggregate()`: upper clip becomes `t > effMax` (was `t > t1`), so post-`most-recent` bars up to `effMax` are included.
- `render()`: `xMax = scale.dateToX(new Date(effMax))` (was `domain.maxDate`); the time-tick loop spans `[t0, effMax]`; the baseline and per-day hit-areas extend to `effMax`.
- `updateNote()`: the "after" cut becomes `effMax` (so when extended, `after === 0`; `before`/`undated` unchanged).
- `buildScale()`, `seqByDate()`, `allocByDate()`: **unchanged** — tree tips are always ≤ `most-recent`; the to-sequence overlay already extrapolates with the scale.

**API additions to the returned object:** none required for the toggle itself (button wired internally). `onExtentChange` is a constructor option.

### 3. `src/main.js` — wiring
Pass `onExtentChange` when creating the timeseries panel:
```js
const ts = createTimeseriesPanel('timeseries-body', linelist,
  { minDate: meta.rootDate, maxDate: meta.mostRecentDate },
  { onCtChange: (t) => map.setCtThreshold(t), tips: seqTips, onExtentChange: (f) => tree.setWidthFraction(f) });
```
`tree` is created after `ts` today; reorder so `tree` exists before `ts`, or pass a late-bound `(f) => tree?.setWidthFraction(f)`. (`tree` is created via `await createTreePanel` — ensure it's available; if ordering is awkward, store the fraction and apply once `tree` resolves.)

### 4. `index.html`
Add the toggle to the Sample-distribution header:
```html
<button id="dist-beyond" class="dist-download" type="button" title="Show samples dated after the tree's latest tip">⤢ beyond</button>
```
(reuse `.dist-download` styling; an `.active` state mirrors the legend-toggle pattern.)

---

## Data flow (the loop)

```
toggle / selection / Ct change
   → timeseries applyExtent()  → {effMax, f}
   → onExtentChange(f)         → tree.setWidthFraction(f)
   → #canvas-container margin-right
   → PearTree ResizeObserver (on #canvas-wrapper) refits the tree
   → tree.onViewChange(t)      → ts.setTransform(t)
   → ts.render()               (uses the new transform + effMax → aligned)
```

The chart also re-renders synchronously on the originating change (toggle/selection); that first paint uses the pre-refit transform (tree still wider) so the beyond-bars are briefly off to the right, corrected one frame later when `setTransform` fires. This flash is acceptable.

---

## Edge cases & error handling

- **No beyond-data / toggle off:** `effMax === t1` → `f = 1` → `setWidthFraction(1)` restores full width; axis clamps to `most-recent`.
- **Far outlier:** `f` is clamped to `F_MIN` (0.4); an extreme `effMax` then maps past the panel's right edge and is clipped by the SVG — rare given the data, acceptable.
- **Tree not yet embedded / `#canvas-container` missing:** `setWidthFraction` no-ops; the deferred-apply (store-last-f) covers the load-order case.
- **No transform yet** (PearTree hasn't emitted one): `buildScale` falls back to `createTimeScale` (width-based) — self-consistent, just not tree-locked; unchanged from today.
- **Rapid selection changes:** `requestAnimationFrame` coalescing prevents refit thrash; the last `f` wins.
- **Resize of the whole panel:** PearTree refits on its own RO; `f` (a percentage margin) is resolution-independent, so it holds across window resizes.

---

## Testing

- **Unit (Vitest):** `extentFraction()` — off ⇒ `{effMax:t1, f:1}`; on with a later row ⇒ `effMax` = that date, `f` = correct ratio in `(F_MIN,1)`; on with only ≤t1 rows ⇒ `f:1`; outlier ⇒ `f` clamped to `F_MIN`; non-`STATUS` rows ignored; **a beyond-tree positive with Ct ≥ threshold does NOT extend the axis** (Ct-aware); the same point with the filter off (or below threshold) does.
- **Manual integration:** toggle on with no selection (tree compresses ~24%, June bars appear, toolbar full-width, "not shown" drops the "after" bucket); select zones (extent + tree width track the selection); toggle off (full width restored). Confirm the **toolbar does not change width** in any state.

---

## Non-goals

- Persisting the toggle across reloads.
- Animating the tree compression (instant margin change is fine; a CSS transition could be added later).
- Special tick-density handling for the extended region.
- Extending the tree itself (it genuinely has no tips after `most-recent`).
