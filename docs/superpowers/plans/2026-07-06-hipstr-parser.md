# HIPSTR parser front-end (n139) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the clock-consistent HIPSTR n139 tree (TreeAnnotator/FigTree NEXUS: taxa + Translate + numbered tips) and emit the same app-ready `ituri-tree.ptree` / `ituri-tips.json` / `ituri-meta.json` the pipeline already produces, reusing the enrichment core unchanged.

**Architecture:** A new pure-function front-end `scripts/hipstr-parse.mjs` parses the Translate block + pipe-delimited taxon labels, completes truncated `YYYY-MM` dates from the tree's own clock, and rewrites the numbered tree into the inline-annotated single-line `.ptree` shape. The orchestrator `scripts/build-tree.mjs` swaps its front-end and source file; `scripts/tree-lib.mjs` (resolveTip/parseZones/computeMeta/rootHeightFromText) and the app are untouched.

**Tech Stack:** Node ESM (`.mjs`), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-06-hipstr-parser-spec-change.md` (amends `2026-07-02-tree-enrichment-pipeline-design.md`).

**Grounded expected values** (computed from the real n139 tree): 139 tips; `mostRecentDate` = `2026-06-23`; root height ≈ `0.31729` yr → `rootDate` = `2026-02-27`; 0 exports; 11 truncated dates completed (e.g. `PP_0075Z74` → `2026-05-13`, `PP_0075YXQ` → `2026-05-20`); 16 health zones, all in the geojson; clock reference (height-0) = `2026-06-23`.

---

## File structure

- **Create `data-raw/Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree`** — raw source (copied from `~/Downloads`).
- **Create `scripts/hipstr-parse.mjs`** — pure front-end: `parseTranslate`, `parseLabel`, `clockRefMs`, `completeDate`, `hipstrToInline`. No IO.
- **Create `scripts/hipstr-parse.test.js`** — unit tests.
- **Modify `scripts/build-tree.mjs`** — point at the n139 source; use `hipstrToInline` instead of `enrichTreeText`.
- **Modify `public/data/aliases.csv`** — two new rows.
- **Modify `scripts/build-tree.integration.test.js`** — update invariants for n139.
- **Regenerated (committed): `public/data/ituri-tree.ptree`, `ituri-tips.json`, `ituri-meta.json`.**
- **Reused unchanged:** `scripts/tree-lib.mjs` (`CORRECTIONS`, `resolveTip`, `parseZones`, `makeCanon`, `computeMeta`, `rootHeightFromText`). Note `CORRECTIONS.PP_00711T3 = 'Rwampara'` is now a no-op (n139 already has that tip as Rwampara) — harmless, left in place.

### Front-end interfaces (defined once, referenced below)

```
parseTranslate(text) => Map<numStr, label>            // strips surrounding single quotes
parseLabel(label)    => { fieldId, accession, location, date }   // .N suffix stripped; date verbatim
clockRefMs(fullTips) => number                        // mean of (Date.parse(date)+height*MS_PER_YEAR) over full-date tips
completeDate(rawDate, height, refMs) => "YYYY-MM-DD"  // passthrough if already full; else round(ref - height)
hipstrToInline(text, { resolve }) => { text, records }
```

`MS_PER_YEAR = 365.25 * 86400000` (matches `computeMeta`'s year length).

---

## Task 1: Stage the n139 tree and add alias rows

**Files:**
- Create: `data-raw/Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree`
- Modify: `public/data/aliases.csv`

- [ ] **Step 1: Copy the raw tree in**

```bash
cd /Users/user/Documents/work/ituri-dashboard
cp ~/Downloads/Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree data-raw/
```

- [ ] **Step 2: Verify it staged**

Run: `head -c 30 data-raw/Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree && grep -c 'Begin trees' data-raw/Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree`
Expected: prints `#NEXUS` … and `1`.

- [ ] **Step 3: Append the two alias rows**

Append to `public/data/aliases.csv` (one per line, preserve trailing newline):

