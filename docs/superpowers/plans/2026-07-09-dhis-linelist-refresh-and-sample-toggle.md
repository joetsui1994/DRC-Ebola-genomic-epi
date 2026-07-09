# DHIS line list refresh + sample-collected toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate `public/data/linelist_data.dhis.csv` from the newest `BDBV2026-Linelist_Processing` export and add a DHIS-only "Sample collected only" header toggle that live-filters the map, prioritisation, and time-series panels.

**Architecture:** A one-time throwaway Python script converts the pipeline's git-safe export into the app's 10-column CSV plus a new `sample_collected` column. In the app, `parseLinelist` reads the new column; a tiny pure helper (`filterSampleCollected`) does the filtering; and three panels each gain a small data-replace setter so a checkbox in `main.js` can push a filtered rows array to all of them with no page reload.

**Tech Stack:** Vanilla JS (ES modules), Vite, Vitest, Leaflet (map). Data conversion via a throwaway Python 3 script (not committed).

**Design spec:** `docs/superpowers/specs/2026-07-09-dhis-linelist-refresh-and-sample-toggle-design.md`

---

## File structure

- `public/data/linelist_data.dhis.csv` — **regenerated** (Task 1). Gains a `sample_collected` column.
- `public/data/aliases.csv` — **modified** (Task 1). Two new zone alias rows.
- `src/linelist-filter.js` — **new** (Task 2). Pure `filterSampleCollected(rows, sampleOnly)` helper.
- `src/linelist-filter.test.js` — **new** (Task 2). Unit tests for the helper.
- `src/main.js` — **modified** (Tasks 3, 7). `parseLinelist` reads `sample_collected`; header toggle wiring.
- `src/map-panel.js` — **modified** (Task 4). New `setLinelist(rows)` + `retally()` refactor.
- `src/timeseries-panel.js` — **modified** (Task 5). New `setRows(next)`.
- `src/prioritise-panel.js` — **modified** (Task 6). New `refresh()`.
- `index.html` — **modified** (Task 7). Checkbox in the header.

---

## Task 1: Regenerate the DHIS CSV + add zone aliases

**Files:**
- Create (scratchpad, NOT committed): `/private/tmp/claude-502/-Users-user-Documents-work-ituri-dashboard/05f12efa-e64c-452d-b5d2-468fc15d1752/scratchpad/convert_dhis.py`
- Modify: `public/data/linelist_data.dhis.csv` (overwrite)
- Modify: `public/data/aliases.csv` (append 2 rows)

- [ ] **Step 1: Write the conversion script**

Write to the scratchpad path above:

```python
import csv
from collections import Counter

SRC = "/Users/user/Documents/work/BDBV2026-Linelist_Processing/data/processed/dhis2_linelist_processed/LINELIST_08072026/dhis2_processed_linelist.csv"
DST = "/Users/user/Documents/work/ituri-dashboard/public/data/linelist_data.dhis.csv"

# Epi case classification -> app status. Empty classification -> Unclassified.
STATUS = {
    'confirmed_case': 'Positive',
    'not_a_case': 'Negative',
    'suspected_case': 'Unclassified',
    'probable_case': 'Unclassified',
    '': 'Unclassified',
}

def g(row, col):
    return (row.get(col) or '').strip()

# parseLinelist in the app splits rows naively on ',', so field values must not
# contain commas. Strip commas and collapse whitespace/newlines to keep the file
# naive-parse-safe (matches the previously hand-built file).
def clean(v):
    return ' '.join(v.replace(',', ' ').split())

OUT_HEADER = ['row_id','sample_id','province','health_zone','health_area',
              'lab_name','status','date','ct','being_sequenced','sample_collected']

rows_out = []
with open(SRC, newline='') as f:
    for i, row in enumerate(csv.DictReader(f), start=1):
        cls = g(row, 'final_mve_case_classification')
        rows_out.append({
            'row_id': i,
            'sample_id': clean(g(row, 'alert_id')) or 'NA',
            'province': clean(g(row, 'province')) or 'NA',
            'health_zone': clean(g(row, 'health_zone')) or 'NA',
            'health_area': clean(g(row, 'health_area')) or 'NA',
            'lab_name': clean(g(row, 'lab_name')) or 'NA',
            'status': STATUS.get(cls, 'Unclassified'),
            'date': g(row, 'date_of_symptom_onset') or 'NA',
            'ct': g(row, 'radi_one_ebola_valeur_ct_fam_ebov') or 'NA',
            'being_sequenced': '',
            'sample_collected': '1' if g(row, 'samples_received') == '1' else '0',
        })

with open(DST, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=OUT_HEADER)
    w.writeheader()
    w.writerows(rows_out)

st = Counter(r['status'] for r in rows_out)
sc = Counter(r['sample_collected'] for r in rows_out)
print(f"wrote {len(rows_out)} rows -> {DST}")
print("status:", dict(st))
print("sample_collected:", dict(sc))
assert len(rows_out) == 10663, len(rows_out)
assert st['Positive'] == 1824 and st['Negative'] == 2188 and st['Unclassified'] == 6651, dict(st)
assert sc['1'] == 4176 and sc['0'] == 6487, dict(sc)
# no field contains a comma (naive-parse safety)
assert not any(',' in v for r in rows_out for v in (r['sample_id'], r['province'], r['health_zone'], r['health_area'], r['lab_name']))
print("OK")
```

