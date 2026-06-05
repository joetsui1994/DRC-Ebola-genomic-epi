# Sequencing Prioritisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-dashboard, client-side sequencing-prioritisation feature — a tabbed "Prioritisation" page (methodology + local file upload + activate) that, when active, drives a live "To sequence" map choropleth and a chart time-bin allocation overlay from δ/λ/N/eligibility-Ct/bin_width.

**Architecture:** A pure engine (`prioritise.js`, port of the reference `prioritise.py` greedy "highest-averages" loop) + a pure data-prep (`prioritise-data.js`) that builds (zone × time-bin) cells from the line-list, the geojson `relative_risk`, and the tree-tips history. A `prioritise-panel.js` owns the tab page, the upload (File API, in-browser only), the parameter state, and the recompute, pushing results to the existing map and chart panels via new methods. Public data → per-cell **counts**; a locally-uploaded CSV with `sample_id`s → a downloadable **ranked top-N** list.

**Tech Stack:** Vanilla ES modules + Vite (no framework), Leaflet (map), Vitest (`src/*.test.js`, `environment: node`). Spec: `docs/superpowers/specs/2026-06-05-sequencing-prioritisation-design.md`.

---

## File structure

| File | New/Modify | Responsibility |
|---|---|---|
| `src/prioritise.js` | Create | Pure engine: seeded RNG, cell helpers, greedy `prioritise()` |
| `src/prioritise.test.js` | Create | Engine unit tests (properties + determinism) |
| `src/prioritise-data.js` | Create | Pure: build cells from rows + risk + history; parse upload CSV |
| `src/prioritise-data.test.js` | Create | Data-prep unit tests |
| `src/prioritise-panel.js` | Create | Tab page (methodology + upload + activate), parameter state, recompute controller, downloads |
| `src/map-panel.js` | Modify | Tab strip (Map/Prioritisation); `setPrioritisation()` / `setToSequence()` (dynamic "To sequence" metric); on-map knobs panel |
| `src/timeseries-panel.js` | Modify | `setAllocation()` — time-bin to-sequence overlay track |
| `src/main.js` | Modify | Build risk map + history; create the prioritisation panel; wire it to map + chart |
| `src/style.css` | Modify | Tab strip, prioritisation page, knobs panel, allocation overlay |

Defaults: `delta=0.5`, `lam=14`, `n=30`, `ctThreshold=31`, `binWidthDays=7`, `seed=1`.

---

## Task 1: Engine helpers (`prioritise.js` — RNG, cells, decay)

**Files:**
- Create: `src/prioritise.js`
- Test: `src/prioritise.test.js`

- [ ] **Step 1: Write failing tests for the helpers**

```js
// src/prioritise.test.js
import { describe, it, expect } from 'vitest';
import { mulberry32, assignCell, decay } from './prioritise.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed and in [0,1)', () => {
    const a = mulberry32(1), b = mulberry32(1);
    const xs = [a(), a(), a()], ys = [b(), b(), b()];
    expect(xs).toEqual(ys);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });
});

describe('assignCell', () => {
  const origin = '2026-04-05';
  it('bins day-offsets by width (floor)', () => {
    expect(assignCell('2026-04-05', origin, 7)).toBe(0);
    expect(assignCell('2026-04-11', origin, 7)).toBe(0);   // day 6
    expect(assignCell('2026-04-12', origin, 7)).toBe(1);   // day 7
    expect(assignCell('2026-04-26', origin, 7)).toBe(3);   // day 21
  });
});

describe('decay', () => {
  const origin = '2026-04-05';
  it('returns 1 when lam is null or infinite', () => {
    expect(decay(0, origin, 7, '2026-06-01', null)).toBe(1);
    expect(decay(0, origin, 7, '2026-06-01', Infinity)).toBe(1);
  });
  it('decays older bins more (monotone in age)', () => {
    const tNow = '2026-06-01';
    const recent = decay(7, origin, 7, tNow, 14);   // newer bin
    const old = decay(0, origin, 7, tNow, 14);       // older bin
    expect(recent).toBeGreaterThan(old);
    expect(recent).toBeLessThanOrEqual(1);
    expect(old).toBeGreaterThan(0);
  });
  it('exp(-age/lam) at the bin midpoint; age floored at 0', () => {
    // bin 0 midpoint = origin + 3.5 days; tNow = origin + 3.5 days => age 0 => 1
    expect(decay(0, origin, 7, '2026-04-08T12:00:00', 14)).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/prioritise.test.js`
Expected: FAIL — "Failed to resolve import './prioritise.js'".

- [ ] **Step 3: Implement the helpers**

```js
// src/prioritise.js
// Pure port of the reference prioritise.py engine (sampling_heuristic). No DOM.

const MS_PER_DAY = 86400000;

/** Small deterministic PRNG → function returning floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map a date to an integer time-bin index relative to `origin`. */
export function assignCell(date, origin, binWidthDays) {
  const days = (+new Date(date) - +new Date(origin)) / MS_PER_DAY;
  return Math.floor(days / binWidthDays);
}

/** exp(-age/lam) at the bin midpoint; 1 when lam is null/∞; age floored at 0. */
export function decay(binIndex, origin, binWidthDays, tNow, lam) {
  if (lam == null || !isFinite(lam)) return 1;
  const cellMid = +new Date(origin) + (binIndex + 0.5) * binWidthDays * MS_PER_DAY;
  const ageDays = Math.max((+new Date(tNow) - cellMid) / MS_PER_DAY, 0);
  return Math.exp(-ageDays / lam);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/prioritise.test.js`
Expected: PASS (all helper tests).

- [ ] **Step 5: Commit**

```bash
git add src/prioritise.js src/prioritise.test.js
git commit -m "Add prioritisation engine helpers (RNG, cell binning, decay)"
```

---

## Task 2: Engine — greedy `prioritise()` loop

**Files:**
- Modify: `src/prioritise.js`
- Test: `src/prioritise.test.js`

- [ ] **Step 1: Write failing tests for `prioritise()`**

