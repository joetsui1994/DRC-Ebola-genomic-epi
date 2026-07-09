# DHIS line list refresh + sample-collected toggle

**Date:** 2026-07-09
**Status:** Approved (pending spec review)

## Background

The app ingests two line-list versions selectable in the header: `lab`
(`public/data/linelist_data.csv`, largely discontinued but retained) and `dhis`
(`public/data/linelist_data.dhis.csv`). Selection lives in
`src/linelist-source.js`; parsing lives in `parseLinelist()` in `src/main.js`.

The current DHIS file (3,386 rows) was hand-built once from a `.numbers` file
and committed directly — no in-repo converter exists. A new upstream pipeline
(`BDBV2026-Linelist_Processing`) now produces dated DHIS2 exports under
`data/processed/dhis2_linelist_processed/LINELIST_DDMMYYYY/`, with a
`latest.json` pointer. The newest at time of writing is `LINELIST_08072026`
(`dhis2_processed_linelist.csv`, the git-safe / no-PII file, ~10,663 rows across
6 provinces).

The new pipeline's schema differs from the old hand-built file, so this is a
**defined transformation**, not a file swap. This spec covers (1) a one-time
regeneration of the DHIS CSV from the newest export, and (2) a new client-side
toggle to view rows with/without a sample collected.

## Key semantic change

The app's `status` column (`Positive`/`Negative`/`Invalid`/`Unclassified`) was
previously a **lab/PCR-result** concept. The new pipeline does not carry a
lab-result string — only raw Ct numbers and an **epidemiological**
`final_mve_case_classification`. Per decision, `status` is now derived from the
case classification. Consequence: `Invalid` no longer appears, and the
`Unclassified` bucket now means "alert not yet classified as a case" rather than
"lab test not yet run". This is an intentional change in what the status bars
mean.

## Part 1 — Data conversion (one-time, manual)

**Source:** `.../dhis2_linelist_processed/LINELIST_08072026/dhis2_processed_linelist.csv`
(git-safe, PII columns already dropped upstream). Use the `dhis2_processed_linelist.csv`
variant — never `_names.csv` (contains PII: name/address/phone).

**Scope:** include **all** records (~10,663). Row grain = one output row per source record.

**Output:** `public/data/linelist_data.dhis.csv`, existing header **plus one new
column** `sample_collected`:

```
row_id,sample_id,province,health_zone,health_area,lab_name,status,date,ct,being_sequenced,sample_collected
```