- [ ] **Step 2: Run the conversion and verify assertions pass**

Run: `python3 "/private/tmp/claude-502/-Users-user-Documents-work-ituri-dashboard/05f12efa-e64c-452d-b5d2-468fc15d1752/scratchpad/convert_dhis.py"`
Expected output ends with:
```
wrote 10663 rows -> .../public/data/linelist_data.dhis.csv
status: {'Invalid'... } -> {'Positive': 1824, 'Negative': 2188, 'Unclassified': 6651}
sample_collected: {'1': 4176, '0': 6487}
OK
```
(If any assert fails, STOP — the source export changed; re-verify counts before continuing.)

- [ ] **Step 3: Verify the header and a sample row**

Run: `head -2 public/data/linelist_data.dhis.csv`
Expected header: `row_id,sample_id,province,health_zone,health_area,lab_name,status,date,ct,being_sequenced,sample_collected`

- [ ] **Step 4: Append the two zone aliases**

Append these two lines to `public/data/aliases.csv` (keep the existing trailing newline convention; columns are `observed_name,canonical_nom,source_dataset,notes`):

```
Kalamu 2,Kalamu II,dhis,Arabic-numeral variant of canonical Kinshasa sub-zone (geojson uses roman numerals)
Mont Ngafula 1,Mont Ngafula I,dhis,Arabic-numeral variant of canonical Kinshasa sub-zone (geojson uses roman numerals)
```

- [ ] **Step 5: Verify aliases resolve every zone**

Run:
```bash
python3 - <<'PY'
import json, csv
canon = {f['properties']['Nom'].lower() for f in json.load(open('public/data/health-zones.geojson'))['features']}
alias = {}
for r in csv.DictReader(open('public/data/aliases.csv')):
    alias[(r['observed_name'] or '').strip().lower()] = (r['canonical_nom'] or '').strip().lower()
bad = set()
for r in csv.DictReader(open('public/data/linelist_data.dhis.csv')):
    z = (r['health_zone'] or '').strip()
    if z in ('', 'NA'): continue
    cz = alias.get(z.lower(), z.lower())
    if cz not in canon: bad.add(z)
print("unresolved zones:", bad or "NONE")
PY
```
Expected: `unresolved zones: NONE`

- [ ] **Step 6: Commit**

```bash
git add public/data/linelist_data.dhis.csv public/data/aliases.csv
git commit -m "Regenerate DHIS line list from LINELIST_08072026; add sample_collected + zone aliases"
```

---

## Task 2: `filterSampleCollected` helper (TDD)