Append to `src/prioritise.test.js`:

```js
import { prioritise } from './prioritise.js';

// helper: one bin (decay=1 with lam=Infinity), plenty available
const cell = (location, risk, available, h = 0) => ({ location, timeBin: 0, risk, available, h });
const selectedByLoc = (sel) => sel.reduce((m, p) => (m[p.location] = (m[p.location] || 0) + 1, m), {});

describe('prioritise', () => {
  const base = { origin: '2026-04-05', tNow: '2026-04-05', lam: Infinity, binWidthDays: 7, seed: 1 };

  it('Webster (delta=0.5) tracks risk ratios (4:2:1 over N=7)', () => {
    const cells = [cell('A', 4, 10), cell('B', 2, 10), cell('C', 1, 10)];
    const { selection } = prioritise({ ...base, cells, n: 7, delta: 0.5 });
    expect(selection.length).toBe(7);
    expect(selectedByLoc(selection)).toEqual({ A: 4, B: 2, C: 1 });
  });

  it('coverage: small delta covers every nonzero cell before doubling', () => {
    const cells = [cell('A', 4, 10), cell('B', 2, 10), cell('C', 1, 10)];
    const { selection } = prioritise({ ...base, cells, n: 3, delta: 0.01 });
    expect(selectedByLoc(selection)).toEqual({ A: 1, B: 1, C: 1 });
  });

  it('availability cap: a cell never contributes more than it has', () => {
    const cells = [cell('A', 10, 1), cell('B', 1, 10)];
    const { selection, cellSummary } = prioritise({ ...base, cells, n: 5, delta: 0.5 });
    expect(selectedByLoc(selection)).toEqual({ A: 1, B: 4 });
    expect(cellSummary.find(c => c.location === 'A').available).toBe(1); // reports initial available
  });

  it('history carryover: a heavily-sequenced cell is demoted', () => {
    const cells = [cell('A', 4, 10, 8), cell('B', 4, 10, 0)];  // same risk, A already deep
    const { selection } = prioritise({ ...base, cells, n: 4, delta: 0.5 });
    expect(selectedByLoc(selection).B).toBeGreaterThan(selectedByLoc(selection).A || 0);
  });

  it('recency: with finite lam, the recent bin gets more of equal-risk budget', () => {
    const cells = [
      { location: 'A', timeBin: 6, risk: 1, available: 20, h: 0 },  // recent
      { location: 'A', timeBin: 0, risk: 1, available: 20, h: 0 },  // old
    ];
    const { cellSummary } = prioritise({ origin: '2026-04-05', tNow: '2026-06-01', lam: 14, binWidthDays: 7, seed: 1, cells, n: 10, delta: 0.5 });
    const recent = cellSummary.find(c => c.timeBin === 6).selected;
    const old = cellSummary.find(c => c.timeBin === 0).selected;
    expect(recent).toBeGreaterThan(old);
  });

  it('early stop: all-zero risk selects nothing', () => {
    const { selection } = prioritise({ ...base, cells: [cell('A', 0, 10)], n: 5, delta: 0.5 });
    expect(selection.length).toBe(0);
  });

  it('N larger than pool stops early at availability', () => {
    const { selection } = prioritise({ ...base, cells: [cell('A', 1, 2)], n: 5, delta: 0.5 });
    expect(selection.length).toBe(2);
  });

  it('determinism: same seed + ids → identical selection', () => {
    const mk = () => [{ location: 'A', timeBin: 0, risk: 4, available: 3, h: 0, ids: ['a1', 'a2', 'a3'] },
                      { location: 'B', timeBin: 0, risk: 1, available: 3, h: 0, ids: ['b1', 'b2', 'b3'] }];
    const s1 = prioritise({ ...base, cells: mk(), n: 4, delta: 0.5 }).selection;
    const s2 = prioritise({ ...base, cells: mk(), n: 4, delta: 0.5 }).selection;
    expect(s1).toEqual(s2);
    expect(s1.every(p => p.sampleId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/prioritise.test.js`
Expected: FAIL — "prioritise is not a function".

- [ ] **Step 3: Implement `prioritise()`**

Append to `src/prioritise.js`:

```js
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Greedy "highest-averages" prioritisation.
 * cells: [{ location, timeBin, risk, available, h, ids? }]
 * Returns { selection, cellSummary } (selection in rank order; cellSummary per cell).
 */
export function prioritise({ cells, n, delta = 0.5, lam = 14, binWidthDays = 7, origin, tNow, seed = 1 }) {
  const rng = mulberry32(seed);
  const C = cells.map((c) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    available0: c.available, available: c.available, h: c.h || 0, selected: 0,
    ids: c.ids ? [...c.ids] : null,
  }));
  for (const c of C) if (c.ids) shuffle(c.ids, rng);
  const decayC = C.map((c) => decay(c.timeBin, origin, binWidthDays, tNow, lam));

  const selection = [];
  for (let rank = 1; rank <= n; rank++) {
    const elig = [];
    for (let i = 0; i < C.length; i++) {
      if (C[i].available <= 0 || C[i].risk <= 0) continue;
      elig.push({ i, w: C[i].risk / (C[i].h + delta) * decayC[i] });
    }
    if (!elig.length) break;
    const wmax = elig.reduce((m, e) => (e.w > m ? e.w : m), -Infinity);
    const ties = elig.filter((e) => e.w >= wmax - 1e-9 * wmax).map((e) => e.i);
    const idx = ties.length > 1 ? ties[Math.floor(rng() * ties.length)] : ties[0];
    const c = C[idx];
    selection.push({
      rank, location: c.location, timeBin: c.timeBin,
      weight: c.risk / (c.h + delta) * decayC[idx],
      sampleId: c.ids ? c.ids.pop() : null,
    });
    c.available -= 1; c.h += 1; c.selected += 1;
  }

  const cellSummary = C.map((c, i) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    decay: Math.round(decayC[i] * 1000) / 1000,
    available: c.available0, selected: c.selected, hFinal: c.h,
  })).sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : a.timeBin - b.timeBin));

  return { selection, cellSummary };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/prioritise.test.js`