```
Mungwalu,Mongbwalu,egc_tree,Spelling variant of Mongbwalu in the n139 tree
Sota,Nyakunde,egc_tree,Locality in the Nyakunde health zone (per data owner)
```

Run: `tail -2 public/data/aliases.csv`
Expected: the two new rows.

- [ ] **Step 4: Commit**

```bash
git add data-raw/Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree public/data/aliases.csv
git commit -m "Stage n139 HIPSTR tree + Mungwalu/Sota alias rows"
```

---

## Task 2: `parseTranslate` + `parseLabel`

**Files:**
- Create: `scripts/hipstr-parse.mjs`
- Test: `scripts/hipstr-parse.test.js`

- [ ] **Step 1: Write the failing test** — create `scripts/hipstr-parse.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseTranslate, parseLabel } from './hipstr-parse.mjs';

const TRANS = `Begin trees;
	Translate
		1 '26FHV0069|PP_0075YWS.1|DRC|Ituri|Rwampara|2026-05',
		2 '26FHV0074|PP_0075YYN.1|DRC|Ituri|Mongwalu|2026-05-15'
;
tree TREE1 = [&R] (1,2);`;

describe('parseTranslate', () => {
  it('maps numbers to unquoted labels', () => {
    const m = parseTranslate(TRANS);
    expect(m.get('1')).toBe('26FHV0069|PP_0075YWS.1|DRC|Ituri|Rwampara|2026-05');
    expect(m.get('2')).toBe('26FHV0074|PP_0075YYN.1|DRC|Ituri|Mongwalu|2026-05-15');
    expect(m.size).toBe(2);
  });
});

describe('parseLabel', () => {
  it('parses a 6-field label, strips the .N accession suffix, keeps date verbatim', () => {
    expect(parseLabel('26FHV0069|PP_0075YWS.1|DRC|Ituri|Rwampara|2026-05')).toEqual({
      fieldId: '26FHV0069', accession: 'PP_0075YWS', location: 'Rwampara', date: '2026-05',
    });
  });
  it('parses a 5-field label (no province) by locating date as the last field', () => {
    expect(parseLabel('26FHV0069|PP_0075YWS|DRC|Rwampara|2026-05-20')).toEqual({
      fieldId: '26FHV0069', accession: 'PP_0075YWS', location: 'Rwampara', date: '2026-05-20',
    });
  });
  it('throws on a label whose last field is not a YYYY-MM(-DD) date', () => {
    expect(() => parseLabel('a|PP_x|DRC|Bunia|notadate')).toThrow(/date/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/hipstr-parse.test.js`
Expected: FAIL — module/functions missing.

- [ ] **Step 3: Write minimal implementation** — create `scripts/hipstr-parse.mjs`:

```js
// Parse the HIPSTR/TreeAnnotator FigTree NEXUS format (taxa + Translate + numbered
// tips) into the inline-annotated single-line .ptree the app consumes. Pure — no IO.
// See docs/superpowers/specs/2026-07-06-hipstr-parser-spec-change.md

export const MS_PER_YEAR = 365.25 * 86400000;
const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

// Translate block: `<number> '<label>',` (or unquoted), terminated by a lone `;`.
export function parseTranslate(text) {
  const start = text.search(/[Tt]ranslate/);
  if (start < 0) throw new Error('no Translate block');
  const block = text.slice(start, text.indexOf(';', start));
  const map = new Map();
  for (const m of block.matchAll(/(\d+)\s+'?([^',\n]+?)'?\s*,?\s*$/gm)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

// Pipe-delimited label. The date is the LAST field (YYYY-MM or YYYY-MM-DD); the
// location is the field immediately before it; accession is field 1 with any
// `.N` version suffix stripped. Robust to 5- or 6-field labels.
export function parseLabel(label) {
  const p = label.split('|');
  const date = p[p.length - 1].trim();
  if (!DATE_RE.test(date)) throw new Error(`label date not YYYY-MM(-DD): "${label}"`);
  const location = p[p.length - 2].trim();
  const accession = (p[1] || '').trim().replace(/\.\d+$/, '');
  const fieldId = (p[0] || '').trim();
  if (!accession || !location) throw new Error(`incomplete label: "${label}"`);
  return { fieldId, accession, location, date };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/hipstr-parse.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/hipstr-parse.mjs scripts/hipstr-parse.test.js
git commit -m "Add hipstr-parse: Translate + pipe-label parsing"
```

