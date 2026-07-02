# Tree enrichment pipeline (n35 EGC time tree)

**Date:** 2026-07-02
**Status:** Approved

## Problem

The dashboard's phylogenetics panel (PearTree, via `src/tree-panel.js`) renders a
**deprecated** enriched tree: `public/data/Ituri_2026-05-28_HKY_EGC_rate1.9E-3.HIPSTR.enriched.ptree`.
An updated Bayesian time tree is available in the sibling repo
`/Users/user/Documents/work/BDBV2026-Trees`, but it is not yet in the shape the
app needs, and there is **no pre-processing script in this repo** — the previous
enriched tree was produced by an external pipeline.

The app is built for a **time-scaled, geographically-enriched** NEXUS tree plus
two derived files (`ituri-tips.json`, `ituri-meta.json`). It needs:

- a dated tree with per-tip `accession`, `date`, node-age uncertainty
  (`height_95%_HPD`), internal-node `posterior` — for the time axis, node bars,
  and tip selection;
- per-tip `health_zone` (tip colour/labels/legend), `health_area`, `lat`, `lon`
  (map + coordinator);
- `ituri-tips.json` (per-tip geo record) and `ituri-meta.json` (root/most-recent
  dates) regenerated to match the tree.

## Chosen source tree

Of the three trees in `BDBV2026-Trees`:

| File | Taxa | Type | Time-scaled | Usable |
|---|---|---|---|---|
| `Ituri_2026-06-30_DRC_n120.ml.ptree` | 120 | ML | no | no (untimed; different `26FHV…`/`BIA-…` ID scheme) |
| `Ituri_2026-06-26_n35.ml.ptree` | 35 | ML | no | no (untimed) |
| **`Ituri_2026-06-26_n35.EGC.ptree`** | **35** | **BEAST time tree** | **yes** | **yes** |

**We use `Ituri_2026-06-26_n35.EGC.ptree`** — the only time-scaled tree. It is the
direct successor to the current enriched tree (same `PP_` accessions) and already
carries `accession`, `date`, `location`, `posterior`, `height_mean/median`,
`height_95%_HPD`. It lacks only the geographic enrichment (`health_zone`,
`health_area`, `lat`, `lon`), which this pipeline adds.

The larger n120 set exists only as an untimed ML tree with no BEAST counterpart
here; using it would require an upstream time-scaling run and is out of scope.

## Approach

A **build-time Node script** — `scripts/build-tree.mjs`, run via `npm run
data:tree` — following the exact pattern of the existing `data:risk`
(`scripts/update-relative-risk.mjs`) and `data:zones` scripts. It reads committed
inputs and writes committed output files; no runtime cost.

Rejected: runtime enrichment in `main.js` — it would re-parse the tree and geojson
on every page load and scatter geo logic across the app. The repo's established
convention is a script that emits data files.

## File layout

**Raw trees are kept out of `public/`** (which is served). A new committed,
non-served directory `data-raw/` at repo root holds the pipeline inputs:

- `data-raw/Ituri_2026-06-26_n35.EGC.ptree` — the raw source tree.
- `data-raw/Ituri_2026-05-28_HKY_EGC_rate1.9E-3.HIPSTR.enriched.ptree` — the old
  enriched tree, moved here as a historical archive. It is **no longer a pipeline
  input** (lat/lon is recomputed from the polygons, not reused); it is moved out of
  `public/` only so the deprecated tree is no longer served once `TREE_URL` is
  repointed.

**The app reads a stable filename** that never changes across tree refreshes:
`public/data/ituri-tree.ptree`. Each future update overwrites it, so
`tree-panel.js` is edited once (now) and never again for routine tree swaps.

## Inputs

- `data-raw/Ituri_2026-06-26_n35.EGC.ptree` — raw source tree.
- `public/data/health-zones.geojson` — `Nom` → `cx`/`cy`. These `cx`/`cy` are the
  **pole-of-inaccessibility** coordinates (computed by the `data:zones` mapshaper
  step via `innerX`/`innerY`), so they are the correct lat/lon for a zone. `cx` =
  longitude, `cy` = latitude.
- `public/data/aliases.csv` — `observed_name → canonical_nom` crosswalk, with
  **two new rows added**:
  - `Mongwalu,Mongbwalu,egc_tree,Spelling variant of Mongbwalu in the EGC tree`
  - `Nyankunnde,Nyakunde,egc_tree,Double-n typo of Nyakunde in the EGC tree`

The old enriched tree is **not** an input — lat/lon is recomputed for every tip
from the geojson polygons rather than reused, so no stale coordinate can carry
over when a tip is relocated between trees.

## Location corrections

Some accessions are mislabelled in the raw EGC tree and are corrected by an
explicit, documented map applied to the raw `location` **before** anything else:

| Accession | Raw location | Corrected to | Reason |
|---|---|---|---|
| `PP_00711T3` | `Lumumba` | `Rwampara` | Upstream mislabel; the sample belongs to Rwampara (as in the prior enriched tree). `Lumumba` is not a health zone. |

