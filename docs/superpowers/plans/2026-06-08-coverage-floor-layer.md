# Coverage Floor Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a coverage-floor pre-pass to the dashboard's sequencing-prioritisation engine that guarantees every never-sequenced location at least `floorSize` samples before the proportional loop spends the budget, exposed via a 3-way mode selector and floor knobs on both the page and the map.

**Architecture:** A pre-pass inside `prioritise()` reuses the existing per-cell weight to floor uncovered locations, prepends those picks to the ranking, and applies their `h`-updates before the existing greedy loop runs. Location-level history (`H_k`) comes from a new `locHistory` map returned by `buildCells` (the per-cell `h` is insufficient because empty-availability cells are dropped). The shared `buildKnobs` strip gains the controls so they appear on the page and the on-map Leaflet control automatically.

**Tech Stack:** Vanilla ES modules, Vite, Vitest (pure-module tests beside source, run with `npm test`).

**Spec:** `docs/superpowers/specs/2026-06-08-coverage-floor-layer-design.md`

---

## File Structure

- `src/prioritise.js` — engine. Add `resolveFloorBudget`, `pickBest` (refactor), `coverageFloor`; extend `prioritise()` with `mode`/`floorSize`/`floorBudgetCap`/`stalenessWindow`/`locHistory`; add `layer` to selection rows and `floorSelected`/`propSelected` to cell summary.
- `src/prioritise-data.js` — add `locHistory` (per-location pre-batch history total) to `buildCells`'s return.
- `src/prio-knobs.js` — shared strip; add mode `<select>` + `floorSize` + `floorBudgetCap` controls.
- `src/prioritise-panel.js` — `DEFAULTS`, thread params + `locHistory` into the engine, new methodology section, δ-table reword, export columns.
- `src/prio-heatmap.js` — tooltip floor/proportional breakdown.
- `src/style.css` — `.pk-disabled` style for greyed floor controls.
- `src/prioritise.test.js`, `src/prioritise-data.test.js` — new tests.

---

## Task 1: Engine helpers — `resolveFloorBudget` + `pickBest` refactor

**Files:**
- Modify: `src/prioritise.js`
- Test: `src/prioritise.test.js`

This task adds the budget-resolver (new, tested) and extracts the existing tie-break pick into a reusable `pickBest` helper (pure refactor — existing tests must stay green).

- [ ] **Step 1: Write the failing test for `resolveFloorBudget`**

Append to `src/prioritise.test.js`:

```js
import { resolveFloorBudget } from './prioritise.js';

describe('resolveFloorBudget', () => {
  it('null cap → full budget', () => {
    expect(resolveFloorBudget(null, 50)).toBe(50);
  });
  it('fraction in (0,1] → ceil(frac*n), clamped to n', () => {
    expect(resolveFloorBudget(0.2, 50)).toBe(10);
    expect(resolveFloorBudget(0.25, 50)).toBe(13);   // ceil(12.5)
    expect(resolveFloorBudget(1, 50)).toBe(50);
  });
  it('integer > 1 → min(int, n)', () => {
    expect(resolveFloorBudget(5, 50)).toBe(5);
    expect(resolveFloorBudget(80, 50)).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- prioritise.test.js`
Expected: FAIL — `resolveFloorBudget is not exported` / not a function.

- [ ] **Step 3: Add `resolveFloorBudget` and `pickBest` to `src/prioritise.js`**

Add these two functions above `prioritise` (after `shuffle`):

```js
/** Resolve the floor budget: null → n; fraction in (0,1] → ceil(frac·n); int > 1 → min(int, n). */
export function resolveFloorBudget(cap, n) {
  if (cap == null) return n;
  if (cap > 0 && cap <= 1) return Math.min(n, Math.ceil(cap * n));
  return Math.min(n, Math.floor(cap));
}

/**
 * Pick the highest-weight index from `eligIdx` (random tie-break via `rng`).
 * Infinity-safe: a relative tolerance is NaN at w=∞, so match on exact equality there.
 * Returns the chosen index, or null when `eligIdx` is empty.
 */
function pickBest(eligIdx, wOf, rng) {
  if (!eligIdx.length) return null;
  let wmax = -Infinity;
  for (const i of eligIdx) { const w = wOf(i); if (w > wmax) wmax = w; }
  const ties = isFinite(wmax)
    ? eligIdx.filter((i) => wOf(i) >= wmax - 1e-9 * wmax)
    : eligIdx.filter((i) => wOf(i) === wmax);
  return ties.length > 1 ? ties[Math.floor(rng() * ties.length)] : ties[0];
}
```