---

## Task 3: `clockRefMs` + `completeDate`

**Files:**
- Modify: `scripts/hipstr-parse.mjs`
- Test: `scripts/hipstr-parse.test.js`

- [ ] **Step 1: Append the failing test** to `scripts/hipstr-parse.test.js`:

```js
import { clockRefMs, completeDate } from './hipstr-parse.mjs';

describe('clockRefMs', () => {
  it('averages (date + height*year) over full-date tips', () => {
    // two tips on a perfect clock with height-0 date 2026-06-23
    const y = (d) => Date.parse(d);
    const ref = clockRefMs([
      { date: '2026-05-24', height: 30 / 365.25 },   // 30d before -> 2026-06-23
      { date: '2026-06-13', height: 10 / 365.25 },   // 10d before -> 2026-06-23
    ]);
    expect(new Date(ref).toISOString().slice(0, 10)).toBe('2026-06-23');
    expect(ref).toBeCloseTo(y('2026-06-23'), -6);
  });
});

describe('completeDate', () => {
  const ref = Date.parse('2026-06-23');
  it('passes a full YYYY-MM-DD date through unchanged', () => {
    expect(completeDate('2026-05-15', 0.1, ref)).toBe('2026-05-15');
  });
  it('completes a YYYY-MM date from the tree height (rounded to the nearest day)', () => {
    // height 30/365.25 yr before 2026-06-23 -> 2026-05-24
    expect(completeDate('2026-05', 30 / 365.25, ref)).toBe('2026-05-24');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/hipstr-parse.test.js`
Expected: FAIL — `clockRefMs`/`completeDate` not exported.

- [ ] **Step 3: Append the implementation** to `scripts/hipstr-parse.mjs`:

```js
const DAY_MS = 86400000;

// Height-0 calendar date (in ms) fit from the full-date tips: mean of
// date + height*year. On a clock-consistent tree every full tip agrees.
export function clockRefMs(fullTips) {
  if (!fullTips.length) throw new Error('no full-date tips to fit the clock');
  const sum = fullTips.reduce((a, t) => a + Date.parse(t.date) + t.height * MS_PER_YEAR, 0);
  return sum / fullTips.length;
}

// Full dates pass through; a YYYY-MM date is completed to the tree-implied day
// (ref - height), rounded to the nearest whole day so it matches where PearTree
// draws the tip.
export function completeDate(rawDate, height, refMs) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  const ms = refMs - height * MS_PER_YEAR;
  const rounded = Math.round(ms / DAY_MS) * DAY_MS;
  return new Date(rounded).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/hipstr-parse.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/hipstr-parse.mjs scripts/hipstr-parse.test.js
git commit -m "Add hipstr-parse: clock reference + truncated-date completion"
```

---

## Task 4: `hipstrToInline`

**Files:**
- Modify: `scripts/hipstr-parse.mjs`
- Test: `scripts/hipstr-parse.test.js`

Replaces each numbered tip token `<delim><number>[&<stats>]` with an inline tip
`<delim><accession>[&date=…,accession=…,location=…,health_zone=…,health_area=…,lat=…,lon=…,exported=…,<stats>]`,
preserving internal-node `)[&…]` blocks, and emits a minimal single-line NEXUS
(`#NEXUS` / `BEGIN TREES;` / the tree / `END;`) with the taxa+Translate blocks dropped.

- [ ] **Step 1: Append the failing test** to `scripts/hipstr-parse.test.js`:

```js
import { hipstrToInline } from './hipstr-parse.mjs';

const FILE = `#NEXUS
Begin taxa;
	Dimensions ntax=2;
	Taxlabels
		'X|PP_A.1|DRC|Ituri|Bunia|2026-06-13'
		'Y|PP_B.1|DRC|Ituri|Mongwalu|2026-06'
;
End;
Begin trees;
	Translate
		1 'X|PP_A.1|DRC|Ituri|Bunia|2026-06-13',
		2 'Y|PP_B.1|DRC|Ituri|Mongwalu|2026-06'
;
tree TREE1 = [&R] (1[&height_mean=0.02739726027,foo=1]:0.05,2[&height_mean=0.05479452055,foo=2]:0.05)[&posterior=1.0,height_mean=0.1,height_95%_HPD={0.08,0.12}]:0.0;
End;`;

// resolve stub: canon Mongwalu->Mongbwalu, geo fixed
const resolve = (f) => ({
  accession: f.accession, date: f.date, location: f.location,
  health_zone: f.location === 'Mongwalu' ? 'Mongbwalu' : f.location,
  health_area: 'null', lat: 1.5, lon: 30.2, exported: false,
});

describe('hipstrToInline', () => {
  const { text, records } = hipstrToInline(FILE, { resolve });
  it('returns one record per tip, in tree order, with base accessions', () => {
    expect(records.map((r) => r.accession)).toEqual(['PP_A', 'PP_B']);
  });
  it('injects inline tip annotations named by accession', () => {
    expect(text).toContain('PP_A[&date="2026-06-13"');
    expect(text).toContain('health_zone="Mongbwalu"');
    expect(text).toContain('accession="PP_B"');
  });
  it('completes the truncated tip date from its height (ref fit from the full tip)', () => {
    // full tip PP_A: height 0.0274 yr ≈ 10 d, so height-0 ref = 2026-06-13 + 10 d =
    // 2026-06-23. PP_B height 0.0548 yr ≈ 20 d -> 2026-06-23 − 20 d = 2026-06-03.
    expect(records.find((r) => r.accession === 'PP_B').date).toBe('2026-06-03');
  });
  it('preserves the internal node and original tip stats, drops taxa/translate', () => {
    expect(text).toContain('height_95%_HPD={0.08,0.12}');   // internal node intact
    expect(text).toContain('foo=1');                         // original tip stats kept
    expect(text).not.toMatch(/Translate|Taxlabels/);         // blocks dropped
    expect(text.startsWith('#NEXUS')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/hipstr-parse.test.js`
Expected: FAIL — `hipstrToInline` not exported.

- [ ] **Step 3: Append the implementation** to `scripts/hipstr-parse.mjs`:

```js
// A numbered tip token: a `(` or `,` delimiter, the leaf number, then its [&...]
// stats block. Internal nodes are `)[&...]` (no number) and are never matched.
const TIP_TOKEN = /([(,])(\d+)\[&([^\]]*)\]/g;
const heightOf = (stats) => Number((stats.match(/height_mean=([0-9.eE+-]+)/) || [])[1]);

export function hipstrToInline(text, { resolve }) {
  const trans = parseTranslate(text);
  const treeStr = text.slice(text.indexOf('tree TREE1'));

  // Pass 1: collect each tip's parsed label + height; fit the clock from full-date tips.
  const byNum = new Map();
  const fullTips = [];
  for (const m of treeStr.matchAll(TIP_TOKEN)) {
    const num = m[2];
    if (!trans.has(num)) continue;
    const fields = parseLabel(trans.get(num));
    const height = heightOf(m[3]);
    byNum.set(num, { fields, height });
    if (/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) fullTips.push({ date: fields.date, height });
  }
  const refMs = clockRefMs(fullTips);

  // Pass 2: rewrite tip tokens; collect records in tree order.
  const records = [];
  const newTree = treeStr.replace(TIP_TOKEN, (whole, delim, num, stats) => {
    if (!trans.has(num)) return whole;
    const { fields, height } = byNum.get(num);
    const date = completeDate(fields.date, height, refMs);
    const rec = resolve({ accession: fields.accession, date, location: fields.location });
    records.push(rec);
    const ann =
      `date="${date}",accession="${rec.accession}",location="${rec.location}"` +
      `,health_zone="${rec.health_zone}",health_area="${rec.health_area}"` +
      `,lat=${rec.lat},lon=${rec.lon},exported=${rec.exported},${stats}`;
    return `${delim}${rec.accession}[&${ann}]`;
  });

  const treeLine = newTree.slice(0, newTree.indexOf(';') + 1);   // up to the tree terminator
  return { text: `#NEXUS\nBEGIN TREES;\n\t${treeLine}\nEND;\n`, records };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/hipstr-parse.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/hipstr-parse.mjs scripts/hipstr-parse.test.js
