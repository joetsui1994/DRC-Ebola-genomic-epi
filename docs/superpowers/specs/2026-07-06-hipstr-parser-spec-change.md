# Spec change: HIPSTR/Translate input format + n139 source

**Date:** 2026-07-06
**Status:** Approved
**Amends:** `docs/superpowers/specs/2026-07-02-tree-enrichment-pipeline-design.md`

## Why

Two changes to the tree enrichment pipeline:

1. **New source tree.** Switch from the EGC n35 tree to the clock-consistent
   HIPSTR build `Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree` (139 tips). The EGC
   tree's tip heights were not clock-consistent (implied-reference spread 7.7
   days), which broke the tree↔histogram marker alignment because PearTree
   positions nodes by height while the app marks by date. The HIPSTR build is
   clock-consistent (spread **0.036 days**, height-0 ≈ 2026-06-23), so the existing
   alignment code works with **no app changes** — the same reason the original
   `…HIPSTR.enriched.ptree` worked.

2. **New input dialect.** The HIPSTR tree is a standard TreeAnnotator/FigTree
   NEXUS file, structurally different from the EGC tree the current pipeline
   parses. This spec adds a **parser front-end**; the enrichment **core is reused
   unchanged**.

The output format, the app, and `src/tree-panel.js` are **unchanged** — the
pipeline still emits the same inline-annotated single-line `public/data/ituri-tree.ptree`
plus `ituri-tips.json` / `ituri-meta.json`.

## Input format (n139) vs the EGC tree

| | EGC n35 (current pipeline) | HIPSTR n139 (this change) |
|---|---|---|
| Tip metadata | inline `accession=`,`date=`,`location=` per tip | in the **taxon label** |
| Taxon label | tip name only | `'26FHV0069\|PP_0075YWS.1\|DRC\|Ituri\|Rwampara\|2026-05-20'` (single-quoted) |
| Label fields | — | 6: `fieldID \| accession \| country \| province \| location \| date` |
| Tip identity in tree string | the name inline | a **number**, resolved via a `Translate` block |
| Tip `[&…]` block | date/location/accession + stats | **only** BEAST stats (`height_*`, `length_*`, `rate_*`, `%_HPD`) |
| Accession | `PP_0075YWS` | `PP_0075YWS.1` (`.N` version suffix) |
| Dates | all full `YYYY-MM-DD` | **11 of 139 truncated to `YYYY-MM`** |
| Structure | single-line tree, no taxa/translate blocks | `Begin taxa` + `Begin trees`/`Translate` + numbered tree |

The label format is **not stable across builds** (n120 had 5 fields, unquoted, no
`.N` suffix; n139 has 6 fields, quoted, `.N` suffix). The parser must therefore be
defensive rather than assume fixed field positions.

## New component: `scripts/hipstr-parse.mjs` (pure functions)

A new pure-function module (no IO), unit-tested, exporting:

- **`parseTranslate(text) → Map<string number, string label>`** — parse the
  `Translate` block, stripping surrounding single quotes from labels.
- **`parseLabel(label) → {fieldId, accession, location, date}`** — split on `|`;
  strip the `.N` version suffix from the accession; **locate the date field by
  pattern** (`/^\d{4}-\d{2}(-\d{2})?$/`, last field) and take `location` as the
  field immediately before it, so a 5- or 6-field label both parse correctly
  (robust to the province field being present or absent). Return the `YYYY-MM` or
  `YYYY-MM-DD` date verbatim (day-completion handled downstream, see below).
- **`hipstrToInline(text, { resolve, completeDate }) → { text, records }`** —
  1. build the number→label map (`parseTranslate`) and per-number fields
     (`parseLabel`);
  2. walk the tree string, replacing each **numbered tip token** `N[&…stats…]`
     with an inline-annotated tip `` `${accession}[&date="…",accession="…",location="…",health_zone="…",health_area="null",lat=…,lon=…,exported=…,${stats}]` ``,
     where the geo fields come from `resolve(fields)` (the existing `resolveTip`)
     and `stats` is the original `[&…]` content preserved verbatim (keeps
     `height_mean`/`height_95%_HPD` etc. on tips);
  3. leave internal-node `)[&…]` blocks and the topology untouched;
  4. **drop the `Begin taxa` and `Translate` blocks**, emitting the same
     single-line inline `.ptree` shape the app already consumes;
  5. collect one record per tip (for `ituri-tips.json`), in tree order.

  Tip identity in the output is the **base accession** (`PP_0075YWS`), matching
  the app's `selectByAnnotation('accession', …)` and the prior data's ids.

### Reused unchanged (from `scripts/tree-lib.mjs`)

`makeCanon`, `parseZones`, `resolveTip` (correction → ex- → canon → geo),
`computeMeta`, `rootHeightFromText`, `enrichTipInner`. The orchestrator
`scripts/build-tree.mjs` swaps its front-end from `enrichTreeText` to
`hipstrToInline` but keeps the same geo/meta/output wiring.