- [ ] **Step 4: Refactor the `prioritise` loop to use `pickBest` (no behaviour change)**

In `prioritise()`, add a weight helper just after `decayC` is computed:

```js
  const decayC = C.map((c) => decay(c.timeBin, origin, binWidthDays, tNow, lam));
  const wOf = (i) => C[i].risk / (C[i].h + delta) * decayC[i];
```

Replace the existing `const selection = [];` line **and** its `for (let rank = 1; rank <= n; rank++) { ... }` loop (lines ~53–75) with:

```js
  const selection = [];
  for (let rank = 1; rank <= n; rank++) {
    const elig = [];
    for (let i = 0; i < C.length; i++) {
      if (C[i].available <= 0 || C[i].risk <= 0) continue;
      elig.push(i);
    }
    const idx = pickBest(elig, wOf, rng);
    if (idx == null) break;
    const c = C[idx];
    selection.push({
      rank, location: c.location, timeBin: c.timeBin,
      weight: wOf(idx), sampleId: c.ids ? c.ids.pop() : null,
    });
    c.available -= 1; c.h += 1; c.selected += 1;
  }
```

- [ ] **Step 5: Run the full suite to verify the refactor is safe**

Run: `npm test`
Expected: PASS — all existing `prioritise`/`prioritise-data` tests plus the new `resolveFloorBudget` tests.

- [ ] **Step 6: Commit**

```bash
git add src/prioritise.js src/prioritise.test.js
git commit -m "Add resolveFloorBudget + extract pickBest helper"
```

---

## Task 2: Engine — coverage-floor pre-pass + mode/params + summary fields

**Files:**
- Modify: `src/prioritise.js`
- Test: `src/prioritise.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/prioritise.test.js` (the `cell` / `selectedByLoc` helpers and `base` from the existing `prioritise` describe block are in scope at module level — re-declare a local `floorBase` to be explicit):