| Output column | Source / rule |
|---|---|
| `row_id` | sequential `1…N` |
| `sample_id` | `alert_id` (blank → `NA`) |
| `province` | `province` (blank → `NA`) |
| `health_zone` | `health_zone` (blank → `NA`) |
| `health_area` | `health_area` (blank → `NA`) |
| `lab_name` | `lab_name` (blank → `NA`) |
| `status` | from `final_mve_case_classification`: `confirmed_case`→`Positive`; `not_a_case`→`Negative`; `suspected_case`/`probable_case`/**empty**→`Unclassified` |
| `date` | `date_of_symptom_onset` (blank → `NA`) |
| `ct` | `radi_one_ebola_valeur_ct_fam_ebov` only, passed through as-is including out-of-range entries (blank → `NA`) |
| `being_sequenced` | blank (DHIS carries no sequencing marks) |
| `sample_collected` | `1` if `samples_received == 1`, else `0` (~4,176 rows are `1`) |

Expected status distribution over all rows: `Positive 1824 / Negative 2188 /
Unclassified 6651`.

**Field derivation was reverse-engineered** by joining the current committed
DHIS file to the new export on `alert_id`: `date`←`date_of_symptom_onset`,
`ct`←`radi_one_ebola_valeur_ct_fam_ebov`, `sample_id`←`alert_id` all confirmed.

**Ct note:** the new export has five Ct-like columns.
`radi_one_ebola_valeur_ct_fam_ebov` is the RadiOne EBOV-target Ct and the one the
app already used. The Altona columns are excluded: `altona_valeur_cr_fam` and
`altona_valeur_ct_c45` are `TRUE`/`FALSE` channel flags (not Ct values), and
`altona_valeur_ct_hex`, though numeric, is believed to be an internal control.
`radi_one_ebola_valeur_ct_hec_ic` is the RadiOne internal control. Only
`radi_one_ebola_valeur_ct_fam_ebov` is used.

**Method:** a throwaway Python script (in the scratchpad, **not committed**),
matching how the prior file was produced. Only the resulting CSV is committed.
The mapping table above is the reproducibility record.

**Values that are passed through uncleaned** (matching current behavior): Ct
out-of-range entries (e.g. `1984`, `3202`) and any anomalous `date` values.

## Consistency checks (completed, against app canonical names)

Canonical references: `public/data/health-zones.geojson` — `Nom` (519 health
zones) and `PROVINCE` (26 provinces).

- **Province:** all values in the new export are canonical. No action.
- **Health zone:** after applying `public/data/aliases.csv`
  (`observed_name`→`canonical_nom`), all zones match canonical **except 2 single
  rows** — `Kalamu 2` and `Mont Ngafula 1`. The geojson uses roman-numeral
  suffixes for Kinshasa sub-zones, so these are arabic-vs-roman spelling
  variants of canonical zones that do exist (`Kalamu II`, `Mont Ngafula I`).
  **Add two `aliases.csv` entries** so they resolve:
  `Kalamu 2`→`Kalamu II` and `Mont Ngafula 1`→`Mont Ngafula I`
  (`source_dataset: dhis`). Aside from these two, the new pipeline already
  canonicalizes zone names to the same shapefile the app's geojson derives from,
  so no other alias changes are required.
- **Health area:** the app has **no canonical health-area reference** (the map
  stops at zone level; `health_area` is passed through for display only). Not
  checkable and not required for the map to render.

## Part 2 — App: sample-collected toggle

**Parsing:** `parseLinelist()` (`src/main.js`) reads the new `sample_collected`
column as a boolean. If the column is **absent** (the Lab file), every row is
treated as sample-collected, so the Lab source is unaffected.

**Control:** a checkbox in the header, adjacent to the existing Lab/DHIS
`<select>`, labelled **"Sample collected only"**.
- **Default: ON** (reproduces today's sample-based grain).
- **Shown/active only when the source is `dhis`**; hidden for `lab`.

**Behavior: instant client-side filter** — toggling re-filters the parsed rows
and re-runs the linelist consumers (zone tally / map, prioritisation candidates,
time-series & distribution panel) with **no page reload**. This differs from the
Lab/DHIS selector, which reloads via URL param; the requirement here is an
instant toggle.

**Refactor required:** the linelist consumers currently run once at load against
the full parsed array. Extract a single "compute/render from a given rows array"
entry point that both the initial load and the toggle handler call, so toggling
recomputes `tallyZones`, `window.__PRIO_LINELIST__` / `src/prioritise-data.js`,
and the time-series panel against the filtered rows. Keep the full parsed array
in memory; filter on toggle rather than re-fetching.

## Testing

- Extend `src/linelist-source.test.js` as needed (source keys/files unchanged).
- Add a unit test for the filter helper: filters to `sample_collected === true`
  when active; passes all rows through when the column is absent (Lab file).
- Manual/browser verification: load DHIS, confirm the toggle appears, defaults
  ON, and that switching it live updates map, candidates, and time-series
  without reload; confirm the toggle is hidden for Lab.

## Out of scope / non-goals

- No reusable/automated converter (one-time manual refresh per decision). A
  future `latest.json`-driven `npm run data:linelist` could be added later.
- No changes to the Lab line list or its file.
- No health-area canonicalization or map layer.
- No Ct data-cleaning beyond blank→`NA`.

## Amendment (2026-07-09): drop unrealistic onset dates

`date_of_symptom_onset` in the export contains data-entry errors with years
other than 2026 (e.g. 1984, 2020, 2023, 2025). Because the allocation-matrix
origin is the earliest *eligible* candidate date, a single 2023 outlier stretched
the matrix to ~1,120 daily columns (~6% populated). The conversion now **drops
any row whose onset date is not in 2026** (NA/blank dates are kept). This removed
8 rows (10,663 → 10,655) and moved the matrix origin from 2023-06-13 to
2026-04-20 (~79 columns). The timeseries panel was unaffected (it clamps to
`meta.rootDate`).