Expected: PASS (all engine tests).

- [ ] **Step 5: Commit**

```bash
git add src/prioritise.js src/prioritise.test.js
git commit -m "Add greedy highest-averages prioritise() engine"
```

---

## Task 3: Data prep — `prioritise-data.js`

**Files:**
- Create: `src/prioritise-data.js`
- Test: `src/prioritise-data.test.js`

`buildCells` turns rows + risk + history into engine cells. `parseUpload` parses an uploaded CSV into rows.

- [ ] **Step 1: Write failing tests**

```js
// src/prioritise-data.test.js
import { describe, it, expect } from 'vitest';
import { buildCells, parseUpload } from './prioritise-data.js';

const risk = new Map([['BUNIA', 0.9], ['KATWA', 0.5]]);   // upper Nom -> relative_risk
const canon = (z) => (z || '').trim();                    // identity for the test

describe('buildCells', () => {
  it('keeps eligible positives (ct < threshold, valid zone/date) and bins them', () => {
    const rows = [
      { health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' }, // bin 0
      { health_zone: 'Bunia', status: 'Positive', ct: '30', date: '2026-04-12' }, // bin 1
      { health_zone: 'Bunia', status: 'Negative', ct: '20', date: '2026-04-05' }, // dropped: not positive
      { health_zone: 'Bunia', status: 'Positive', ct: '33', date: '2026-04-05' }, // dropped: ct >= 31
      { health_zone: 'Nowhere', status: 'Positive', ct: '20', date: '2026-04-05' }, // dropped: zone not in risk
      { health_zone: 'Katwa', status: 'Positive', ct: '', date: '2026-04-05' },    // dropped: no ct
    ];
    const { cells, diagnostics } = buildCells({ candidateRows: rows, risk, canon, ctThreshold: 31, binWidthDays: 7 });
    const bunia0 = cells.find((c) => c.location === 'BUNIA' && c.timeBin === 0);
    expect(bunia0.available).toBe(1);
    expect(bunia0.risk).toBe(0.9);
    expect(cells.find((c) => c.location === 'BUNIA' && c.timeBin === 1).available).toBe(1);
    expect(diagnostics.kept).toBe(2);
    expect(diagnostics.dropped).toBe(4);
  });

  it('subtractHistory=true sets available = eligible - sequenced, h = sequenced', () => {
    const candidateRows = [
      { health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' },
      { health_zone: 'Bunia', status: 'Positive', ct: '25', date: '2026-04-05' },
      { health_zone: 'Bunia', status: 'Positive', ct: '26', date: '2026-04-05' },
    ];
    const sequencedRows = [{ health_zone: 'Bunia', date: '2026-04-05' }]; // 1 tip in bin 0
    const { cells } = buildCells({ candidateRows, sequencedRows, risk, canon, ctThreshold: 31, binWidthDays: 7, subtractHistory: true });
    const c = cells.find((x) => x.location === 'BUNIA' && x.timeBin === 0);
    expect(c.available).toBe(2);  // 3 eligible - 1 sequenced
    expect(c.h).toBe(1);
  });

  it('withIds attaches a sample-id pool per cell', () => {
    const candidateRows = [
      { sample_id: 'X1', health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' },
      { sample_id: 'X2', health_zone: 'Bunia', status: 'Positive', ct: '25', date: '2026-04-05' },
    ];
    const { cells } = buildCells({ candidateRows, risk, canon, ctThreshold: 31, binWidthDays: 7, withIds: true });
    expect(cells[0].ids.sort()).toEqual(['X1', 'X2']);
    expect(cells[0].available).toBe(2);
  });
});

describe('parseUpload', () => {
  it('parses header + rows, flags sequenced, tolerates DD/MM/YYYY', () => {
    const csv = 'sample_id,health_zone,status,ct,date,sequenced\n'
      + 'A1,Bunia,Positive,24,2026-04-05,\n'
      + 'A2,Katwa,Positive,22,06/04/2026,1\n';
    const { rows } = parseUpload(csv);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ sample_id: 'A1', health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05', sequenced: false });
    expect(rows[1]).toMatchObject({ sample_id: 'A2', date: '2026-04-06', sequenced: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/prioritise-data.test.js`
Expected: FAIL — "Failed to resolve import './prioritise-data.js'".

- [ ] **Step 3: Implement `prioritise-data.js`**