```js
describe('coverage floor', () => {
  const floorBase = { origin: '2026-04-05', tNow: '2026-04-05', lam: Infinity, binWidthDays: 7, seed: 1 };
  // A: high risk, already covered (H=3); B,C: low risk, never sequenced (uncovered).
  const mkCells = () => [
    { location: 'A', timeBin: 0, risk: 10, available: 10, h: 0 },
    { location: 'B', timeBin: 0, risk: 1, available: 10, h: 0 },
    { location: 'C', timeBin: 0, risk: 1, available: 10, h: 0 },
  ];
  const locHistory = new Map([['A', 3]]);   // only A has prior history

  it('proportional mode (default) ignores the floor and is unchanged', () => {
    const { selection } = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'proportional' });
    // A dominates on risk; B/C barely get a look
    expect(selectedByLoc(selection).A).toBe(5);
  });

  it('both mode floors every uncovered location before the proportional loop', () => {
    const { selection } = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'both', floorSize: 1 });
    const byLoc = selectedByLoc(selection);
    expect(byLoc.B).toBeGreaterThanOrEqual(1);   // floored
    expect(byLoc.C).toBeGreaterThanOrEqual(1);   // floored
    // floor picks come first and are tagged
    const floorPicks = selection.filter((s) => s.layer === 'floor');
    expect(floorPicks.length).toBe(2);
    expect(floorPicks.map((s) => s.rank)).toEqual([1, 2]);
    expect(new Set(floorPicks.map((s) => s.location))).toEqual(new Set(['B', 'C']));
    // remainder is proportional
    expect(selection.filter((s) => s.layer === 'proportional').length).toBe(3);
  });

  it('floorSize takes multiple per uncovered location, capped at availability', () => {
    const cells = [
      { location: 'A', timeBin: 0, risk: 10, available: 10, h: 0 },
      { location: 'B', timeBin: 0, risk: 1, available: 1, h: 0 },   // only 1 available
      { location: 'C', timeBin: 0, risk: 1, available: 10, h: 0 },
    ];
    const { selection } = prioritise({ ...floorBase, cells, locHistory, n: 10, delta: 0.5, mode: 'floor', floorSize: 3 });
    const byLoc = selectedByLoc(selection);
    expect(byLoc.B).toBe(1);   // capped at availability
    expect(byLoc.C).toBe(3);   // floorSize
    expect(byLoc.A).toBeUndefined();   // floor-only: A (covered) is never touched
  });

  it('floor mode leaves leftover budget unused', () => {
    const { selection } = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 50, delta: 0.5, mode: 'floor', floorSize: 1 });
    expect(selection.length).toBe(2);   // one each for B and C, then stop
    expect(selection.every((s) => s.layer === 'floor')).toBe(true);
  });

  it('floorBudgetCap bounds the floor picks (carry-over)', () => {
    const cells = [
      { location: 'B', timeBin: 0, risk: 1, available: 10, h: 0 },
      { location: 'C', timeBin: 0, risk: 1, available: 10, h: 0 },
      { location: 'D', timeBin: 0, risk: 1, available: 10, h: 0 },
    ];
    const { selection } = prioritise({ ...floorBase, cells, locHistory: new Map(), n: 10, delta: 0.5, mode: 'floor', floorSize: 1, floorBudgetCap: 0.2 });
    // cap = ceil(0.2*10) = 2 → only 2 of the 3 uncovered locations floored
    expect(selection.filter((s) => s.layer === 'floor').length).toBe(2);
  });

  it('a floored location is demoted in the subsequent proportional loop', () => {
    const cells = [
      { location: 'A', timeBin: 0, risk: 5, available: 10, h: 0 },
      { location: 'B', timeBin: 0, risk: 5, available: 10, h: 0 },
    ];
    // both uncovered, equal risk; floor gives each 1, then proportional splits the rest evenly
    const { cellSummary } = prioritise({ ...floorBase, cells, locHistory: new Map(), n: 6, delta: 0.5, mode: 'both', floorSize: 1 });
    const a = cellSummary.find((c) => c.location === 'A');
    const b = cellSummary.find((c) => c.location === 'B');
    expect(a.floorSelected).toBe(1);
    expect(b.floorSelected).toBe(1);
    expect(a.selected + b.selected).toBe(6);
  });

  it('determinism: same seed → identical selection with floor on', () => {
    const s1 = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'both' }).selection;
    const s2 = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'both' }).selection;
    expect(s1).toEqual(s2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- prioritise.test.js`
Expected: FAIL — `selection[].layer` undefined, `cellSummary[].floorSelected` undefined, floor picks absent.

- [ ] **Step 3: Add the `coverageFloor` function**

Add to `src/prioritise.js` above `prioritise` (after `pickBest`):

```js
/**
 * Coverage-floor pre-pass. Mutates the working cells `C` and pushes floor picks onto
 * `selection`. Uncovered = location with H_k == 0 (from `locHistory`) and ≥1 eligible cell.
 * Locations are floored in best-cell-weight order; within a location, top cells by weight.
 */
function coverageFloor({ C, decayC, wOf, rng, locHistory, floorSize, floorBudget, selection }) {
  const byLoc = new Map();
  for (let i = 0; i < C.length; i++) {
    if (C[i].available <= 0 || C[i].risk <= 0) continue;
    if (!byLoc.has(C[i].location)) byLoc.set(C[i].location, []);
    byLoc.get(C[i].location).push(i);
  }

  const uncovered = [];
  for (const [loc, idxs] of byLoc) {
    if (((locHistory && locHistory.get(loc)) || 0) !== 0) continue;
    // At floor time every cell of an uncovered location has h==0, so weight ordering
    // ≡ risk·decay ordering (and stays finite even when delta==0).
    const key = Math.max(...idxs.map((i) => C[i].risk * decayC[i]));
    uncovered.push({ idxs, key, r: rng() });
  }
  uncovered.sort((a, b) => (b.key - a.key) || (a.r - b.r));

  let budget = floorBudget;
  for (const u of uncovered) {
    if (budget <= 0) break;
    let take = Math.min(floorSize, budget);
    while (take > 0) {
      const elig = u.idxs.filter((i) => C[i].available > 0 && C[i].risk > 0);
      const idx = pickBest(elig, wOf, rng);
      if (idx == null) break;
      const c = C[idx];
      selection.push({
        rank: selection.length + 1, location: c.location, timeBin: c.timeBin,
        weight: wOf(idx), sampleId: c.ids ? c.ids.pop() : null, layer: 'floor',
      });
      c.available -= 1; c.h += 1; c.selected += 1; c.floorSelected += 1;
      take -= 1; budget -= 1;
    }
  }
}
```