**Files:**
- Create: `src/linelist-filter.js`
- Test: `src/linelist-filter.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/linelist-filter.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { filterSampleCollected } from './linelist-filter.js';

const rows = [
  { sample_id: 'a', sample_collected: true },
  { sample_id: 'b', sample_collected: false },
  { sample_id: 'c', sample_collected: true },
];

describe('filterSampleCollected', () => {
  it('keeps only collected rows when sampleOnly is true', () => {
    expect(filterSampleCollected(rows, true).map((r) => r.sample_id)).toEqual(['a', 'c']);
  });

  it('returns all rows unchanged when sampleOnly is false', () => {
    expect(filterSampleCollected(rows, false)).toBe(rows);
  });

  it('passes everything through when all rows are collected (column absent → true)', () => {
    const allTrue = [{ sample_collected: true }, { sample_collected: true }];
    expect(filterSampleCollected(allTrue, true)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/linelist-filter.test.js`
Expected: FAIL — cannot resolve `./linelist-filter.js`.

- [ ] **Step 3: Write the helper**

Create `src/linelist-filter.js`:

```js
// src/linelist-filter.js
// Filter for the header "Sample collected only" toggle (DHIS source). When
// `sampleOnly` is true, keep only rows with a collected sample; otherwise return
// the array unchanged. Rows parsed from a file without a `sample_collected`
// column default to true in parseLinelist, so a source lacking the column is
// unaffected by the filter.
export function filterSampleCollected(rows, sampleOnly) {
  return sampleOnly ? rows.filter((r) => r.sample_collected) : rows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/linelist-filter.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/linelist-filter.js src/linelist-filter.test.js
git commit -m "Add filterSampleCollected helper for the sample-collected toggle"
```

---

## Task 3: `parseLinelist` reads `sample_collected`

**Files:**
- Modify: `src/main.js:34-52` (`parseLinelist`)

- [ ] **Step 1: Add the column index**

In `src/main.js`, the index block currently reads (lines 34-36):

```js
  const iId = idx('sample_id'), iZone = idx('health_zone'), iArea = idx('health_area'),
        iStatus = idx('status'), iDate = idx('date'), iCt = idx('ct'), iRid = idx('row_id'),
        iSeqing = idx('being_sequenced');
```

Change the last line to add `iSample`:

```js
  const iId = idx('sample_id'), iZone = idx('health_zone'), iArea = idx('health_area'),
        iStatus = idx('status'), iDate = idx('date'), iCt = idx('ct'), iRid = idx('row_id'),
        iSeqing = idx('being_sequenced'), iSample = idx('sample_collected');
```

- [ ] **Step 2: Emit the parsed boolean**

The pushed object currently ends (lines 49-52):

```js
      // In the process of being sequenced (committed but not yet in the phylogeny). Absent
      // column → false everywhere, so all surfaces degrade to showing nothing.
      being_sequenced: iSeqing >= 0 ? /^(1|true|yes|y)$/i.test((c[iSeqing] || '').trim()) : false,
    });
```

Add a `sample_collected` field after `being_sequenced`:

```js
      // In the process of being sequenced (committed but not yet in the phylogeny). Absent
      // column → false everywhere, so all surfaces degrade to showing nothing.
      being_sequenced: iSeqing >= 0 ? /^(1|true|yes|y)$/i.test((c[iSeqing] || '').trim()) : false,
      // Whether a sample was collected (DHIS). Absent column (e.g. the Lab file) → true so the
      // "Sample collected only" filter is a no-op for sources that don't carry the mark.
      sample_collected: iSample >= 0 ? /^(1|true|yes|y)$/i.test((c[iSample] || '').trim()) : true,
    });
```

- [ ] **Step 3: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.js
git commit -m "parseLinelist: read the sample_collected column (absent → true)"
```

---

## Task 4: `map.setLinelist(rows)` — live re-tally

**Files:**
- Modify: `src/map-panel.js` (near `let linelistRows = [];` at line 158, and the `setDateWindow` method at lines 332-352)

- [ ] **Step 1: Add a `currentWindow` state variable**

Find the line `let linelistRows = [];` (line 158) and add below it:

```js
  let currentWindow = null;   // last date window set by the brush; re-applied on line-list swaps