With this correction, `Lumumba` no longer appears and **every one of the 35 tips
resolves to a real health zone present in `health-zones.geojson`** — there are no
sub-zone or off-polygon locations left to special-case.

## Per-tip enrichment rule

For each of the 35 tips, keyed by `accession`:

1. **Apply the location correction map** (above) to the raw `location`.
2. **Parse the corrected `location`.** If it begins with `ex-`, strip the prefix to
   get the base zone and set `exported=true`; otherwise `exported=false`. (In this
   tree the only export value is `ex-Bunia` → base `Bunia`, on `PP_006XCJJ` and
   `PP_006XXY5`.)
3. **`health_zone`** = the base zone canonicalised through `aliases.csv`.
   **`health_area` = null** (the old enriched tree recorded `health_area` as
   `"null"` for every tip; location sits at zone level).
4. **`lat`/`lon`** = the health zone's `cy`(lat)/`cx`(lon) from
   `health-zones.geojson`, for **every** tip — a single, uniform coordinate source
   (the polygon pole of inaccessibility). No reuse of legacy points.

### Export semantics

`ex-Bunia` means the case **originated in Bunia and was sampled elsewhere** (an
export out of Bunia). The raw field records only the origin; no destination/
sampling zone exists in the data. Therefore export tips are set to
`location="Bunia"`, `health_zone="Bunia"`, lat/lon at Bunia, and `exported=true`.
The `exported` boolean is written on **all 35 tips** (`true`/`false`) so the schema
is uniform and always present.

`exported` is **stored** (in the tree and in `ituri-tips.json`) but **not yet
visualised** — no new marker or colour treatment. Any visual treatment is a
separate future decision (YAGNI).

## Outputs (all committed)

1. **`public/data/ituri-tree.ptree`** — the EGC tree with `health_zone`,
   `health_area`, `lat`, `lon`, `exported` injected into each tip's annotation
   block, alongside the existing `accession`/`date`/`location` (with `location`
   normalised for export tips). Topology, branch lengths, `posterior`,
   `height_mean`/`height_median`, and `height_95%_HPD` are left byte-intact.
2. **`public/data/ituri-tips.json`** — regenerated for all 35 tips:
   `{ id, date, location, health_zone, health_area, lat, lon, exported }`.
3. **`public/data/ituri-meta.json`** — regenerated with tree-derived dates plus
   provenance:
   ```json
   {
     "mostRecentDate": "<max tip date>",
     "rootDate": "<mostRecentDate − root node height>",
     "sourceTree": "Ituri_2026-06-26_n35.EGC.ptree",
     "updated": "2026-07-02",
     "tipCount": 35
   }
   ```
   `mostRecentDate` = the latest tip `date`. `rootDate` = `mostRecentDate` minus
   the root node's height (heights are in years; convert to days). `updated` is the
   date the script is run (stampable via `--date`, defaulting to today).
4. **`public/data/aliases.csv`** — the two new rows above appended.
5. **`src/tree-panel.js`** — `TREE_URL` repointed once to
   `${import.meta.env.BASE_URL}data/ituri-tree.ptree`.

## Components / units

- **NEXUS annotation parse/serialise** — read a tip's `[&key=val,…]` block into a
  map and write it back, preserving all untouched keys and numeric formatting. The
  only structural edit is injecting/normalising the tip keys above; internal-node
  blocks and the Newick topology pass through unchanged.
- **Alias canonicaliser** — reuse the same crosswalk semantics as `main.js`
  (`makeCanon`) / `update-relative-risk.mjs` so zone names reconcile identically at
  build time and runtime.
- **Geo resolver** — canonical health_zone → geojson `cx`/`cy`, for every tip;
  fails loudly if a tip's zone is absent from the geojson (so a future new location
  can't silently get null coordinates).
- **Meta computer** — max tip date and root height → `mostRecentDate`/`rootDate`.

## Error handling

- Any tip whose canonicalised zone is absent from the geojson → **hard error**
  listing the accession + corrected location, rather than emitting a tip with null
  lat/lon.
- Unparseable dates or a missing root height → hard error.
- The script is **idempotent**: re-running on the same inputs reproduces identical
  outputs (dates read from data; `updated` is the only run-stamped field).

## Testing

- Unit: annotation parse↔serialise round-trips a real tip block unchanged; the
  correction map turns `PP_00711T3`'s `Lumumba` into `Rwampara`; `ex-Bunia` →
  `location=Bunia`/`exported=true`; a tip's lat/lon equals its zone's geojson
  `cy`/`cx`.
- Integration: run the script on the real inputs; assert 35 tips in
  `ituri-tips.json`, all with non-null `health_zone`/`lat`/`lon` and a boolean
  `exported`; assert exactly 2 `exported=true`; assert no tip's `location` is
  `Lumumba`; assert `ituri-meta.json` has all five fields and
  `rootDate < mostRecentDate`.
- Manual: load the dashboard, confirm the tree renders with a time axis, node bars,
  health-zone tip colours, and that map markers place at the enriched coordinates.

## Out of scope

- Time-scaling the n120 ML tree (needs an upstream BEAST run).
- Visual treatment of `exported` tips.
- Any change to the map/timeseries aggregation semantics.