```js
// src/prioritise-data.js
// Pure: build engine cells from line-list rows + risk + history; parse an upload CSV.
import { assignCell } from './prioritise.js';

const up = (s) => (s || '').toUpperCase().trim();

// DD/MM/YYYY -> ISO; pass through ISO; '' otherwise.
function normDate(d) {
  const s = (d || '').trim();
  if (!s) return '';
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isNaN(+new Date(iso)) ? '' : iso; }
  return isNaN(+new Date(s)) ? '' : s;
}

/**
 * @returns { cells, origin, tNow, diagnostics }
 *   cells: [{ location, timeBin, risk, available, h, ids? }]  (location = upper canonical Nom)
 *   diagnostics: { kept, dropped, byReason: {notPositive, ctIneligible, badDate, unknownZone} }
 */
export function buildCells({
  candidateRows, sequencedRows = [], risk, canon, ctThreshold, binWidthDays,
  subtractHistory = false, withIds = false, origin = null, tNow = null,
}) {
  const reason = { notPositive: 0, ctIneligible: 0, badDate: 0, unknownZone: 0 };
  const eligible = [];
  for (const r of candidateRows) {
    if (r.status !== 'Positive') { reason.notPositive++; continue; }
    const ct = parseFloat(r.ct);
    if (!Number.isFinite(ct) || ct >= ctThreshold) { reason.ctIneligible++; continue; }
    const date = normDate(r.date);
    if (!date) { reason.badDate++; continue; }
    const loc = up(canon(r.health_zone));
    if (!risk.has(loc)) { reason.unknownZone++; continue; }
    eligible.push({ ...r, date, loc });
  }

  const seq = [];
  for (const r of sequencedRows) {
    const date = normDate(r.date);
    const loc = up(canon(r.health_zone));
    if (date && risk.has(loc)) seq.push({ date, loc });
  }

  const allDates = [...eligible.map((r) => r.date), ...seq.map((r) => r.date)].sort();
  const o = origin || allDates[0] || '2026-01-01';
  const t = tNow || allDates[allDates.length - 1] || o;

  // h per cell from history
  const hMap = new Map();
  for (const r of seq) {
    const key = `${r.loc}|${assignCell(r.date, o, binWidthDays)}`;
    hMap.set(key, (hMap.get(key) || 0) + 1);
  }

  // candidate pool per cell
  const pool = new Map();   // key -> { location, timeBin, count, ids }
  for (const r of eligible) {
    const tb = assignCell(r.date, o, binWidthDays);
    const key = `${r.loc}|${tb}`;
    let p = pool.get(key);
    if (!p) { p = { location: r.loc, timeBin: tb, count: 0, ids: withIds ? [] : null }; pool.set(key, p); }
    p.count++;
    if (withIds) p.ids.push(r.sample_id);
  }

  const cells = [];
  for (const [key, p] of pool) {
    const h = hMap.get(key) || 0;
    const available = subtractHistory ? Math.max(0, p.count - h) : p.count;
    if (available <= 0) continue;
    cells.push({
      location: p.location, timeBin: p.timeBin, risk: risk.get(p.location),
      available, h, ids: withIds ? p.ids : undefined,
    });
  }

  return { cells, origin: o, tNow: t, diagnostics: { kept: eligible.length, dropped: candidateRows.length - eligible.length, byReason: reason } };
}

/** Parse an uploaded CSV (naive split; header case-insensitive) into rows. */
export function parseUpload(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (!lines.length) return { rows: [], header: [] };
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iId = idx('sample_id'), iZone = idx('health_zone'), iStatus = idx('status'),
        iCt = idx('ct'), iDate = idx('date'), iArea = idx('health_area'), iSeq = idx('sequenced');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    rows.push({
      sample_id: iId >= 0 ? (c[iId] || '').trim() : '',
      health_zone: iZone >= 0 ? (c[iZone] || '').trim() : '',
      health_area: iArea >= 0 ? (c[iArea] || '').trim() : '',
      status: iStatus >= 0 ? (c[iStatus] || '').trim() : '',
      ct: iCt >= 0 ? (c[iCt] || '').trim() : '',
      date: normDate(iDate >= 0 ? c[iDate] : ''),
      sequenced: iSeq >= 0 ? /^(1|true|yes|y)$/i.test((c[iSeq] || '').trim()) : false,
    });
  }
  return { rows, header };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/prioritise-data.test.js && npm test`