git commit -m "Add hipstr-parse: hipstrToInline tree rewrite"
```

---

## Task 5: Swap the orchestrator to the n139 HIPSTR source + regenerate

**Files:**
- Modify: `scripts/build-tree.mjs`
- Regenerated: `public/data/ituri-tree.ptree`, `ituri-tips.json`, `ituri-meta.json`

- [ ] **Step 1: Update `build-tree.mjs`**

Change the source constant and front-end. In `scripts/build-tree.mjs`:

Replace the import line:
```js
import {
  CORRECTIONS, makeCanon, parseZones, resolveTip,
  enrichTreeText, rootHeightFromText, computeMeta,
} from './tree-lib.mjs';
```
with:
```js
import {
  CORRECTIONS, makeCanon, parseZones, resolveTip,
  rootHeightFromText, computeMeta,
} from './tree-lib.mjs';
import { hipstrToInline } from './hipstr-parse.mjs';
```

Replace the source constant:
```js
const SOURCE_TREE = 'Ituri_2026-06-26_n35.EGC.ptree';
```
with:
```js
const SOURCE_TREE = 'Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree';
```

Replace the enrichment call:
```js
const { text, records } = enrichTreeText(rawText, resolve);
```
with:
```js
const { text, records } = hipstrToInline(rawText, { resolve });
```

(Everything else — `resolve`, `computeMeta`, the tips mapping, writes, logging — is unchanged.)

- [ ] **Step 2: Run the pipeline**

Run: `node scripts/build-tree.mjs --date=2026-07-06`
Expected output:
```
Tips enriched: 139
Exported tips: 0
Zones used: Aru, Aungba, Bambu, Bunia, Gethy, Katwa, Kilo, Komanda, Lita, Mambasa, Mangala, Mongbwalu, Nizi, Nyakunde, Rimba, Rwampara
Meta: mostRecent=2026-06-23 root=2026-02-28 updated=2026-07-06
```

- [ ] **Step 3: Spot-check the generated files**

```bash
node -e "const t=require('./public/data/ituri-tips.json'); console.log('n=',t.length, 'partialDates=', t.filter(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x.date)).length, 'exported=', t.filter(x=>x.exported).length); console.log(t.find(x=>x.id==='PP_0075Z74')); console.log(t.find(x=>x.id==='PP_00711T3'));"
cat public/data/ituri-meta.json
```
Expected: `n= 139 partialDates= 0 exported= 0`; `PP_0075Z74` has `date:'2026-05-13'`, `location:'Aru'`, `health_zone:'Aru'`; `PP_00711T3` has `location:'Rwampara', health_zone:'Rwampara'`; meta = `{mostRecentDate:'2026-06-23', rootDate:'2026-02-27', sourceTree:'Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree', updated:'2026-07-06', tipCount:139}`.

If any value differs, STOP and report rather than committing.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-tree.mjs public/data/ituri-tree.ptree public/data/ituri-tips.json public/data/ituri-meta.json
git commit -m "Regenerate app tree from the n139 HIPSTR source"
```

