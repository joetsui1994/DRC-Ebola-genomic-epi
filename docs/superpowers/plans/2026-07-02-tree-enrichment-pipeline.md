# Tree enrichment pipeline (n35 EGC time tree) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deprecated enriched phylogenetic tree with the new n35 EGC time tree, enriched (health_zone / health_area / lat / lon / exported) by a reusable build-time script, and repoint the dashboard at a stable filename.

**Architecture:** A pure-function library (`scripts/tree-lib.mjs`, unit-tested with vitest) does all parsing, correction, canonicalisation, geo resolution, and NEXUS annotation injection. A thin CLI orchestrator (`scripts/build-tree.mjs`, `npm run data:tree`) wires committed inputs in `data-raw/` + `public/data/` to committed outputs in `public/data/`. Raw trees live in a new non-served `data-raw/`. The app reads a stable `public/data/ituri-tree.ptree`, so `src/tree-panel.js` changes once.

**Tech Stack:** Node ESM (`.mjs`), vitest, the repo's existing `data:*` npm-script convention. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-02-tree-enrichment-pipeline-design.md`

---

## File structure

- **Create `data-raw/Ituri_2026-06-26_n35.EGC.ptree`** — raw source tree (copied from the sibling `BDBV2026-Trees` repo). Committed, not served.
- **Create `data-raw/Ituri_2026-05-28_HKY_EGC_rate1.9E-3.HIPSTR.enriched.ptree`** — the old enriched tree, moved out of `public/data/` for archival (no longer served, not a pipeline input).
- **Create `scripts/tree-lib.mjs`** — pure functions: `makeCanon`, `parseZones`, `readTipFields`, `resolveTip`, `enrichTipInner`, `enrichTreeText`, `rootHeightFromText`, `computeMeta`. One responsibility: transform strings/objects, no file IO.
- **Create `scripts/tree-lib.test.js`** — vitest unit tests for the library.
- **Create `scripts/build-tree.mjs`** — CLI orchestrator: read inputs, call the library, write outputs. The only file that does IO.
- **Modify `package.json`** — add `"data:tree": "node scripts/build-tree.mjs"`.
- **Modify `public/data/aliases.csv`** — append two crosswalk rows.
- **Modify `src/tree-panel.js:5`** — repoint `TREE_URL` to `data/ituri-tree.ptree`.
- **Generated (by the script, committed): `public/data/ituri-tree.ptree`, `public/data/ituri-tips.json`, `public/data/ituri-meta.json`.**

### Library interfaces (defined once, referenced by later tasks)

```
makeCanon(aliasText: string) => (name: string) => string
parseZones(geojsonText: string) => Map<Nom, {lat:number, lon:number}>   // lat=cy, lon=cx
readTipFields(inner: string) => {accession, date, location}             // inner = text between [& and ]
resolveTip(fields, {corrections, canon, zones}) => {
  accession, date, location, health_zone, health_area, lat, lon, exported
}                                                                        // throws if zone missing
enrichTipInner(inner: string, rec) => string                            // rewrite location + append keys
enrichTreeText(text: string, resolve: (fields)=>rec) => {text, records} // resolve per accession-bearing block
rootHeightFromText(text: string) => number                             // max height_mean across all nodes
computeMeta(records, rootHeightYears, {sourceTree, updated}) => {
  mostRecentDate, rootDate, sourceTree, updated, tipCount
}
```

`CORRECTIONS` (a constant in `tree-lib.mjs`): `{ PP_00711T3: 'Rwampara' }`.

---

## Task 1: Stage inputs and register the npm script

**Files:**
- Create: `data-raw/Ituri_2026-06-26_n35.EGC.ptree`, `data-raw/Ituri_2026-05-28_HKY_EGC_rate1.9E-3.HIPSTR.enriched.ptree`
- Modify: `package.json`

- [ ] **Step 1: Create `data-raw/` and stage the raw trees**