Expected: PASS (data-prep + all existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/prioritise-data.js src/prioritise-data.test.js
git commit -m "Add prioritisation data-prep (buildCells + parseUpload)"
```

---

## Task 4: Map panel — tab strip + Prioritisation page shell

Add a Map/Prioritisation tab strip to the map panel and a (static, methodology-only) prioritisation page. No compute yet.

**Files:**
- Modify: `index.html` (give the map panel a tab strip + two body containers)
- Modify: `src/map-panel.js` (don't break — it targets `map-body`)
- Modify: `src/style.css`

- [ ] **Step 1: Update `index.html`** — replace the map panel block:

Find:
```html
    <div id="map" class="panel"><h3>Outbreak map</h3><div id="map-body" class="panel-body"></div></div>
```
Replace with:
```html
    <div id="map" class="panel">
      <h3>Outbreak map <span class="map-tabs"><button id="tab-map" class="map-tab active" type="button">Map</button><button id="tab-prio" class="map-tab" type="button">Prioritisation</button></span></h3>
      <div id="map-body" class="panel-body"></div>
      <div id="prio-body" class="panel-body" style="display:none; overflow:auto; padding:14px 16px;"></div>
    </div>
```

- [ ] **Step 2: Add tab CSS** — append to `src/style.css`:

```css
/* Map panel tabs (Map / Prioritisation) */
.map-tabs { float: right; display: inline-flex; gap: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.map-tab { font-size: 9.5px; font-weight: 600; letter-spacing: 0.03em; text-transform: none; padding: 1px 8px; border: none; background: transparent; color: var(--muted); cursor: pointer; }
.map-tab.active { background: var(--terracotta); color: #fff; }
#prio-body { font-size: 12px; color: var(--ink); line-height: 1.5; }
#prio-body h4 { margin: 12px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
#prio-body code { background: rgba(124,29,29,0.07); padding: 0 3px; border-radius: 3px; }
```

- [ ] **Step 3: Wire the tabs** — append to `src/map-panel.js` inside `createMapPanel`, just before `return {`:

```js
  // Map / Prioritisation tab switch. Returning to the map re-sizes Leaflet.
  const mapBody = document.getElementById('map-body');
  const prioBody = document.getElementById('prio-body');
  const tabMap = document.getElementById('tab-map');
  const tabPrio = document.getElementById('tab-prio');
  function showTab(which) {
    const onMap = which === 'map';
    mapBody.style.display = onMap ? '' : 'none';
    prioBody.style.display = onMap ? 'none' : '';
    tabMap?.classList.toggle('active', onMap);
    tabPrio?.classList.toggle('active', !onMap);
    if (onMap) requestAnimationFrame(() => map.invalidateSize());
  }
  tabMap?.addEventListener('click', () => showTab('map'));
  tabPrio?.addEventListener('click', () => showTab('prio'));
```

- [ ] **Step 4: Add `prioBody` accessor to the map API** — in the `return { ... }` object add:

```js
    /** The Prioritisation tab body element (the panel renders into it). */
    prioBody: () => document.getElementById('prio-body'),
```

- [ ] **Step 5: Verify build + tabs work**

Run: `npm run build`
Expected: "build OK". Manually (`npm run dev`): the map panel header shows Map/Prioritisation; clicking toggles the (empty) prioritisation body and back to the map (which re-sizes correctly).

- [ ] **Step 6: Commit**

```bash
git add index.html src/map-panel.js src/style.css
git commit -m "Add Map/Prioritisation tab strip to the map panel"
```

---

## Task 5: Prioritisation panel + public-mode compute + "To sequence" map metric

The big integration: build the page (methodology + activate), the recompute controller (public data), and the dynamic "To sequence" map metric.

**Files:**
- Create: `src/prioritise-panel.js`
- Modify: `src/map-panel.js` (add `setPrioritisation`, `setToSequence`)
- Modify: `src/main.js` (build risk + history; create the panel; wire)
- Modify: `src/style.css`

- [ ] **Step 1: Map panel — dynamic "To sequence" metric.** In `src/map-panel.js` `addZoneLayer`, after the `METRICS = { ... }` object literal, add a `toSequence` metric and a per-zone store. Add to the `METRICS` object (after `total:`):

```js
        toSequence:   { label: 'To sequence',         ramp: TOSEQ_RAMP,               kind: 'count', fmt: intFmt, value: (f) => toSeqByZone.get(upper(f.properties.Nom)) || 0 },
```

At the top of `src/map-panel.js` (near `STATUS_RAMP`), add:
```js
const TOSEQ_RAMP = ['#e7eef0', '#bcd4c9', '#86b8a0', '#4f8f78', '#205c4c'];   // "to sequence" (teal-green)
```

In the scope vars block (near `let ctThreshold = null;`) add:
```js
  let toSeqByZone = new Map();   // upper Nom -> to-sequence count (prioritisation)
  let prioActive = false;
```

After `applyCtThreshold = () => {...}` add an apply hook for to-sequence:
```js
      // Prioritisation: recompute the "To sequence" metric + redraw if it's active.
      applyToSeq = () => { recomputeBreaks(METRICS.toSequence); if (metric === 'toSequence') { restyle(); renderLegend(); } };
```
and declare `let applyToSeq = null;` in the scope vars block.

- [ ] **Step 2: Map panel — gate the `toSequence` button + add API.** In the metric button group `ORDER`/`SHORT`/`FULL` (inside `groupCtl.onAdd`), add `toSequence` conditionally. Replace the `ORDER` line:

```js
      const ORDER = ['off', 'risk', 'Positive', 'Negative', 'Invalid', 'Unclassified', 'total'].concat(prioActive ? ['toSequence'] : []);
      const SHORT = { off: 'Off', risk: 'Risk', Positive: 'Pos', Negative: 'Neg', Invalid: 'Inv', Unclassified: 'Unc', total: 'Total', toSequence: 'Seq→' };
      const FULL  = { off: 'Hide colour', risk: 'Relative risk', Positive: 'Positive samples', Negative: 'Negative samples', Invalid: 'Invalid samples', Unclassified: 'Unclassified samples', total: 'Total samples', toSequence: 'To sequence (prioritisation)' };
```

Refactor the group build into a function so it can be rebuilt when `prioActive` changes. Replace the `const groupCtl = L.control(...) ... groupCtl.addTo(map);` block with:

```js
      let groupDiv = null;
      const buildGroup = () => {
        if (!groupDiv) return;
        groupDiv.replaceChildren();
        for (const key of ORDER) {
          const b = L.DomUtil.create('button', key === metric ? 'active' : '', groupDiv);
          b.type = 'button'; b.textContent = SHORT[key]; b.title = FULL[key]; b.dataset.metric = key;
          b.onclick = () => { metric = key; [...groupDiv.children].forEach((c) => c.classList.toggle('active', c.dataset.metric === key)); restyle(); renderLegend(); };
        }
      };
      const groupCtl = L.control({ position: 'topright' });
      groupCtl.onAdd = () => { groupDiv = L.DomUtil.create('div', 'choropleth-group'); L.DomEvent.disableClickPropagation(groupDiv); buildGroup(); return groupDiv; };
      groupCtl.addTo(map);
      rebuildGroup = buildGroup;
```
(`ORDER`/`SHORT`/`FULL` must be declared with `let`/`const` in the enclosing `addZoneLayer` scope so `buildGroup` re-reads `ORDER`; move `const ORDER = ...` so it is recomputed inside `buildGroup` — i.e. compute `ORDER` *inside* `buildGroup`:)

```js
      const buildGroup = () => {
        if (!groupDiv) return;
        const ORDER = ['off', 'risk', 'Positive', 'Negative', 'Invalid', 'Unclassified', 'total'].concat(prioActive ? ['toSequence'] : []);
        groupDiv.replaceChildren();
        for (const key of ORDER) { /* …as above… */ }
      };
```
Declare `let rebuildGroup = null;` in the scope vars block.

- [ ] **Step 3: Map panel — public API methods.** Add to the returned object:

```js
    /** Turn the "To sequence" metric on/off (rebuilds the metric button group). */
    setPrioritisation(active) {
      prioActive = !!active;
      if (!active && metric === 'toSequence') metric = 'risk';
      rebuildGroup?.();
      if (active) metric = 'toSequence';
      rebuildGroup?.();
      restyle?.(); renderLegendSafe();
    },
    /** Update per-zone to-sequence counts (upper Nom -> count) and redraw if active. */
    setToSequence(byZone) { toSeqByZone = byZone || new Map(); applyToSeq?.(); },
```
where `renderLegendSafe` is a tiny scope helper added near `restyle`:
```js
  let renderLegendRef = null;        // set inside addZoneLayer
  const renderLegendSafe = () => renderLegendRef?.();
```
and inside `addZoneLayer`, after `const renderLegend = () => {...}` add `renderLegendRef = renderLegend;`. (Also change `applyToSeq`/`applyCtThreshold` to reference `renderLegend` directly as they already do.)

- [ ] **Step 4: Create `src/prioritise-panel.js`.**

```js
// src/prioritise-panel.js
// Prioritisation tab: methodology write-up + local upload + activate switch + knobs,
// running the client-side engine and pushing results to the map + chart panels.
import { prioritise } from './prioritise.js';
import { buildCells, parseUpload } from './prioritise-data.js';

const DEFAULTS = { delta: 0.5, lam: 14, n: 30, ctThreshold: 31, binWidthDays: 7 };

const METHODOLOGY_HTML = `
  <h4>What this does</h4>
  <p>Ranks unsequenced <em>sequenceable</em> samples so cumulative sequencing tracks
  <strong>relative risk</strong> across (health-zone × time-bin) cells, favouring
  <strong>recent</strong> and <strong>under-sequenced</strong> cells. Each cell gets a weight</p>
  <p style="text-align:center"><code>w = risk / (h + δ) · exp(−age/λ)</code></p>
  <p>and a greedy loop repeatedly picks the highest-weight cell, draws one sample, and
  bumps that cell's <code>h</code> — <em>N</em> times. The pick order is the ranking.</p>
  <h4>The knobs</h4>
  <ul style="margin:0;padding-left:18px">
    <li><strong>δ</strong> — coverage vs strict proportionality (small spreads to thin cells; ~0.5 near-proportional; large concentrates on hotspots).</li>
    <li><strong>λ</strong> — recency timescale in days (∞ = flat in time).</li>
    <li><strong>N</strong> — batch budget (how many to sequence).</li>
    <li><strong>Eligibility Ct</strong> — a positive is sequenceable if its Ct is strictly below this.</li>
    <li><strong>bin width</strong> — days per time-bin.</li>
  </ul>
  <h4>Data used</h4>
  <p>Candidates = eligible positives from the line-list; <code>risk</code> = each zone's
  relative risk; history (<code>h</code>) = the sequences already in the tree. With the
  public (de-identified) data we can only show <strong>how many</strong> to sequence per
  zone × time — not which. Upload your own line-list (with sample IDs) to get the actual
  ranked list; <strong>your file is parsed in your browser and never uploaded anywhere.</strong></p>
`;

export function createPrioritisationPanel(container, { risk, canon, tips, onChange }) {
  container.innerHTML = METHODOLOGY_HTML
    + '<h4>Run</h4>'
    + '<label class="prio-up"><input type="file" id="prio-file" accept=".csv,text/csv"> upload a line-list (local only)</label>'
    + '<div id="prio-diag" class="prio-diag"></div>'
    + '<label class="prio-act"><input type="checkbox" id="prio-active"> Activate prioritisation</label>'
    + '<div id="prio-dl"></div>';

  const fileEl = container.querySelector('#prio-file');
  const diagEl = container.querySelector('#prio-diag');
  const activeEl = container.querySelector('#prio-active');
  const dlEl = container.querySelector('#prio-dl');

  const seqRows = (tips || []).filter((t) => t.date).map((t) => ({ health_zone: t.health_zone, date: t.date }));
  let uploadRows = null;                 // null = public mode
  let params = { ...DEFAULTS };
  let lastCellSummary = [], lastSelection = [];

  function compute() {
    const inUpload = !!uploadRows;
    const candidateRows = inUpload ? uploadRows.filter((r) => !r.sequenced)
                                   : window.__PRIO_LINELIST__ || [];
    const sequencedRows = inUpload ? uploadRows.filter((r) => r.sequenced) : seqRows;
    const { cells, origin, tNow, diagnostics } = buildCells({
      candidateRows, sequencedRows, risk, canon,
      ctThreshold: params.ctThreshold, binWidthDays: params.binWidthDays,
      subtractHistory: !inUpload, withIds: inUpload,
    });
    const { selection, cellSummary } = prioritise({
      cells, n: params.n, delta: params.delta, lam: params.lam,
      binWidthDays: params.binWidthDays, origin, tNow, seed: 1,
    });
    lastCellSummary = cellSummary; lastSelection = selection;
    if (inUpload) diagEl.textContent = `${diagnostics.kept} eligible, ${diagnostics.dropped} dropped · ${selection.length} selected`;
    onChange({ active: activeEl.checked, cellSummary, selection, mode: inUpload ? 'upload' : 'public' });
    renderDownloads(inUpload);
  }

  function renderDownloads(inUpload) {
    dlEl.replaceChildren();
    if (!activeEl.checked) return;
    const counts = document.createElement('button'); counts.className = 'prio-dl-btn'; counts.textContent = '⤓ counts CSV';
    counts.onclick = () => download('prioritisation_counts.csv',
      ['location,time_bin,risk,decay,available,selected,h_final',
        ...lastCellSummary.map((c) => [c.location, c.timeBin, c.risk, c.decay, c.available, c.selected, c.hFinal].join(','))].join('\n'));
    dlEl.appendChild(counts);
    if (inUpload) {
      const list = document.createElement('button'); list.className = 'prio-dl-btn'; list.textContent = '⤓ ranked list CSV';
      list.onclick = () => download('prioritisation_ranked.csv',
        ['rank,sample_id,location,time_bin,weight',
          ...lastSelection.map((s) => [s.rank, s.sampleId, s.location, s.timeBin, s.weight].join(','))].join('\n'));
      dlEl.appendChild(list);
    }
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  fileEl.addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { uploadRows = parseUpload(String(reader.result)).rows; compute(); };
    reader.readAsText(f);
  });
  activeEl.addEventListener('change', () => { onChange({ active: activeEl.checked }); if (activeEl.checked) compute(); });

  return {
    /** Update knobs (from the on-map panel) and recompute. */
    setParams(p) { params = { ...params, ...p }; if (activeEl.checked) compute(); },
    isActive: () => activeEl.checked,
    getParams: () => ({ ...params }),
  };
}
```

- [ ] **Step 5: Wire in `main.js`.** After the geojson `.then(zones => { map.addZoneLayer(...) ...})` block resolves we need `risk` + the panel. Add near the top (after `canon` is defined): a holder for the public line-list rows used by `compute()`:

```js
// Expose the raw line-list rows (public mode candidates) to the prioritisation engine.
window.__PRIO_LINELIST__ = parseLinelist(linelistText, canon).map((r, i) => ({ ...r }));
```
Inside the geojson `.then(zones => {...})`, after `map.addZoneLayer(zones, zoneCounts, zonePosCt);` add:
```js
    const risk = new Map(zones.features.map((f) => [(f.properties.Nom || '').toUpperCase().trim(), f.properties.relative_risk]));
    const prio = createPrioritisationPanel(map.prioBody(), {
      risk, canon, tips: seqTips,
      onChange: ({ active, cellSummary }) => {
        map.setPrioritisation(active);
        if (cellSummary) {
          const byZone = new Map();
          for (const c of cellSummary) byZone.set(c.location, (byZone.get(c.location) || 0) + c.selected);
          map.setToSequence(byZone);
          ts.setAllocation(active ? cellSummary : null);   // Task 7
        }
        if (!active) { map.setToSequence(new Map()); ts.setAllocation(null); }
      },
    });
    map.attachPrioKnobs?.(prio);   // Task 6
```
Add the import at the top:
```js
import { createPrioritisationPanel } from './prioritise-panel.js';
```

- [ ] **Step 6: Add panel + download CSS** — append to `src/style.css`:

```css
.prio-up, .prio-act { display: block; margin: 8px 0; font-size: 12px; }
.prio-diag { font-size: 11px; color: var(--muted); margin: 4px 0; }
.prio-dl-btn { margin: 6px 8px 0 0; font-size: 10px; font-weight: 600; color: var(--maroon);
  background: rgba(124,29,29,0.08); border: 1px solid rgba(124,29,29,0.25); border-radius: 5px; padding: 2px 8px; cursor: pointer; }
```

- [ ] **Step 7: Verify** — `npm run build` → "build OK". `npm run dev`: open Prioritisation tab → methodology shows; tick Activate → back on Map tab a "Seq→" button appears in the metric group and zones shade by to-sequence count; the counts-CSV download works.

- [ ] **Step 8: Commit**

```bash
git add src/prioritise-panel.js src/map-panel.js src/main.js src/style.css
git commit -m "Add prioritisation page + public compute + 'To sequence' map metric"
```

---

## Task 6: On-map knobs panel

When active, show a small control panel on the map (bottom-left) with δ, λ, N, eligibility-Ct, bin_width; changes call `prio.setParams()` → recompute.

**Files:**
- Modify: `src/map-panel.js` (add `attachPrioKnobs`)
- Modify: `src/style.css`

- [ ] **Step 1: Add `attachPrioKnobs` to the map API.** In `src/map-panel.js` returned object:

```js
    /** Add an on-map knobs panel (shown only while prioritisation is active). */
    attachPrioKnobs(prio) {
      const ctl = L.control({ position: 'bottomleft' });
      ctl.onAdd = () => {
        const d = L.DomUtil.create('div', 'prio-knobs');
        L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
        const P = prio.getParams();
        d.innerHTML =
          row('δ', 'delta', P.delta, 0, 1, 0.05) + row('λ (d)', 'lam', P.lam, 1, 60, 1) +
          row('N', 'n', P.n, 1, 200, 1) + row('Ct<', 'ctThreshold', P.ctThreshold, 1, 45, 1) +
          row('bin (d)', 'binWidthDays', P.binWidthDays, 1, 30, 1);
        d.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
          const k = inp.dataset.k; const v = parseFloat(inp.value);
          d.querySelector(`[data-v="${k}"]`).textContent = inp.value;
          prio.setParams({ [k]: v });
        }));
        return d;
      };
      function row(label, k, val, min, max, step) {
        return `<div class="pk-row"><span class="pk-l">${label}</span>`
          + `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">`
          + `<span class="pk-v" data-v="${k}">${val}</span></div>`;
      }
      prioKnobsCtl = ctl;
      if (prio.isActive()) ctl.addTo(map);
    },