## Truncated dates (`YYYY-MM`) — day completion

11 tips carry only `YYYY-MM`. These BEAST-estimated the unknown day, so the tip's
**height already encodes an estimated day**. Verified against the recorded n120
dates: 8 of 11 agree within ≤2 days, but **3 disagree by 4–13 days**
(`PP_0075Z74` 13 d, `PP_0075ZFN` 8 d, `PP_0075Z90` 4 d) — because the tree used
its own estimate, not the recorded day.

**Consequence:** filling the recorded n120 day for these 3 would place their
marker several days off where PearTree draws them — re-introducing the very
misalignment this change fixes.

**Decision: (A) tree-implied day.** Set each truncated (`YYYY-MM`) tip's date to
its tree-implied day — `dayFromHeight(height) = ref − height·365.25`, where `ref`
is the height-0 reference fit from the 128 full-date tips (their mean of
`date + height·365.25`). This guarantees every marker aligns with where PearTree
draws the node; for the 8 consistent tips it lands within a day of the recorded
date, and for the 3 inconsistent ones it uses the tree's own estimate (which is
what the geometry represents) rather than a recorded day the tree wasn't built
with. Full-date tips keep their recorded date verbatim.

`completeDate(fields, height, ref)` is a small function: return the recorded date
unchanged if it is already `YYYY-MM-DD`; otherwise return `dayFromHeight(height)`
formatted `YYYY-MM-DD`. `ref` is computed once from the full-date tips before the
tip walk. (The durable upstream fix — re-exporting with real days fixed so the
recorded dates match the geometry — is noted as a follow-up but not required here.)

## Location reconciliation (n139)

20 distinct locations; 18 resolve via existing geojson `Nom` + `aliases.csv`. Deltas:

- **Add two alias rows:**
  - `Mungwalu,Mongbwalu,egc_tree,Spelling variant of Mongbwalu`
    (joins `Mungwalu`/`Mongwalu`/`Mongbwalu` — three spellings — to one zone;
    `Mongwalu→Mongbwalu` was already added; `Gety→Gethy` already exists).
  - `Sota,Nyakunde,egc_tree,Locality in the Nyakunde health zone`
    — `Sota` is a locality in the **Nyakunde** health zone (per data owner). It maps
    directly to the geojson `Nom` `Nyakunde` (not the alias `Nyankunde`), so the
    Sota tip gets `location="Sota"`, `health_zone="Nyakunde"`, and Nyakunde's
    pole-of-inaccessibility lat/lon. All 20 locations now resolve.
- **`Lumumba` no longer appears** (the EGC-era sub-zone correction is moot);
  `CORRECTIONS` is empty for this source (`Sota` is handled via alias, not a
  correction).
- **No `ex-` exports** in this tree; the `exported` flag is emitted `false` for all
  tips (schema stays uniform).

## Outputs (unchanged shape)

- `public/data/ituri-tree.ptree` — regenerated, 139 inline-annotated tips.
- `public/data/ituri-tips.json` — 139 records `{id, date, location, health_zone,
  health_area, lat, lon, exported}` (`id` = base accession).
- `public/data/ituri-meta.json` — `mostRecentDate` (max tip date), `rootDate`
  (`mostRecentDate − rootHeight`), `sourceTree` =
  `Ituri_2026-07-06_DRC_n139.ebds.hipstr.tree`, `updated`, `tipCount` = 139.
- Raw tree committed to `data-raw/`; `TREE_URL` already points at the stable
  `data/ituri-tree.ptree` (no `src/` change).

## Error handling / validation

- Field-count/format drift: `parseLabel` locates the date by pattern and derives
  `location` relative to it, and **asserts** every label yields a non-empty
  accession + location + a `YYYY-MM(-DD)` date — hard error listing offending
  labels otherwise (so the next format shift fails loudly, not silently).
- Any tip whose canonical zone is absent from the geojson → hard error (unchanged
  `resolveTip` behavior); this is what surfaces an unhandled `Sota`.
- Clock sanity: after parsing, assert the full-date tips' implied-reference spread
  is small (e.g. < 2 days); a large spread means the source is not clock-consistent
  and the alignment assumption is violated — fail with a clear message rather than
  ship a misaligned tree.

## Testing

- Unit (`scripts/hipstr-parse.test.js`): `parseTranslate` strips quotes;
  `parseLabel` handles 5- and 6-field, quoted, and `.N`-suffixed labels and rejects
  a malformed label; `hipstrToInline` on a tiny fixture injects tip annotations,
  preserves an internal node, drops the taxa/translate blocks, and returns one
  record per tip.
- Integration (extend `scripts/build-tree.integration.test.js`): 139 fully-geocoded
  tips; every tip has a `YYYY-MM-DD` date after completion; clock spread of the
  generated tree < 2 days; `meta.tipCount === 139`; no unresolved zone.

## Out of scope

- App-side alignment changes (not needed with a clock-consistent tree).
- Displaying `exported`; visual treatment of estimated-day tips.
