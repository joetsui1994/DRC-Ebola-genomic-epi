# Time-window brush — design

**Goal:** Let the user drag a horizontal region on the Sample-distribution histogram to pick a time window `[d0, d1]`; that window filters the **map** (choropleth counts + markers) to in-window samples and draws a **shaded band** over the tree marking the same window. Clearing the brush restores everything.

**Architecture:** The histogram owns a brush that emits a window (or `null`). `main.js` routes it to two consumers: `map.setDateWindow(d0, d1)` (re-tally + re-colour + filter markers) and `tree.setTimeBand(d0, d1)` (an overlay band positioned by the tree's view transform). The window is an independent dimension that coexists with the existing zone/area selection; it does **not** filter the histogram itself (the histogram just shows the brushed band).

**Tech stack:** Vanilla ES modules + Vite; Leaflet (map); PearTree embed (tree); Vitest (`src/*.test.js`, `environment: node`).

---

## Background (current state)

- **Histogram** (`timeseries-panel.js`): an SVG redrawn by `render()` into `holder` (`.dist-svg`). The x-scale (`scale = buildScale(W)`) exposes `dateToX` and `xToDate`. Per-day transparent `<rect>` hit-areas drive the hover tooltip (`mousemove`); `svg` has a `mouseleave → hideTip`. The chart is x-locked to the tree via `transform` (set by `setTransform`).
- **Map** (`map-panel.js`): `addZoneLayer(geojson, zoneCounts, posCt)` captures `countsOf(f) = zoneCounts.get(upper(Nom))` and `posBelow(f)` (positives below the Ct threshold, from the scope-level `zonePosCt`). `METRICS` (Positive/Negative/…/total) read `countsOf`; class breaks come from `recomputeBreaks`. Markers are `markers = [{ group, marker }]`, one per `health_area`→`health_zone` group of tips; `group.tipIds` holds the tip ids.
- **`main.js`** computes `zoneCounts` (per-zone status tallies) and `zonePosCt` (per-zone positive-Ct list) **once** from the full `linelist`, then `map.addZoneLayer(zones, zoneCounts, zonePosCt)`.
- **Tree** (`tree-panel.js`): returns `onViewChange(cb)`, `getViewTransform()`, `setWidthFraction(f)`. The PearTree embed wraps `toolbar` + `#canvas-container` (→ `#canvas-wrapper` → `#tree-canvas`) + `status-bar`. `meta` (`rootDate`, `mostRecentDate`) lives in `main.js`, not the tree panel.

---

## Components & interfaces

### 1. Shared zone-tally helper — `src/zone-tally.js` (new, pure, tested)
Extract the tally currently inline in `main.js` so the initial render and the windowed recompute share one path.

```js
// rows: parsed line-list rows {health_zone (canonical), status, date, ct}.
// window: { d0, d1 } in ms, or null for all. Returns { zoneCounts, zonePosCt } keyed by UPPER Nom.
export function tallyZones(rows, window = null) { … }
```
- `zoneCounts`: `Map<upperNom, {Positive,Negative,Invalid,Unclassified,total}>` over rows whose status ∈ the four and whose date is in window (or any, if `null`).
- `zonePosCt`: `Map<upperNom, number[]>` of positive rows' numeric Ct values within the window.
- A row is in-window when its date parses and `d0 ≤ t ≤ d1` (inclusive). Undated rows are excluded when a window is set (they can't be placed in time).

`main.js` replaces its two inline loops with `const { zoneCounts, zonePosCt } = tallyZones(linelist)` for the initial (no-window) render.

### 2. Map — windowing
- **Make counts dynamic.** Promote `zoneCounts` to a scope-level `let` in `createMapPanel` (mirroring the existing `let zonePosCt`), so `countsOf`/`posBelow` read the current tallies. `addZoneLayer` seeds them from its args (unchanged signature).
- **Hold the line-list + tips dates.** Extend `addZoneLayer(geojson, zoneCounts, posCt, rows)` with a 4th arg: the map seeds `zoneCounts`/`zonePosCt` from the passed (initial, full) tallies and **retains `rows`** for windowed re-tally. Store per-group tip dates when building marker groups (`group.dates = []`, pushed alongside `tipIds`) so markers can be window-filtered.
- **`map.setDateWindow(d0, d1 | null)`** (new returned method):
  - `({ zoneCounts, zonePosCt } = tallyZones(rows, win))`; reassign the scope vars; `recomputeBreaks(cfg)` for every metric; `restyle()` + `renderLegend()`.
  - **Markers:** for each `{ group, marker }`, count tips with a date in window; hide the marker (`setStyle`/remove) when 0, else show and rescale radius by the in-window count (same `6 + 3·√n` rule). `null` restores the full marker set + radii.
  - Composes with the **Ct filter**: `posBelow` still applies `ctThreshold` on top of the windowed `zonePosCt`, so the Positive metric shows in-window positives below Ct.

### 3. Tree — shaded band
- **`tree-panel` gains `meta`.** `createTreePanel(containerId, meta)` (root/most-recent dates) so it can map date→x with the same anchors the histogram uses: `dateToX(date) = offsetX + (date−root)/(mostRecent−root) · (maxX·scaleX)`.
- **`tree.setTimeBand(d0, d1 | null)`** (new returned method): stores the window; `null` removes the band.
- **Overlay element:** a single `pointer-events:none` `<div class="tree-time-band">` appended to **`#canvas-wrapper`** (the canvas's own box, so x-origin matches the transform and the toolbar is never covered), `top:0; bottom:0`, with `left`/`width` from the clamped date range.
- **`positionBand()`:** clamps `[d0, d1]` to `[rootDate, mostRecentDate]`, computes `xLeft/xRight` from the current `getViewTransform()`, sets the div's `left`/`width`; hides it if the window is `null` or clamps to an empty span. Called from `setTimeBand` **and** from an internal `onViewChange` subscription so the band tracks pan/zoom/resize. If there is no transform yet, no-op (re-fires on the next view change).

### 4. Histogram — the brush
- **`onWindowChange` option** on `createTimeseriesPanel(..., { …, onWindowChange })`.
- **State:** `let win = null;  // { d0, d1 } in ms` (the brushed window), plus drag state.
- **Interaction (on the `svg`):** `mousedown` on the svg records the start x; `mousemove` while dragging updates a live band and suppresses the hover tooltip; `mouseup` (listened on `window`, so a release outside the svg still ends cleanly) finishes. (The `.dist-controls` toggle/legend are separate DOM siblings layered above `holder`, not children of the svg, so they don't start a brush.) If the drag distance < `BRUSH_MIN_PX` (≈3px) it's a **click → clear** (`win = null`, `onWindowChange(null)`); otherwise `win = { d0, d1 }` with `d0/d1 = scale.xToDate(min/max x)` ordered, and `onWindowChange(win.d0, win.d1)`.
- **Render:** in `render()`, if `win`, draw a translucent band `<rect>` over the plot area from `dateToX(d0)` to `dateToX(d1)` (behind the bars/tracks, above the gridlines), so the selection persists across re-renders. The band uses the same scale as the bars, so it stays put under pan/zoom and aligns with the tree band.
- The brush does **not** filter the histogram's own bars.

### 5. Wiring — `main.js`
- `const { zoneCounts, zonePosCt } = tallyZones(linelist)` (replaces the inline loops); pass `linelist` to the map for re-tally.
- `createTimeseriesPanel(..., { …, onWindowChange: (d0, d1) => { map.setDateWindow(d0 ?? null, d1 ?? null); tree?.setTimeBand?.(d0 ?? null, d1 ?? null); } })` — a single `null` arg (clear) propagates to both.
- `createTreePanel('tree-body', meta)`.

---

## Data flow

```
drag on histogram → win {d0,d1}  (or click → null)
   → ts.onWindowChange(d0, d1)
        → map.setDateWindow(d0,d1): tallyZones(rows, win) → recompute breaks → restyle choropleth + filter/resize markers
        → tree.setTimeBand(d0,d1): position the overlay band (clamped to tree's date range)
   → histogram render() draws the persistent brushed band
clear (null) → map full dataset · tree band removed · histogram band gone
```

The tree band also repositions on `tree.onViewChange` (pan/zoom/resize), independently of new brushes.

---

## Edge cases & error handling

- **Brush past the tree's range** (with "show beyond" on): the map filters to the full `[d0,d1]`; the tree band **clamps** to `[rootDate, mostRecentDate]` (stops at the tree edge).
- **Empty window** (no in-window samples): choropleth goes all-zero, markers hidden, band still drawn (shows the chosen span). No error.
- **Window + zone/area selection both active:** independent — the choropleth is windowed; the selected-zone outline and the histogram's zone filter are unchanged. (The two compose; the histogram still shows its selected-zone bars plus the brush band.)
- **Window + Ct filter:** compose (in-window positives below Ct).
- **Reversed drag** (right-to-left): `d0/d1` ordered by min/max.
- **No transform yet / tree not loaded:** `setTimeBand` stores the window; `positionBand` no-ops until a transform exists, then the `onViewChange` subscription paints it.
- **Re-render churn:** the histogram band is part of `render()` (idempotent); `setDateWindow` is O(rows) per brush — fine for the ~1.2k-row line-list, and brushes are user-paced (no need to throttle, but a trailing `requestAnimationFrame` coalesce is acceptable if mousemove proves heavy).

---

## Testing

- **Unit (Vitest, pure):**
  - `tallyZones(rows, window)` — counts/posCt for full vs windowed; undated excluded under a window; inclusive bounds; status filtering; positive-Ct collection.
  - Brush date math: ordering (reversed drag), click-vs-drag threshold (a tiny pure helper `brushWindow(x0, x1, scale, minPx)` returning `{d0,d1}|null`).
- **Manual integration:** drag a window → choropleth + markers filter, tree band appears aligned with the histogram band; pan/zoom the tree → band tracks; click to clear → all restored; window + Ct + zone-selection compose; brush into the "beyond" region → tree band clamps, map still filters.

---

## Non-goals

- Filtering the histogram's own bars by the brush.
- Persisting the window across reloads.
- Animating the band or the marker resize.
- A draggable/resizable brush handle (a fresh drag replaces the window; click clears).