```

- [ ] **Step 2: Extract a shared `retally()` and rewrite `setDateWindow`, add `setLinelist`**

The current `setDateWindow` method (lines 330-352) is:

```js
    /** Filter the choropleth + markers to a time window (inclusive ms bounds), or null = all.
     *  Re-tallies the line-list rows, reclasses, and shows/resizes markers by in-window count. */
    setDateWindow(d0, d1) {
      const win = (d0 != null && d1 != null) ? { d0: +d0, d1: +d1 } : null;
      const tally = tallyZones(linelistRows, win);
      zoneCounts = tally.zoneCounts; zonePosCt = tally.zonePosCt;
      applyCounts?.();
      for (const { group, marker } of markers) {
        let n = group.tipIds.length;
        if (win) {
          n = 0;
          for (const ds of group.dates) { const tt = +new Date(ds); if (!isNaN(tt) && tt >= win.d0 && tt <= win.d1) n++; }
        }
        // _winHidden is honoured by highlight()/clearHighlight() and the marker click handler
        // (Leaflet ignores a runtime `interactive` change, so the flag gates clicks instead).
        group._winHidden = (n === 0);
        if (n === 0) marker.setStyle(HIDDEN_STYLE);
        else {
          marker.setStyle({ opacity: 1, fillOpacity: BASE_STYLE.fillOpacity });
          marker.setRadius(6 + 3 * Math.sqrt(n));
        }
      }
    },
```

Replace that entire method with the following (a shared `retally()` plus two thin methods):

```js
    /** Filter the choropleth + markers to a time window (inclusive ms bounds), or null = all. */
    setDateWindow(d0, d1) {
      currentWindow = (d0 != null && d1 != null) ? { d0: +d0, d1: +d1 } : null;
      retally();
    },

    /** Replace the line-list rows behind the choropleth (sample-collected toggle) and re-tally
     *  over the current date window. Markers come from `tips`, so they are unaffected. */
    setLinelist(rows) {
      linelistRows = rows || [];
      retally();
    },
