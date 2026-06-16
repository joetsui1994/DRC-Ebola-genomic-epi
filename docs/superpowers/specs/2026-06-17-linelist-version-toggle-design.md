# Toggle between two line-list versions

**Date:** 2026-06-17
**Status:** Approved

## Problem

There are now two versions of the dashboard line list:

- the current **"Lab"** version (`linelist_data.csv`), and
- a new **"Hospital-admission"** version derived from a DHIS2 export with imputed
  onset dates and reduced Ct (`dhis2_prepared_onset_imputed_ct_reduced.numbers`).

Users should be able to toggle between them within the same deployed app (not a
separate page), with a full page reload on each switch.

## Decisions (from brainstorming)

- **Selection + persistence:** a header selector that writes a `?linelist=` URL
  param and reloads; the param drives which file loads (shareable/bookmarkable).
- **Default:** the current line list ("Lab") when the param is absent or unknown.
- **Labels:** `Lab` (current) and `Hospital-admission` (new).
- **Scope:** only the line list swaps — tree, tips, risk, and the time domain are
  fixed.

## Data prep — convert `.numbers` → CSV

Convert the source `.numbers` to **`public/data/linelist_data.hospital.csv`**.

- Source columns: `row_id, sample_id, province, health_zone, health_area,
  lab_name, status, date, ct, being_sequenced` (3386 data rows).
- **Status casing must be normalised** to the app's title-case categories:
  `positive → Positive`, `negative → Negative`, `invalid → Invalid`,
  `unclassified → Unclassified`. (The app matches `status === 'Positive'` etc.;
  lowercase would silently drop every row from the bars/tally/candidates.)
- Missing values written as the current file does: `NA` for absent `date`/`ct`,
  blank for `being_sequenced`. `None` → `''`/`NA` accordingly.
- Keep the extra `lab_name` column (the parser reads by header name, so it is
  harmless and informative).
- ISO dates pass through unchanged.

This is a one-time prep step performed with the `numbers-parser` Python package
in a throwaway venv; the resulting CSV is committed. If the source `.numbers`
updates, re-run the conversion. `linelist_data.csv` (the "Lab" version) is left
untouched.

## Loading — `src/main.js`

- Source map: `const LINELIST_SOURCES = { lab: { file: 'linelist_data.csv',
  label: 'Lab' }, hospital: { file: 'linelist_data.hospital.csv', label:
  'Hospital-admission' } }`. Default key: `lab`.
- New pure helper **`resolveLinelistSource(search, sources = LINELIST_SOURCES,
  fallback = 'lab')`** → `{ key, file, label }`:
  - reads the `linelist` param from a `URLSearchParams`-like input,
  - returns the matching source, or the fallback for an absent/unknown value.
  - Pure and exported → **unit-tested**.
- The line-list `fetch` uses `\`${BASE}data/${resolved.file}\``. Everything
  downstream (`parseLinelist`, `tallyZones`, the timeseries panel,
  `window.__PRIO_LINELIST__`, the prioritisation engine) is unchanged — only the
  fetched bytes differ.

## UI — header selector

- Add a small labelled `<select id="linelist-select">` to `#app-header` in
  `index.html`: label "Line list:" with options **Lab** / **Hospital-admission**.
- In `main.js`, preselect it to the resolved key and, on change, set
  `?linelist=<key>` on the URL and call `location.reload()` (full reload, as
  required). Switching back to the default key may drop the param (clean URL) or
  set `?linelist=lab` — either is acceptable; implementation sets the param
  explicitly for clarity.
- Styled to match the header's existing muted, compact controls.

## Edge cases

- Absent / unknown `?linelist=` value → default to `lab` (no error).
- `linelist_data.hospital.csv` missing at runtime → the fetch fails like any
  other data file; out of scope to special-case beyond the existing behaviour.
- The Hospital-admission version carries no `being_sequenced` marks (its sample
  IDs differ from the Lab to-sequence batch), so the in-process map metric,
  histogram track, and heatmap band are simply empty there until populated.

## Testing

- `resolveLinelistSource`: returns `lab` for absent param, `lab` for unknown
  value, and the correct source for `lab`/`hospital`. (Unit test.)
- Runtime: selecting "Hospital-admission" reloads with `?linelist=hospital`,
  fetches the hospital CSV, and renders (positives/dates present, statuses
  recognised); selecting "Lab" returns to the default.

## Out of scope

- Populating `being_sequenced` on the Hospital-admission version.
- Any change to the tree, risk, mobility, or time-domain data.
- A general N-version framework — two named sources is sufficient (YAGNI).