```
Declare `let prioKnobsCtl = null;` in the scope vars block. In `setPrioritisation(active)`, after rebuilding the group, add:
```js
      if (prioKnobsCtl) { if (prioActive) prioKnobsCtl.addTo(map); else prioKnobsCtl.remove(); }
```

- [ ] **Step 2: Knobs CSS** — append to `src/style.css`:

```css
.prio-knobs { background: rgba(255,255,255,0.94); border: 1px solid var(--border); border-radius: 7px;
  box-shadow: 0 1px 2px rgba(30,25,18,0.1); padding: 5px 8px; font-size: 10px; color: var(--ink); }
.pk-row { display: flex; align-items: center; gap: 6px; line-height: 1.7; }
.pk-l { width: 38px; color: var(--muted); flex: none; }
.pk-row input[type=range] { width: 96px; }
.pk-v { width: 26px; text-align: right; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: Verify** — `npm run build`; `npm run dev`: activate → a knobs panel appears bottom-left of the map; moving δ/λ/N re-shades the "Seq→" choropleth live; deactivate → panel disappears.

- [ ] **Step 4: Commit**

```bash
git add src/map-panel.js src/style.css
git commit -m "Add on-map prioritisation knobs panel (live δ/λ/N/Ct/bin)"
```

---

## Task 7: Chart time-bin allocation overlay

Show the to-sequence count per time-bin on the Sample-distribution chart (a track like the sequence circles), selection-aware.

**Files:**
- Modify: `src/timeseries-panel.js`

- [ ] **Step 1: Add state + API.** Near the other scope vars (`let seqMap = new Map();`) add:
```js
  let allocation = null;   // cellSummary[] | null  (to-sequence per zone×bin)
```
In the returned object add:
```js
    /** Set/clear the to-sequence allocation overlay (cellSummary[] or null). */
    setAllocation(cs) { allocation = cs; render(); },
```

- [ ] **Step 2: Aggregate per-date selected (selection-aware).** Add near `seqByDate()`:
```js
  // To-sequence counts per date for the current selection (sum cellSummary over zones,
  // restricted to the selected zones in zone mode; bin index -> a representative date).
  function allocByDate(binWidthDays, origin) {
    if (!allocation) return new Map();
    const names = mode === 'area' ? sel.areas : sel.zones;
    const set = names.length ? new Set(names.map(upper)) : null;
    const m = new Map();
    for (const c of allocation) {
      if (!c.selected) continue;
      if (set && mode === 'zone' && !set.has(upper(c.location))) continue;   // zone-filtered
      const mid = +new Date(origin) + (c.timeBin + 0.5) * binWidthDays * 86400000;
      const day = new Date(mid).toISOString().slice(0, 10);
      m.set(day, (m.get(day) || 0) + c.selected);
    }
    return m;
  }
```
(The panel doesn't know `origin`/`binWidthDays`; pass them in via `setAllocation`. Update the API:)
```js
    setAllocation(cs, opts) { allocation = cs; allocOpts = opts || null; render(); },
```
and `let allocOpts = null;`, and call `allocByDate(allocOpts?.binWidthDays || 7, allocOpts?.origin || domain.minDate)`.

In `main.js` Task 5 step 5, change the chart call to pass opts:
```js
        ts.setAllocation(active ? cellSummary : null, active ? { binWidthDays: prio.getParams().binWidthDays, origin: meta.rootDate } : null);
```
(Engine `origin` ≈ earliest candidate; using `meta.rootDate` keeps the overlay aligned with the axis — acceptable since both derive from the same dates. If exactness is needed later, thread the engine `origin` through `onChange`.)

- [ ] **Step 3: Draw the overlay in `render()`.** Just below the sequence-track block (`if (seqMap.size) { ... }`), add a second track a few px under it:
```js
    // To-sequence allocation overlay (a second row of circles, teal-green).
    const alloc = allocByDate(allocOpts?.binWidthDays || 7, allocOpts?.origin || domain.minDate);
    if (alloc.size) {
      const ay = trackY + 9;
      for (const [dateStr, k] of alloc) {
        const cx = scale.dateToX(dateStr);
        if (cx < PAD.left - 1 || cx > W - 1) continue;
        const r = Math.min(6, 2 + 1.6 * Math.sqrt(k));
        svg.appendChild(el('circle', { cx, cy: ay, r, fill: '#205c4c', 'fill-opacity': 0.55 }));
      }
    }
```

- [ ] **Step 4: Verify** — `npm run build`; `npm run dev`: with prioritisation active, a teal-green row of circles appears under the sequence track, sized by to-sequence count per bin; selecting a zone re-filters it; deactivating clears it.

- [ ] **Step 5: Commit**

```bash
git add src/timeseries-panel.js src/main.js
git commit -m "Add to-sequence time-bin allocation overlay to the distribution chart"
```

---

## Task 8: Local upload end-to-end + ranked-list download

Tasks 3 & 5 already implement `parseUpload`, the file input, the `sequenced` column, and the ranked-list download button. This task verifies the upload path end-to-end and adds a tiny fixture-based sanity check.

**Files:**
- Test: `src/prioritise-data.test.js` (extend)

- [ ] **Step 1: Add an end-to-end upload test.** Append to `src/prioritise-data.test.js`:
```js
import { prioritise } from './prioritise.js';

it('upload path: parse → buildCells(withIds) → prioritise yields IDs', () => {
  const csv = 'sample_id,health_zone,status,ct,date\n'
    + 'A1,Bunia,Positive,22,2026-04-05\nA2,Bunia,Positive,23,2026-04-05\nB1,Katwa,Positive,24,2026-04-05\n';
  const { rows } = parseUpload(csv);
  const { cells, origin, tNow } = buildCells({
    candidateRows: rows, risk, canon, ctThreshold: 31, binWidthDays: 7, withIds: true,
  });
  const { selection } = prioritise({ cells, n: 2, delta: 0.5, lam: Infinity, binWidthDays: 7, origin, tNow, seed: 1 });
  expect(selection.length).toBe(2);
  expect(selection.every((s) => /^(A1|A2|B1)$/.test(s.sampleId))).toBe(true);
});
```

- [ ] **Step 2: Run** — `npx vitest run src/prioritise-data.test.js && npm test`
Expected: PASS.

- [ ] **Step 3: Manual verification** — `npm run dev`: on the Prioritisation tab, upload a small CSV (`sample_id,health_zone,status,ct,date`); diagnostics show kept/dropped; Activate → map + chart update; "⤓ ranked list CSV" downloads a list with the real IDs. Confirm via DevTools Network tab that **no upload request** is made.

- [ ] **Step 4: Commit**

```bash
git add src/prioritise-data.test.js
git commit -m "Verify local-upload prioritisation path end-to-end"
```

---

## Final verification

- [ ] `npm test` — all suites pass.
- [ ] `npm run build` — "build OK".
- [ ] Manual pass of the spec's UX flow (Task-by-task verifications above), including deactivate → map/chart revert to normal.
- [ ] Confirm the raw upload is never committed and never transmitted.

Then complete the branch with **superpowers:finishing-a-development-branch**.

---

## Notes for the implementer

- The engine RNG (mulberry32) is *not* numpy's; do **not** byte-compare JS output to `prioritise.py`. The tests assert RNG-independent **properties** (proportionality, recency, coverage, caps, determinism) — that's deliberate.
- `risk` keys, candidate zones, and tip zones are all upper-cased canonical `Nom`s via the existing `canon` (alias table). A zone absent from `risk` is dropped (counted) — matching the methodology's "absent ⇒ zero risk".
- Public mode uses `subtractHistory: true` (line-list eligibles overlap the sequenced tips, which we can't match by ID, so we subtract counts); upload mode uses `subtractHistory: false` (the `sequenced` column cleanly separates candidates from history).
- Keep the engine and data-prep pure (no DOM, no globals) so the Vitest suites stay fast and the logic is reusable.