```

Then add the shared `retally()` function INSIDE `createMapPanel` but OUTSIDE the returned object literal — place it just before the `return {` of the public API (so it closes over `linelistRows`, `currentWindow`, `zoneCounts`, `zonePosCt`, `applyCounts`, `markers`, `HIDDEN_STYLE`, `BASE_STYLE`):

```js
  // Re-tally the choropleth + markers from the current line-list rows over the current date
  // window. Shared by setDateWindow (window change) and setLinelist (sample-collected toggle).
  function retally() {
    const win = currentWindow;
    const tally = tallyZones(linelistRows, win);
    zoneCounts = tally.zoneCounts; zonePosCt = tally.zonePosCt;
    applyCounts?.();
    for (const { group, marker } of markers) {
      let n = group.tipIds.length;
      if (win) {
        n = 0;
        for (const ds of group.dates) { const tt = +new Date(ds); if (!isNaN(tt) && tt >= win.d0 && tt <= win.d1) n++; }
      }
      // _winHidden is honoured by highlight()/clearHighlight() and the marker click handler
      // (Leaflet ignores a runtime `interactive` change, so the flag gates clicks instead).
      group._winHidden = (n === 0);
      if (n === 0) marker.setStyle(HIDDEN_STYLE);
      else {
        marker.setStyle({ opacity: 1, fillOpacity: BASE_STYLE.fillOpacity });
        marker.setRadius(6 + 3 * Math.sqrt(n));
      }
    }
  }

```

Note: locate the existing `return {` that opens the public API object (the one containing `onZoneClick`, `setCtThreshold`, `setDateWindow`, `addZoneLayer`, …) and insert `retally` immediately above it. If `markers`, `HIDDEN_STYLE`, or `BASE_STYLE` are declared textually AFTER that point, move the `retally` definition below their declarations — hoisted `function` declarations are fine as long as they run only when called.

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds. (If it errors with "X is not defined" inside `retally`, the referenced state is out of scope — move `retally` to where `linelistRows`/`markers`/`applyCounts` are in scope.)

- [ ] **Step 4: Commit**

```bash
git add src/map-panel.js
git commit -m "map-panel: add setLinelist(rows) sharing a retally() with setDateWindow"
```

---

## Task 5: `ts.setRows(next)` — live data replace

**Files:**
- Modify: `src/timeseries-panel.js` (returned API object at lines 766-791; `applyExtent` is defined at line 284)

- [ ] **Step 1: Add the `setRows` method**

In the returned object (starts at line 766), the `setCtThreshold` method ends at line 774. Immediately after it, add:

```js
    /** Replace the underlying line-list rows (sample-collected toggle) and re-render. The `rows`
     *  binding is the factory parameter, so reassigning it swaps the data every aggregation reads. */
    setRows(next) { rows = next || []; applyExtent(); },
```

(The parameter is `rows` in `createTimeseriesPanel(containerId, rows, domain, {...})` at line 92; `filteredRows()` at line 425 reads it, and `applyExtent()` at line 284 recomputes the extent and re-renders.)

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/timeseries-panel.js
git commit -m "timeseries-panel: add setRows(next) to replace line-list data live"
```

---

## Task 6: `prio.refresh()` — recompute on demand

**Files:**
- Modify: `src/prioritise-panel.js` (returned API at lines 382-395; `recompute` is defined at line 255)

- [ ] **Step 1: Add the `refresh` method**

The returned object (line 382) currently starts:

```js
  return {
    /** Update knobs (from the on-map panel) and recompute. */
    setParams(p) { applyParams(p); },
```

Add a `refresh` method right after `setParams`:

```js
  return {
    /** Update knobs (from the on-map panel) and recompute. */
    setParams(p) { applyParams(p); },
    /** Re-run the engine, re-reading window.__PRIO_LINELIST__ (sample-collected toggle). */
    refresh: () => recompute(),
```

(`recompute()` at line 255 re-reads `window.__PRIO_LINELIST__` fresh via `runEngine()`/`eligibleCeiling()`, so pushing a new array into the global then calling `refresh()` picks it up.)

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/prioritise-panel.js
git commit -m "prioritise-panel: expose refresh() to recompute after a line-list filter change"
```

---

## Task 7: Header checkbox + `main.js` wiring

**Files:**
- Modify: `index.html:17-19` (header)
- Modify: `src/main.js` (import at line 10; load/consumer block at lines 104-184)

- [ ] **Step 1: Add the checkbox to the header**

In `index.html`, the header currently ends (lines 17-19):

```html
    <label class="linelist-picker" title="Switch the line-list version (reloads the page)">Line list:
      <select id="linelist-select"></select>
    </label>
  </header>
```

Add the toggle label after the picker label, before `</header>`:

```html
    <label class="linelist-picker" title="Switch the line-list version (reloads the page)">Line list:
      <select id="linelist-select"></select>
    </label>
    <label class="sample-toggle" id="sample-toggle-wrap" title="Show only records with a sample collected (DHIS only)">
      <input type="checkbox" id="sample-collected-toggle" checked> Sample collected only
    </label>
  </header>
```

- [ ] **Step 2: Import the filter helper**

In `src/main.js`, after line 10 (`import { LINELIST_SOURCES, resolveLinelistSource } from './linelist-source.js';`) add:

```js
import { filterSampleCollected } from './linelist-filter.js';
```

- [ ] **Step 3: Compute the initial filtered view and set up toggle state**

The current block (lines 114-117) is:

```js
const canon = makeCanon(aliasText);
const linelist = parseLinelist(linelistText, canon);
// Expose the raw line-list rows (public-mode candidates) to the prioritisation engine.
window.__PRIO_LINELIST__ = linelist;
```

Replace it with:

```js
const canon = makeCanon(aliasText);
const fullLinelist = parseLinelist(linelistText, canon);

// Header "Sample collected only" toggle — DHIS-only, default ON. The full parsed array stays in
// memory; the toggle filters the *view* pushed to every consumer (map, prioritisation, time-series).
const isDhis = linelistSource.key === 'dhis';
const sampleToggle = document.getElementById('sample-collected-toggle');
const sampleToggleWrap = document.getElementById('sample-toggle-wrap');
if (sampleToggleWrap) sampleToggleWrap.style.display = isDhis ? '' : 'none';
const viewRows = () => filterSampleCollected(fullLinelist, isDhis && !!sampleToggle?.checked);

const linelist = viewRows();   // initial view honours the default-ON toggle for DHIS
// Expose the current line-list rows (public-mode candidates) to the prioritisation engine.
window.__PRIO_LINELIST__ = linelist;
```

- [ ] **Step 4: Late-bind the prioritisation panel**

The prioritisation panel is created inside the geojson `.then` (line 145: `const prio = createPrioritisationPanel(...)`). Add a module-scope holder so the toggle handler can reach it.

Immediately before the `fetch(\`${BASE}data/health-zones.geojson\`)` call (line 140), add:

```js
let prioPanel = null;   // late-bound below; used by the sample-collected toggle
```

Then, inside the `.then(zones => {` block, right after `const prio = createPrioritisationPanel(...)` finishes (after its closing `});` at line 160, before `map.attachPrioKnobs?.(prio);` on line 161), add:

```js
    prioPanel = prio;
```

- [ ] **Step 5: Wire the toggle change handler**

The time-series panel `ts` is created at lines 168-176 and `tsPanel = ts;` is set at line 177. Immediately after line 177 (`tsPanel = ts;`), add:

```js
// Live sample-collected toggle: re-filter and push the new view to every consumer — no reload.
sampleToggle?.addEventListener('change', () => {
  const rows = viewRows();
  map.setLinelist(rows);
  ts.setRows(rows);
  window.__PRIO_LINELIST__ = rows;
  prioPanel?.refresh();
});
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add index.html src/main.js
git commit -m "Add DHIS-only sample-collected header toggle with live panel updates"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit test suite**

Run: `npm test`
Expected: all tests pass, including `src/linelist-filter.test.js` (3) and `src/linelist-source.test.js` (5).

- [ ] **Step 2: Start the dev server**

Run: `npm run dev` (note the local URL, e.g. `http://localhost:5173/`).

- [ ] **Step 3: Verify DHIS default state**

Open `http://localhost:5173/?linelist=dhis`. Confirm:
- The "Sample collected only" checkbox is visible in the header and **checked**.
- The map choropleth, prioritisation candidates, and sample-distribution chart render.

- [ ] **Step 4: Verify the toggle updates all panels live**

Uncheck "Sample collected only". Confirm WITHOUT a page reload:
- The choropleth counts increase (more zones/darker) — now ~10,663 rows vs ~4,176.
- The sample-distribution time-series bars change (taller / more Unclassified).
- The prioritisation candidate counts change.
Re-check it and confirm the panels return to the sample-collected view.

- [ ] **Step 5: Verify the toggle is hidden for the Lab source**

Open `http://localhost:5173/?linelist=lab` (or select "Lab"). Confirm the "Sample collected only" checkbox is **not shown**, and the Lab data renders normally.

- [ ] **Step 6: Verify zones render on the map (alias sanity)**

Still on the DHIS source, confirm the choropleth colours health zones across Ituri (Nizi, Komanda, Katwa, etc.) rather than leaving them blank — this confirms the new data's zone names joined the geojson.

- [ ] **Step 7: Stop the dev server.** The feature is complete.

---

## Self-review notes

- **Spec coverage:** Part 1 data conversion → Task 1 (incl. status map, Ct=RadiOne-only, `sample_collected`, aliases). Part 2 toggle → Tasks 2–7 (parse, helper, three setters, UI + wiring). Consistency checks → Task 1 Step 5 + Task 8 Step 6. Testing → Tasks 2 & 8.
- **Naming consistency:** `setLinelist` (map), `setRows` (timeseries), `refresh` (prio), `filterSampleCollected`, `viewRows`, `sample_collected` — used identically across tasks.
- **Not committed:** the scratchpad conversion script (one-time, per spec).