---

## Task 6: Update the integration test for n139

**Files:**
- Modify: `scripts/build-tree.integration.test.js`

- [ ] **Step 1: Replace the test body** with n139 invariants. Overwrite `scripts/build-tree.integration.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tips = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-tips.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-meta.json'), 'utf8'));
const tree = readFileSync(join(ROOT, 'public/data/ituri-tree.ptree'), 'utf8');

const MS_PER_YEAR = 365.25 * 86400000;

describe('enriched n139 tree artifacts', () => {
  it('has 139 fully-geocoded tips with full dates', () => {
    expect(tips).toHaveLength(139);
    for (const t of tips) {
      expect(t.health_zone).toBeTruthy();
      expect(typeof t.lat).toBe('number');
      expect(typeof t.lon).toBe('number');
      expect(typeof t.exported).toBe('boolean');
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);   // no leftover YYYY-MM
    }
  });
  it('has no exports and resolves Sota to Nyakunde', () => {
    expect(tips.filter((t) => t.exported)).toHaveLength(0);
    const sota = tips.find((t) => t.location === 'Sota');
    expect(sota.health_zone).toBe('Nyakunde');
  });
  it('meta carries dates + provenance with root before most-recent', () => {
    expect(meta).toMatchObject({ mostRecentDate: '2026-06-23', rootDate: '2026-02-27', tipCount: 139 });
    expect(meta.sourceTree).toBe('Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree');
    expect(meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.rootDate < meta.mostRecentDate).toBe(true);
  });
  it('is clock-consistent: tip date vs height implied-reference spread < 2 days', () => {
    // reconstruct each tip's height from the tree and check date + height agree
    const h = new Map();
    for (const m of tree.matchAll(/accession="([^"]+)"[^\]]*height_mean=([0-9.eE+-]+)/g)) {
      h.set(m[1], Number(m[2]));
    }
    const refs = tips.filter((t) => h.has(t.id))
      .map((t) => Date.parse(t.date) + h.get(t.id) * MS_PER_YEAR);
    const spreadDays = (Math.max(...refs) - Math.min(...refs)) / 86400000;
    expect(spreadDays).toBeLessThan(2);
  });
  it('injected exactly 139 accession annotations into the tree', () => {
    expect((tree.match(/accession="/g) || []).length).toBe(139);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run scripts/build-tree.integration.test.js`
Expected: PASS (5 tests). (Artifacts already exist from Task 5.)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all suites pass (existing app tests + `tree-lib` + `hipstr-parse` + integration).

- [ ] **Step 4: Commit**

```bash
git add scripts/build-tree.integration.test.js
git commit -m "Update integration test for the n139 HIPSTR artifacts"
```

---

## Self-review notes

- **Spec coverage:** new source (Task 1), Mungwalu/Sota aliases (Task 1), Translate/label parsing incl. quotes + 6-field + `.N` (Task 2), tree-implied day completion (Task 3), numbered-tip rewrite + drop taxa/translate + preserve internal nodes/stats (Task 4), orchestrator swap + regenerate (Task 5), clock-consistency + full-date + Sota invariants (Task 6). Covered.
- **Reuse:** `resolveTip`/`parseZones`/`computeMeta`/`rootHeightFromText`/`makeCanon` unchanged; `enrichTreeText` no longer imported by the orchestrator but stays in `tree-lib` (still unit-tested).
- **Type consistency:** `resolve` returns `{accession,date,location,health_zone,health_area,lat,lon,exported}`; `hipstrToInline` and the tips.json mapping consume exactly those; `health_area` is `'null'` in the tree, JSON `null` in tips.json (converted in `build-tree.mjs`, unchanged from the prior task).
- **No placeholders:** every code/command step is concrete with grounded expected output.
- **Follow-up (out of scope):** upstream re-export with real days fixed would remove the tree-implied-day estimate for the 3 date-inconsistent tips.