```bash
cd /Users/user/Documents/work/ituri-dashboard
mkdir -p data-raw
cp /Users/user/Documents/work/BDBV2026-Trees/Ituri_2026-06-26_n35.EGC.ptree data-raw/
git mv public/data/Ituri_2026-05-28_HKY_EGC_rate1.9E-3.HIPSTR.enriched.ptree data-raw/
```

- [ ] **Step 2: Verify staging**

Run: `ls data-raw/ && head -c 40 data-raw/Ituri_2026-06-26_n35.EGC.ptree`
Expected: both `.ptree` files listed; head prints `#NEXUS\nBEGIN TREES;`.

- [ ] **Step 3: Add the `data:tree` npm script**

In `package.json`, add to `"scripts"` after the `"data:risk"` line:

```json
    "data:risk": "node scripts/update-relative-risk.mjs",
    "data:tree": "node scripts/build-tree.mjs"
```

(Add a comma after the `data:risk` value.)

- [ ] **Step 4: Commit**

```bash
git add data-raw package.json
git commit -m "Stage n35 EGC raw tree in data-raw/ and add data:tree script"
```

---

## Task 2: Annotation reading + NEXUS injection (`readTipFields`, `enrichTipInner`)

**Files:**
- Create: `scripts/tree-lib.mjs`
- Test: `scripts/tree-lib.test.js`

The tree is one long line; each node carries a `[&key=val,...]` block. **Tip** blocks are exactly those containing `accession=` (internal nodes carry only `posterior`/`height_*`). We read fields with targeted regex and enrich by rewriting `location` in place and appending the new keys — leaving every other byte untouched.

- [ ] **Step 1: Write the failing test**

Create `scripts/tree-lib.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readTipFields, enrichTipInner } from './tree-lib.mjs';

const TIP = 'height_mean=0.05,height_median=0.05,date="2026-05-03",location="Lumumba",accession="PP_00711T3"';

describe('readTipFields', () => {
  it('extracts accession, date, location', () => {
    expect(readTipFields(TIP)).toEqual({
      accession: 'PP_00711T3', date: '2026-05-03', location: 'Lumumba',
    });
  });
});

describe('enrichTipInner', () => {
  it('rewrites location and appends the new keys, leaving other keys intact', () => {
    const rec = {
      location: 'Rwampara', health_zone: 'Rwampara', health_area: 'null',
      lat: 1.60555, lon: 30.03822, exported: false,
    };
    const out = enrichTipInner(TIP, rec);
    expect(out).toBe(
      'height_mean=0.05,height_median=0.05,date="2026-05-03",location="Rwampara",accession="PP_00711T3"' +
      ',health_zone="Rwampara",health_area="null",lat=1.60555,lon=30.03822,exported=false'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: FAIL — `Failed to load .../tree-lib.mjs` / functions not exported.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/tree-lib.mjs`:

```js
// Pure functions for enriching the n35 EGC NEXUS tree. No file IO — all inputs are
// strings/objects so every unit is testable. See the design spec:
// docs/superpowers/specs/2026-07-02-tree-enrichment-pipeline-design.md

// Accessions mislabelled in the raw EGC tree, corrected before any processing.
export const CORRECTIONS = { PP_00711T3: 'Rwampara' };

// Read the three fields we need from a tip annotation block (text between [& and ]).
export function readTipFields(inner) {
  const g = (re) => (inner.match(re) || [, ''])[1];
  return {
    accession: g(/accession="([^"]*)"/),
    date: g(/date="([^"]*)"/),
    location: g(/location="([^"]*)"/),
  };
}

// Rewrite location to the resolved value and append the enrichment keys. Everything
// else in the block is left byte-for-byte intact (numbers are never reformatted).
export function enrichTipInner(inner, rec) {
  const rewritten = inner.replace(/location="[^"]*"/, `location="${rec.location}"`);
  return rewritten +
    `,health_zone="${rec.health_zone}"` +
    `,health_area="${rec.health_area}"` +
    `,lat=${rec.lat},lon=${rec.lon}` +
    `,exported=${rec.exported}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/tree-lib.mjs scripts/tree-lib.test.js