- [ ] **Step 4: Wire the params, pre-pass, layer tags, and summary fields into `prioritise`**

Change the signature:

```js
export function prioritise({
  cells, locHistory = null, n, delta = 0.5, lam = 14, binWidthDays = 7, origin, tNow, seed = 1,
  mode = 'proportional', floorSize = 1, floorBudgetCap = null, stalenessWindow = null,
}) {
```

(`stalenessWindow` is accepted but unused in v1 — covered = ever sequenced.)

Add the two counter fields to each working cell in the `C = cells.map(...)`:

```js
  const C = cells.map((c) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    available0: c.available, available: c.available, h: c.h || 0,
    selected: 0, floorSelected: 0, propSelected: 0,
    ids: c.ids ? [...c.ids] : null,
  }));
```

Replace the selection block from Task 1 with the floor pre-pass + a guarded proportional loop:

```js
  const selection = [];

  if (mode === 'floor' || mode === 'both') {
    coverageFloor({
      C, decayC, wOf, rng, locHistory, floorSize,
      floorBudget: resolveFloorBudget(floorBudgetCap, n), selection,
    });
  }

  if (mode !== 'floor') {
    for (let rank = selection.length + 1; rank <= n; rank++) {
      const elig = [];
      for (let i = 0; i < C.length; i++) {
        if (C[i].available <= 0 || C[i].risk <= 0) continue;
        elig.push(i);
      }
      const idx = pickBest(elig, wOf, rng);
      if (idx == null) break;
      const c = C[idx];
      selection.push({
        rank, location: c.location, timeBin: c.timeBin,
        weight: wOf(idx), sampleId: c.ids ? c.ids.pop() : null, layer: 'proportional',
      });
      c.available -= 1; c.h += 1; c.selected += 1; c.propSelected += 1;
    }
  }
```

Add the new fields to the `cellSummary` map:

```js
  const cellSummary = C.map((c, i) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    decay: Math.round(decayC[i] * 1000) / 1000,
    available: c.available0, selected: c.selected,
    floorSelected: c.floorSelected, propSelected: c.propSelected, hFinal: c.h,
  })).sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : a.timeBin - b.timeBin));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — new coverage-floor tests plus all pre-existing tests (the `mode: 'proportional'` default keeps the old behaviour byte-for-byte).

- [ ] **Step 6: Commit**

```bash
git add src/prioritise.js src/prioritise.test.js
git commit -m "Add coverage-floor pre-pass + mode/floor params to prioritise()"
```

---

## Task 3: Data — `locHistory` from full pre-batch history

**Files:**
- Modify: `src/prioritise-data.js`
- Test: `src/prioritise-data.test.js`

The engine needs location-level history that includes locations/bins with no current candidates (which `cells` drops). Derive it from the full history set, before the availability filter.

- [ ] **Step 1: Write the failing test**

Append to `src/prioritise-data.test.js`:

```js
describe('buildCells locHistory', () => {
  it('counts all prior history per location, including locations with no candidates this batch', () => {
    const candidateRows = [
      { health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-12' }, // bin 1, candidate
    ];
    const sequencedRows = [
      { health_zone: 'Bunia', date: '2026-04-05' },   // bin 0 — no candidate in this bin
      { health_zone: 'Katwa', date: '2026-04-05' },   // Katwa has NO candidates at all this batch
    ];
    const { cells, locHistory } = buildCells({
      candidateRows, sequencedRows, risk, canon, ctThreshold: 31, binWidthDays: 7, subtractHistory: true,
    });
    // Katwa is absent from cells (no candidates) but its history is still counted:
    expect(cells.find((c) => c.location === 'KATWA')).toBeUndefined();
    expect(locHistory.get('KATWA')).toBe(1);
    // Bunia's bin-0 history counts toward its location total even though the candidate is in bin 1:
    expect(locHistory.get('BUNIA')).toBe(1);
  });

  it('locHistory is empty when there is no history', () => {
    const { locHistory } = buildCells({
      candidateRows: [{ health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' }],
      risk, canon, ctThreshold: 31, binWidthDays: 7,
    });
    expect(locHistory.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- prioritise-data.test.js`
Expected: FAIL — `locHistory` is undefined on the return value.

- [ ] **Step 3: Build and return `locHistory`**

In `src/prioritise-data.js`, just after the per-cell `hMap` is built (the `for (const r of seq) { ... hMap.set(...) }` block), add:

```js
  // location-level pre-batch history total (H_k) — counts ALL history, independent of
  // whether the location has candidates this batch (cells drop available<=0 cells).
  const locHistory = new Map();
  for (const r of seq) {
    locHistory.set(r.loc, (locHistory.get(r.loc) || 0) + 1);
  }
```

Change the return statement to include it:

```js
  return { cells, origin: o, tNow: t, locHistory, diagnostics: { kept: eligible.length, dropped: candidateRows.length - eligible.length, byReason: reason } };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — new `locHistory` tests plus all existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/prioritise-data.js src/prioritise-data.test.js
git commit -m "Return locHistory (location-level H_k) from buildCells"
```

---

## Task 4: Panel wiring — DEFAULTS + thread params/locHistory into the engine

**Files:**
- Modify: `src/prioritise-panel.js`

This wires the new params end-to-end so the floor is reachable before the UI controls exist (verifiable by temporarily setting a default).

- [ ] **Step 1: Extend `DEFAULTS`**

Replace the `DEFAULTS` line (`src/prioritise-panel.js:9`):

```js
const DEFAULTS = { delta: 0.5, lam: Infinity, n: 50, ctThreshold: 32, binWidthDays: 1, mode: 'proportional', floorSize: 1, floorBudgetCap: null, stalenessWindow: null };
```

- [ ] **Step 2: Pass `locHistory` + floor params into `prioritise` in `runEngine`**

In `runEngine()`, replace the `prioritise({ ... })` call with:

```js
    const { selection, cellSummary } = prioritise({
      cells: built.cells, locHistory: built.locHistory, n: params.n, delta: params.delta, lam: params.lam,
      binWidthDays: params.binWidthDays, origin: built.origin, tNow: built.tNow, seed: 1,
      mode: params.mode, floorSize: params.floorSize, floorBudgetCap: params.floorBudgetCap,
      stalenessWindow: params.stalenessWindow,
    });
```

(The `universe` `buildCells` call for the heatmap zone list is unchanged — it does not need `locHistory`.)

- [ ] **Step 3: Verify end-to-end with a temporary default flip**

Temporarily set `mode: 'both'` in `DEFAULTS`, run the dev server, open the Prioritisation tab.

Run: `npm run dev`
Expected: the heatmap allocates ≥1 to low-risk zones that previously got nothing (coverage visible). Then **revert** `mode` back to `'proportional'` before committing.

- [ ] **Step 4: Commit**

```bash
git add src/prioritise-panel.js
git commit -m "Thread locHistory + floor params through the prioritisation panel"
```

---

## Task 5: Knobs — mode selector + floorSize + floorBudgetCap (page + map)

**Files:**
- Modify: `src/prio-knobs.js`
- Modify: `src/style.css`

`buildKnobs` is shared by the page (`prioritise-panel.js`) and the on-map control (`map-panel.js`), so adding controls here surfaces them in both.

- [ ] **Step 1: Replace `src/prio-knobs.js` with the floor-aware version**

```js
// src/prio-knobs.js
// Shared δ/λ/N/Ct/bin + coverage-floor knob strip, used both on the map (inside a Leaflet
// control) and on the prioritisation page. λ and floorBudgetCap are sliders with an ∞ end stop;
// the mode is a <select>. Recompute is throttled; numeric readouts update instantly.

const LAM_MAX = 999, LAM_STOPS = 100;
const lamFromSlider = (p) => p >= LAM_STOPS ? Infinity
  : Math.round(Math.pow(10, (p / (LAM_STOPS - 1)) * Math.log10(LAM_MAX)));
const lamToSlider = (lam) => !isFinite(lam) ? LAM_STOPS
  : Math.round(Math.log10(Math.max(1, lam)) / Math.log10(LAM_MAX) * (LAM_STOPS - 1));
const lamLabel = (lam) => isFinite(lam) ? String(lam) : '∞';

// floorBudgetCap: slider 0..100. 100 = uncapped (null); 1..99 = fraction of N; 0 = 0%.
const capFromSlider = (p) => p >= 100 ? null : p / 100;
const capToSlider = (cap) => cap == null ? 100 : Math.round(cap * 100);
const capLabel = (cap) => cap == null ? '∞' : `${Math.round(cap * 100)}%`;

const MODES = [['proportional', 'Proportional only'], ['both', 'Floor + proportional'], ['floor', 'Floor only']];

function row(label, k, val, min, max, step, disp) {
  return `<div class="pk-row" data-row="${k}"><span class="pk-l">${label}</span>`
    + `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">`
    + `<span class="pk-v" data-v="${k}">${disp != null ? disp : val}</span></div>`;
}
function modeRow(val) {
  const opts = MODES.map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('');
  return `<div class="pk-row" data-row="mode"><span class="pk-l">mode</span>`
    + `<select class="pk-mode" data-k="mode">${opts}</select></div>`;
}

/**
 * Build the knob rows into `root`, reading initial values from getParams(); each change fires
 * a throttled onChange({ [key]: value }).
 */
export function buildKnobs(root, { getParams, onChange, getMaxN, throttleMs = 150 }) {
  const P = getParams();
  const nMax = Math.max(1, Math.round((getMaxN && getMaxN()) || 200));
  root.innerHTML =
    modeRow(P.mode || 'proportional') +
    row('δ', 'delta', P.delta, 0.01, 1, 0.01) +
    row('λ (d)', 'lam', lamToSlider(P.lam), 0, LAM_STOPS, 1, lamLabel(P.lam)) +
    row('N', 'n', P.n, 1, nMax, 1) + row('Ct<', 'ctThreshold', P.ctThreshold, 1, 45, 1) +
    row('bin (d)', 'binWidthDays', P.binWidthDays, 1, 30, 1) +
    row('floor', 'floorSize', P.floorSize ?? 1, 1, 5, 1) +
    row('cap', 'floorBudgetCap', capToSlider(P.floorBudgetCap), 0, 100, 1, capLabel(P.floorBudgetCap));

  let pending = null, timer = null, lastRun = 0;
  const applyNow = () => { timer = null; lastRun = Date.now(); const p = pending; pending = null; if (p) onChange(p); };
  const queue = (k, v) => {
    pending = { ...(pending || {}), [k]: v };
    const wait = throttleMs - (Date.now() - lastRun);
    if (wait <= 0) applyNow();
    else if (!timer) timer = setTimeout(applyNow, wait);
  };

  // Grey + disable the floor controls when the mode is proportional-only.
  function syncFloorEnabled(mode) {
    const off = mode === 'proportional';
    ['floorSize', 'floorBudgetCap'].forEach((k) => {
      const r = root.querySelector(`[data-row="${k}"]`);
      if (!r) return;
      r.classList.toggle('pk-disabled', off);
      r.querySelector('input').disabled = off;
    });
  }
  syncFloorEnabled(P.mode || 'proportional');

  root.querySelectorAll('input[type="range"]').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.k;
    const v = k === 'lam' ? lamFromSlider(parseFloat(inp.value))
      : k === 'floorBudgetCap' ? capFromSlider(parseFloat(inp.value))
      : parseFloat(inp.value);
    const disp = k === 'lam' ? lamLabel(v) : k === 'floorBudgetCap' ? capLabel(v) : inp.value;
    root.querySelector(`[data-v="${k}"]`).textContent = disp;   // instant readout
    queue(k, v);                                                // throttled onChange
  }));

  const modeSel = root.querySelector('select[data-k="mode"]');
  modeSel.addEventListener('change', () => { syncFloorEnabled(modeSel.value); onChange({ mode: modeSel.value }); });

  // Re-sync sliders + the mode select to the current (shared) params — call when this strip
  // becomes visible, so it never shows stale values after the other strip was used.
  function refresh() {
    const P = getParams();
    root.querySelectorAll('input[type="range"]').forEach((inp) => {
      const k = inp.dataset.k;
      inp.value = k === 'lam' ? lamToSlider(P[k]) : k === 'floorBudgetCap' ? capToSlider(P[k]) : P[k];
      const disp = k === 'lam' ? lamLabel(P[k]) : k === 'floorBudgetCap' ? capLabel(P[k]) : String(P[k]);
      root.querySelector(`[data-v="${k}"]`).textContent = disp;
    });
    const m = P.mode || 'proportional';
    root.querySelector('select[data-k="mode"]').value = m;
    syncFloorEnabled(m);
  }
  return { refresh };
}
```

- [ ] **Step 2: Add the disabled-row style**

Append to `src/style.css` (near the `.prio-knobs` block, ~line 463):

```css
.pk-row.pk-disabled { opacity: 0.4; pointer-events: none; }
.pk-row .pk-mode { flex: 1; min-width: 0; font-size: 11px; }
```

- [ ] **Step 3: Verify in the browser (page + map)**

Run: `npm run dev`
Expected:
- Prioritisation page knob strip shows a **mode** dropdown plus **floor** and **cap** sliders; floor/cap are greyed when mode = "Proportional only" and enable on "Floor + proportional"/"Floor only".
- Activate prioritisation (map "To sequence" metric) → the **on-map** knob strip shows the same new controls, and changing mode/floor on one strip is reflected on the other when re-shown.

- [ ] **Step 4: Commit**

```bash
git add src/prio-knobs.js src/style.css
git commit -m "Add mode selector + floor knobs to the shared knob strip"
```

---

## Task 6: Heatmap — floor/proportional tooltip breakdown

**Files:**
- Modify: `src/prio-heatmap.js`

Colour stays keyed to total `selected`; the tooltip gains the split when both layers contributed.

- [ ] **Step 1: Update `showTip`**

In `src/prio-heatmap.js`, replace the "to sequence" line inside `showTip` (the `<div><span style="color:${TEAL}">to sequence <b>${c.selected}</b></span></div>` fragment) with:

```js
          + `<div><span style="color:${TEAL}">to sequence <b>${c.selected}</b></span>`
            + ((c.floorSelected > 0 && c.propSelected > 0)
              ? ` <span style="color:#9c968b">(floor ${c.floorSelected} + prop ${c.propSelected})</span>` : '')
            + `</div>`
```

(When only one layer contributed, the total already equals that layer's count, so no breakdown is shown.)

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev`
Expected: in "Floor + proportional" mode, hovering a cell that received both kinds of picks shows `to sequence N (floor f + prop p)`; cells with a single layer show just the total.

- [ ] **Step 3: Commit**

```bash
git add src/prio-heatmap.js
git commit -m "Show floor/proportional split in the heatmap tooltip"
```

---

## Task 7: Methodology — coverage-floor section + δ-table reword

**Files:**
- Modify: `src/prioritise-panel.js`

- [ ] **Step 1: Add the coverage-floor section constant**

In `src/prioritise-panel.js`, add a new constant after `METHODOLOGY_HTML`:

```js
const COVERAGE_FLOOR_HTML = `
  <h4>Coverage floor</h4>
  <p>The proportional scheme above treats cells independently, so a location with low
  relative risk can receive <strong>zero</strong> sequences when budget is tight. The
  <strong>coverage floor</strong> is a priority pass that runs <em>before</em> the
  proportional loop and guarantees every <em>uncovered</em> location — one never sequenced
  (H<sub><em>k</em></sub> = 0) — at least <em>floor&nbsp;size</em> samples, drawn from its
  highest-weight cell(s). Low-risk locations may be under-sampled relative to hotspots; they
  are never shut out.</p>
  <p>Floor picks occupy the top of the ranked list, and their counts update <em>h</em> before
  the proportional loop runs — so the proportional layer sees their effect and does not
  double-count a just-floored location. The floor reuses the <em>same</em> cell weight
  w(<em>k</em>, τ); it changes only <em>which</em> cells are picked first.</p>
  <table>
    <thead><tr><th>Parameter</th><th>Default</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td style="width:90px;">floor size</td><td>1</td><td>Samples guaranteed per uncovered location (capped at availability). 1 = "seen at least once".</td></tr>
      <tr><td style="width:90px;">budget cap</td><td>∞</td><td>Maximum share of the batch budget <em>N</em> the floor may consume; ∞ = uncapped. Protects the proportional layer when many new locations appear at once.</td></tr>
    </tbody>
  </table>
  <p>Three modes are available below: <strong>Proportional only</strong> (the scheme above),
  <strong>Floor + proportional</strong> (floor pass, then proportional spends the rest), and
  <strong>Floor only</strong> (coverage guarantee alone; any remaining budget is unused).</p>
`;
```

- [ ] **Step 2: Insert the section before "Explore the allocation"**

In `createPrioritisationPanel`, change the start of the `container.innerHTML` assignment from:

```js
  container.innerHTML = METHODOLOGY_HTML
    + '<h4>Explore the allocation</h4>'
```

to:

```js
  container.innerHTML = METHODOLOGY_HTML
    + COVERAGE_FLOOR_HTML
    + '<h4>Explore the allocation</h4>'
```

- [ ] **Step 3: Reword the δ table so it no longer claims δ owns coverage**

In `METHODOLOGY_HTML`, replace the δ "→ 0" row:

```js
      <tr>
        <td style="width: 50px;">→ 0</td>
        <td>Every cell with an available, eligible sample has at least one sample sequenced; locations and time periods with low prevalence may be over-represented</td>
      </tr>
```

with:

```js
      <tr>
        <td style="width: 50px;">→ 0</td>
        <td>Spreads effort toward thinly-sampled cells; low-prevalence cells may be over-represented. Coverage of never-sequenced locations is now guaranteed by the <em>coverage floor</em> (below) rather than by driving δ to 0, so δ can sit at its gentle-smoother default.</td>
      </tr>
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`
Expected: a "Coverage floor" section appears immediately above "Explore the allocation"; the δ table's "→ 0" row reads as the reworded text.

- [ ] **Step 5: Commit**

```bash
git add src/prioritise-panel.js
git commit -m "Add coverage-floor methodology section + reword the delta table"
```

---

## Task 8: Exports — `layer` and floor/prop columns

**Files:**
- Modify: `src/prioritise-panel.js`

- [ ] **Step 1: Add `layer` to the ranked-list export**

In the `#dl-ranked` click handler, replace the header + row mapping:

```js
    download('prioritisation_ranked.csv', ['rank,sample_id,location,time_bin,date,weight,layer',
      ...r.selection.map((s) => [s.rank, s.sampleId ?? '', s.location, s.timeBin, binDate(s.timeBin, r.origin), round(s.weight), s.layer].join(','))].join('\n'));
```

- [ ] **Step 2: Add floor/prop columns to the per-cell counts export**

In the `#dl-counts` click handler, replace the header + row mapping:

```js
    download('prioritisation_counts.csv', ['location,time_bin,risk,decay,available,selected,floor_selected,prop_selected,h_final',
      ...r.cellSummary.map((c) => [c.location, c.timeBin, c.risk, c.decay, c.available, c.selected, c.floorSelected, c.propSelected, c.hFinal].join(','))].join('\n'));
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`
Expected: with mode = "Floor + proportional", "⤓ ranked list (CSV)" has a `layer` column (`floor`/`proportional`); "⤓ per-cell counts (CSV)" has `floor_selected` and `prop_selected` columns that sum to `selected`.

- [ ] **Step 4: Commit**

```bash
git add src/prioritise-panel.js
git commit -m "Add layer + floor/prop columns to prioritisation exports"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: PASS — all engine + data tests, including the regression that `mode: 'proportional'` is unchanged.

- [ ] **Smoke-test the build**

Run: `npm run build`
Expected: Vite build succeeds with no errors.

- [ ] **Manual walkthrough** (`npm run dev`): toggle through all three modes on the page and on the map; confirm the heatmap, tooltip, and exports respond and that "Proportional only" reproduces today's allocation.