git commit -m "Add tree-lib: tip-field reader + NEXUS annotation injection"
```

---

## Task 3: Canonicaliser and zone-coordinate parser (`makeCanon`, `parseZones`)

**Files:**
- Modify: `scripts/tree-lib.mjs`
- Test: `scripts/tree-lib.test.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/tree-lib.test.js`:

```js
import { makeCanon, parseZones } from './tree-lib.mjs';

describe('makeCanon', () => {
  const canon = makeCanon(
    'observed_name,canonical_nom,source_dataset,notes\n' +
    'Mongwalu,Mongbwalu,egc_tree,typo\n' +
    'Nyankunnde,Nyakunde,egc_tree,typo\n'
  );
  it('maps observed names to canonical, case-insensitively', () => {
    expect(canon('Mongwalu')).toBe('Mongbwalu');
    expect(canon('NYANKUNNDE')).toBe('Nyakunde');
  });
  it('passes unknown names through unchanged', () => {
    expect(canon('Bunia')).toBe('Bunia');
  });
});

describe('parseZones', () => {
  it('maps Nom -> {lat:cy, lon:cx}', () => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [
      { properties: { Nom: 'Bunia', cx: 30.22568, cy: 1.58722 } },
    ]});
    const z = parseZones(gj);
    expect(z.get('Bunia')).toEqual({ lat: 1.58722, lon: 30.22568 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: FAIL — `makeCanon`/`parseZones` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/tree-lib.mjs`:

```js
// Alias crosswalk (observed -> canonical Nom), identical semantics to main.js's
// makeCanon and update-relative-risk.mjs so build-time and runtime agree.
// Columns: 0 observed_name, 1 canonical_nom.
export function makeCanon(aliasText) {
  const map = new Map();
  for (const line of aliasText.trim().split(/\r?\n/).slice(1)) {
    const [observed, canonical] = line.split(',');
    if (observed && canonical) map.set(observed.toUpperCase().trim(), canonical.trim());
  }
  return (name) => map.get((name || '').toUpperCase().trim()) || name;
}

// health-zones.geojson carries pole-of-inaccessibility coords per feature:
// cx = longitude, cy = latitude. Build Nom -> {lat, lon}.
export function parseZones(geojsonText) {
  const gj = JSON.parse(geojsonText);
  const map = new Map();
  for (const f of gj.features) {
    const p = f.properties || {};
    if (p.Nom != null && p.cx != null && p.cy != null) {
      map.set(p.Nom, { lat: p.cy, lon: p.cx });
    }
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add scripts/tree-lib.mjs scripts/tree-lib.test.js
git commit -m "Add tree-lib: alias canonicaliser + geojson zone-coordinate parser"
```

---

## Task 4: Per-tip resolution (`resolveTip`)

**Files:**
- Modify: `scripts/tree-lib.mjs`
- Test: `scripts/tree-lib.test.js`

Applies, in order: correction map → `ex-` strip (sets `exported`) → canonicalise to `health_zone` → geojson lookup for `lat`/`lon`. `health_area` is always `'null'`. Throws if the zone is absent from the geojson.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tree-lib.test.js`:

```js
import { resolveTip } from './tree-lib.mjs';

const CTX = {
  corrections: { PP_00711T3: 'Rwampara' },
  canon: (n) => ({ Mongwalu: 'Mongbwalu' }[n] || n),
  zones: new Map([
    ['Rwampara', { lat: 1.60555, lon: 30.03822 }],
    ['Bunia', { lat: 1.58722, lon: 30.22568 }],
    ['Mongbwalu', { lat: 2.0, lon: 30.0 }],
  ]),
};

describe('resolveTip', () => {
  it('applies the correction map (Lumumba -> Rwampara)', () => {
    const r = resolveTip({ accession: 'PP_00711T3', date: '2026-05-03', location: 'Lumumba' }, CTX);
    expect(r).toMatchObject({ location: 'Rwampara', health_zone: 'Rwampara', exported: false, lat: 1.60555, lon: 30.03822 });
  });
  it('strips ex- and flags export, keeping the base zone', () => {
    const r = resolveTip({ accession: 'PP_006XCJJ', date: '2026-05-14', location: 'ex-Bunia' }, CTX);
    expect(r).toMatchObject({ location: 'Bunia', health_zone: 'Bunia', exported: true, lat: 1.58722, lon: 30.22568 });
  });
  it('canonicalises the health_zone (Mongwalu -> Mongbwalu), leaving location observed', () => {
    const r = resolveTip({ accession: 'X', date: '2026-05-01', location: 'Mongwalu' }, CTX);
    expect(r).toMatchObject({ location: 'Mongwalu', health_zone: 'Mongbwalu', exported: false });
    expect(r.health_area).toBe('null');
  });
  it('throws when the zone is absent from the geojson', () => {
    expect(() => resolveTip({ accession: 'Y', date: '2026-05-01', location: 'Nowhere' }, CTX))
      .toThrow(/Nowhere/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: FAIL — `resolveTip` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/tree-lib.mjs`:

```js
// Resolve one tip's enriched fields. Order matters: correction -> ex- strip ->
// canonicalise -> geo lookup. Throws (never emits null coords) if the zone is unknown.
export function resolveTip(fields, { corrections, canon, zones }) {
  const corrected = corrections[fields.accession] ?? fields.location;
  const exported = corrected.startsWith('ex-');
  const location = exported ? corrected.slice(3) : corrected;
  const health_zone = canon(location);
  const coord = zones.get(health_zone);
  if (!coord) {
    throw new Error(`No geojson zone for "${health_zone}" (tip ${fields.accession}, location "${location}")`);
  }
  return {
    accession: fields.accession,
    date: fields.date,
    location,
    health_zone,
    health_area: 'null',
    lat: coord.lat,
    lon: coord.lon,
    exported,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/tree-lib.mjs scripts/tree-lib.test.js
git commit -m "Add tree-lib: per-tip resolution (correction, ex-, canon, geo)"
```

---

## Task 5: Whole-tree enrichment + meta (`enrichTreeText`, `rootHeightFromText`, `computeMeta`)

**Files:**
- Modify: `scripts/tree-lib.mjs`
- Test: `scripts/tree-lib.test.js`

`enrichTreeText` replaces every `accession`-bearing block and collects the resolved records (for `ituri-tips.json`). `rootHeightFromText` is the max `height_mean` (BEAST node height = years before the most-recent tip, so the root is the maximum). `computeMeta` turns records + root height into the meta file; `rootDate = mostRecentDate − rootHeight·365.25 days`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/tree-lib.test.js`:

```js
import { enrichTreeText, rootHeightFromText, computeMeta } from './tree-lib.mjs';

const TREE =
  '#NEXUS\nBEGIN TREES;\n\ttree TREE1 = [&R] (' +
  'A[&height_mean=0.02,date="2026-05-10",location="ex-Bunia",accession="A"]:0.01,' +
  'B[&height_mean=0.03,date="2026-05-20",location="Mongwalu",accession="B"]:0.02' +
  ')[&posterior=0.99,height_mean=0.10,height_95%_HPD={0.04,0.12}]:0.0;\nEND;\n';

const resolve = (f) => ({
  accession: f.accession, date: f.date,
  location: f.location.replace(/^ex-/, ''),
  health_zone: f.location.replace(/^ex-/, '') === 'Mongwalu' ? 'Mongbwalu' : f.location.replace(/^ex-/, ''),
  health_area: 'null', lat: 1, lon: 2, exported: f.location.startsWith('ex-'),
});

describe('enrichTreeText', () => {
  it('enriches only tip blocks and returns one record per tip', () => {
    const { text, records } = enrichTreeText(TREE, resolve);
    expect(records.map((r) => r.accession)).toEqual(['A', 'B']);
    expect(text).toContain('exported=true');   // tip A
    expect(text).toContain('health_zone="Mongbwalu"'); // tip B
    expect(text).toContain('[&posterior=0.99,height_mean=0.10,height_95%_HPD={0.04,0.12}]'); // internal node untouched
    expect(text).not.toContain('exported=false,exported'); // internal node got no keys
  });
});

describe('rootHeightFromText', () => {
  it('returns the maximum height_mean across all nodes', () => {
    expect(rootHeightFromText(TREE)).toBeCloseTo(0.10, 10);
  });
});

describe('computeMeta', () => {
  it('computes most-recent + root dates and provenance', () => {
    const records = [{ date: '2026-05-10' }, { date: '2026-05-26' }];
    const meta = computeMeta(records, 0.10810721572739972, { sourceTree: 'src.ptree', updated: '2026-07-02' });
    expect(meta).toEqual({
      mostRecentDate: '2026-05-26',
      rootDate: '2026-04-16',
      sourceTree: 'src.ptree',
      updated: '2026-07-02',
      tipCount: 2,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/tree-lib.mjs`:

```js
// Replace every tip block (identified by containing accession=) with its enriched
// form; internal-node blocks and the topology pass through unchanged. Returns the
// new text and the resolved records (for ituri-tips.json), in tree order.
export function enrichTreeText(text, resolve) {
  const records = [];
  const newText = text.replace(/\[&([^\]]*)\]/g, (whole, inner) => {
    if (!/accession="/.test(inner)) return whole;   // internal node — leave intact
    const rec = resolve(readTipFields(inner));
    records.push(rec);
    return `[&${enrichTipInner(inner, rec)}]`;
  });
  return { text: newText, records };
}

// BEAST node height = years before the most-recent tip, so the root is the max.
export function rootHeightFromText(text) {
  const hs = [...text.matchAll(/height_mean=([0-9.eE+-]+)/g)].map((m) => Number(m[1]));
  if (!hs.length) throw new Error('no height_mean annotations found');
  return Math.max(...hs);
}

const DAY_MS = 86400000;
const YEAR_DAYS = 365.25;

export function computeMeta(records, rootHeightYears, { sourceTree, updated }) {
  const dates = records.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) throw new Error('no tip dates');
  if (!(rootHeightYears > 0)) throw new Error(`bad root height: ${rootHeightYears}`);
  const mostRecentDate = dates[dates.length - 1];
  const rootMs = Date.parse(mostRecentDate) - rootHeightYears * YEAR_DAYS * DAY_MS;
  const rootDate = new Date(rootMs).toISOString().slice(0, 10);
  return { mostRecentDate, rootDate, sourceTree, updated, tipCount: records.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/tree-lib.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/tree-lib.mjs scripts/tree-lib.test.js
git commit -m "Add tree-lib: whole-tree enrichment, root height, and meta computation"
```

---

## Task 6: Orchestrator + generate outputs

**Files:**
- Create: `scripts/build-tree.mjs`
- Modify: `public/data/aliases.csv`
- Generated: `public/data/ituri-tree.ptree`, `public/data/ituri-tips.json`, `public/data/ituri-meta.json`

- [ ] **Step 1: Append the two alias rows**

Append to `public/data/aliases.csv` (keep the existing trailing newline convention — one row per line):

```
Mongwalu,Mongbwalu,egc_tree,Spelling variant of Mongbwalu in the n35 EGC tree
Nyankunnde,Nyakunde,egc_tree,Double-n typo of Nyakunde in the n35 EGC tree
```

Run: `tail -3 public/data/aliases.csv`
Expected: the two new rows are the last lines.

- [ ] **Step 2: Write the orchestrator**

Create `scripts/build-tree.mjs`:

```js
// Enrich the n35 EGC time tree for the dashboard and regenerate its companion
// files. Reads raw tree from data-raw/ + geojson/aliases from public/data/, writes
// the app-ready tree + tips + meta into public/data/. See the design spec.
//
// Usage:
//   node scripts/build-tree.mjs                 # stamp `updated` = today
//   node scripts/build-tree.mjs --date=2026-07-02
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CORRECTIONS, makeCanon, parseZones, resolveTip,
  enrichTreeText, rootHeightFromText, computeMeta,
} from './tree-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_TREE = 'Ituri_2026-06-26_n35.EGC.ptree';
const RAW = join(ROOT, 'data-raw', SOURCE_TREE);
const GEOJSON = join(ROOT, 'public/data/health-zones.geojson');
const ALIASES = join(ROOT, 'public/data/aliases.csv');
const OUT_TREE = join(ROOT, 'public/data/ituri-tree.ptree');
const OUT_TIPS = join(ROOT, 'public/data/ituri-tips.json');
const OUT_META = join(ROOT, 'public/data/ituri-meta.json');

const dateArg = process.argv.find((a) => a.startsWith('--date='));
const updated = dateArg ? dateArg.slice(7) : new Date().toISOString().slice(0, 10);

const canon = makeCanon(readFileSync(ALIASES, 'utf8'));
const zones = parseZones(readFileSync(GEOJSON, 'utf8'));
const rawText = readFileSync(RAW, 'utf8');

const resolve = (fields) => resolveTip(fields, { corrections: CORRECTIONS, canon, zones });
const { text, records } = enrichTreeText(rawText, resolve);
const meta = computeMeta(records, rootHeightFromText(rawText), { sourceTree: SOURCE_TREE, updated });

const tips = records.map((r) => ({
  id: r.accession, date: r.date, location: r.location,
  health_zone: r.health_zone, health_area: r.health_area === 'null' ? null : r.health_area,
  lat: r.lat, lon: r.lon, exported: r.exported,
}));

writeFileSync(OUT_TREE, text);
writeFileSync(OUT_TIPS, JSON.stringify(tips, null, 2) + '\n');
writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');

console.log(`Tips enriched: ${records.length}`);
console.log(`Exported tips: ${records.filter((r) => r.exported).length}`);
console.log(`Zones used: ${[...new Set(records.map((r) => r.health_zone))].sort().join(', ')}`);
console.log(`Meta: mostRecent=${meta.mostRecentDate} root=${meta.rootDate} updated=${meta.updated}`);
console.log(`\n✓ Wrote ${OUT_TREE}\n✓ Wrote ${OUT_TIPS}\n✓ Wrote ${OUT_META}`);
```

- [ ] **Step 3: Run the pipeline**

Run: `node scripts/build-tree.mjs --date=2026-07-02`
Expected output includes:
```
Tips enriched: 35
Exported tips: 2
Zones used: Aru, Aungba, Bunia, Katwa, Mongbwalu, Nyakunde, Rwampara
Meta: mostRecent=2026-05-26 root=2026-04-16 updated=2026-07-02
```

- [ ] **Step 4: Spot-check the generated files**

Run:
```bash
node -e "const t=require('./public/data/ituri-tips.json'); console.log(t.length, t.find(x=>x.id==='PP_00711T3'), t.filter(x=>x.exported).map(x=>x.id))"
cat public/data/ituri-meta.json
grep -o 'exported=' public/data/ituri-tree.ptree | wc -l
```
Expected: `35`, the `PP_00711T3` entry shows `location:'Rwampara', health_zone:'Rwampara', lat:1.60555, lon:30.03822, exported:false`; exported ids `['PP_006XCJJ','PP_006XXY5']`; meta has all five fields with `rootDate` `2026-04-16`; the `exported=` count prints `35`. (Use `grep -o … | wc -l`, not `grep -c` — the whole NEXUS tree is one line, so `grep -c` would report `1`.)

- [ ] **Step 5: Commit**

```bash
git add scripts/build-tree.mjs public/data/aliases.csv public/data/ituri-tree.ptree public/data/ituri-tips.json public/data/ituri-meta.json
git commit -m "Generate enriched ituri-tree.ptree + tips/meta from the n35 EGC tree"
```

---

## Task 7: Repoint the app + verify in-browser

**Files:**
- Modify: `src/tree-panel.js:5`

- [ ] **Step 1: Repoint `TREE_URL` to the stable filename**

In `src/tree-panel.js`, change line 5 from:

```js
const TREE_URL = `${import.meta.env.BASE_URL}data/Ituri_2026-05-28_HKY_EGC_rate1.9E-3.HIPSTR.enriched.ptree`;
```
to:
```js
const TREE_URL = `${import.meta.env.BASE_URL}data/ituri-tree.ptree`;
```

- [ ] **Step 2: Confirm no other references to the old filename remain**

Run: `grep -rn "HIPSTR.enriched.ptree" src public/data --include="*.js" --include="*.json"`
Expected: no matches (the archived copy in `data-raw/` is fine).

- [ ] **Step 3: Run the dev server and verify the tree renders**

Run: `npm run dev` then open the app. Confirm:
- the tree renders with a **calendar time axis** and node uncertainty bars,
- tips are **coloured by health zone** with health-zone tip labels,
- clicking a tip selects it and drives the map/timeseries,
- map markers sit at the enriched coordinates (e.g. Bunia, Rwampara, Katwa).

Expected: all four hold; no console errors about missing annotations.

- [ ] **Step 4: Commit**

```bash
git add src/tree-panel.js
git commit -m "Point the tree panel at the stable ituri-tree.ptree"
```

---

## Task 8: Integration test over the generated artifacts

**Files:**
- Create: `scripts/build-tree.integration.test.js`

Locks in the end-to-end result so a future tree refresh that breaks an invariant fails loudly.

- [ ] **Step 1: Write the failing test**

Create `scripts/build-tree.integration.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tips = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-tips.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-meta.json'), 'utf8'));
const tree = readFileSync(join(ROOT, 'public/data/ituri-tree.ptree'), 'utf8');

describe('enriched tree artifacts', () => {
  it('has 35 fully-geocoded tips', () => {
    expect(tips).toHaveLength(35);
    for (const t of tips) {
      expect(t.health_zone).toBeTruthy();
      expect(typeof t.lat).toBe('number');
      expect(typeof t.lon).toBe('number');
      expect(typeof t.exported).toBe('boolean');
    }
  });
  it('has exactly 2 exports and no leftover Lumumba', () => {
    expect(tips.filter((t) => t.exported).map((t) => t.id).sort()).toEqual(['PP_006XCJJ', 'PP_006XXY5']);
    expect(tips.some((t) => t.location === 'Lumumba')).toBe(false);
  });
  it('corrects PP_00711T3 to Rwampara', () => {
    const t = tips.find((x) => x.id === 'PP_00711T3');
    expect(t).toMatchObject({ location: 'Rwampara', health_zone: 'Rwampara', lat: 1.60555, lon: 30.03822 });
  });
  it('meta carries dates + provenance with root before most-recent', () => {
    expect(meta).toMatchObject({ mostRecentDate: '2026-05-26', rootDate: '2026-04-16', tipCount: 35 });
    expect(meta.sourceTree).toBe('Ituri_2026-06-26_n35.EGC.ptree');
    expect(meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.rootDate < meta.mostRecentDate).toBe(true);
  });
  it('injected exactly 35 exported= annotations into the tree', () => {
    expect((tree.match(/exported=/g) || []).length).toBe(35);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run scripts/build-tree.integration.test.js`
Expected: PASS (5 tests). (The artifacts already exist from Task 6.)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all suites pass (existing app tests + `tree-lib` + integration).

- [ ] **Step 4: Commit**

```bash
git add scripts/build-tree.integration.test.js
git commit -m "Add integration test over the generated tree artifacts"
```

---

## Self-review notes

- **Spec coverage:** source tree (Task 1), `data-raw/` + stable filename (Tasks 1, 7), 2 alias rows (Task 6), correction map (Tasks 2–4), ex-/exported on all tips (Tasks 4–5), uniform geojson lat/lon (Tasks 3–4), three outputs + provenance (Tasks 5–6), `TREE_URL` repoint (Task 7), error-on-missing-zone (Task 4), idempotence via `--date` (Task 6). All covered.
- **Type consistency:** `resolveTip` returns `{accession,date,location,health_zone,health_area,lat,lon,exported}`; `enrichTipInner` and the tips.json mapping consume exactly those keys; `health_area` is the string `'null'` in the tree and JSON `null` in tips.json (converted in Task 6, step 2).
- **No placeholders:** every code and command step is concrete with expected output.
