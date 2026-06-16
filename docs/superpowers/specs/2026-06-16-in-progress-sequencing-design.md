# In-process-of-being-sequenced samples

**Date:** 2026-06-16
**Status:** Approved

## Problem

Some line-list samples are *in the process of being sequenced* — committed to a
sequencing run but not yet in the phylogeny. The dashboard currently knows only
two states: already-sequenced (phylogeny tips) and eligible candidates (positives
with Ct below the threshold). In-process samples must be:

1. **Accounted for in the prioritisation** — they should raise `h(k,t)` / `H_k`
   (so their cell is down-weighted and their zone counts as covered) and not be
   re-selected.
2. **Visualised on the outbreak map** — where these samples are (per zone).
3. **Visualised on the sample-distribution histogram** — when these samples are.
4. **Visualised on the prioritisation heatmap** — a third box per cell.

## Decisions (from brainstorming)

- **Data source:** a new boolean column in `linelist_data.csv`.
- **Engine:** treat exactly like already-sequenced history — remove from the
  candidate pool *and* add to `h(k,t)` / `H_k`.
- **Map:** a new choropleth metric (passive view, no prioritisation activation).
- **Histogram:** an always-on dot track.
- **Heatmap:** a third (small) box per cell, distinct from existing + allocation.

## Naming & colour (cosmetic)

- Column: **`being_sequenced`**, truthy values `TRUE` / `1` / `yes` (case-insensitive),
  blank/absent = not in process.
- UI term: **"In sequencing"**; map full label **"Being sequenced (in progress)"**,
  short label **`Seq~`**.
- Colour: **amber/gold** (e.g. `#c77d2e`), distinct from maroon (Sequences),
  teal (To sequence), and the risk greens. Used on the map ramp, histogram
  track/legend, and heatmap band.

## Architecture & data flow

`linelist_data.csv` → `parseLinelist` adds `being_sequenced` to each row → that
single flag feeds:

- the **map** (per-zone count via `tallyZones`),
- the **histogram** (per-date count derived from the rows),
- the **engine** (in-process rows routed into history through `buildCells`),
- the **heatmap** (per-cell count returned by `buildCells`).

Backward-compatible throughout: if the column is absent the flag is `false`
everywhere and every surface shows nothing.

## Components

### 1. Data — `src/main.js` `parseLinelist`
- Resolve a `being_sequenced` column by header name (like the others).
- Parse truthy with `/^(1|true|yes|y)$/i`; carry `being_sequenced: boolean` on
  each parsed row. Absent column → `false`.

### 2. Engine — `src/prioritise-data.js` `buildCells`
- New optional param **`inProgressRows = []`** (rows with `{health_zone, date}`).
- In-process rows contribute to `h(k,t)` (`hMap`) and `H_k` (`locHistory`)
  **exactly like `sequencedRows`**.
- They are *also* tallied into a separate returned map **`inProgressHistory`**
  (`Map<\`location|timeBin\`, count>`), while `cellHistory` stays phylogeny-only.
- Return value gains `inProgressHistory`. Signature stays backward-compatible
  (`inProgressRows` defaults to `[]`), so existing callers/tests are unaffected.

### 3. Engine wiring — `src/prioritise-panel.js` `runEngine`
- Public mode: `inProgressRows = (window.__PRIO_LINELIST__).filter(r => r.being_sequenced)`
  mapped to `{health_zone, date}`.
- `candidateRows` stays the full line list; `subtractHistory` stays `true`, so
  `available = count − h` removes in-process samples from selection (they are
  line-list rows in `count`, and now also in `h`). No double-counting.
- `sequencedRows` stays the phylogeny tips (`seqRows`).
- Pass `existing: cellHistory` (maroon) and `inProgress: inProgressHistory`
  (amber) to the heatmap; pass `inProgressRows` to `buildCells`.
- Upload mode is out of scope for this change (no `being_sequenced` semantics in
  the upload format); `inProgressRows` is `[]` there.

### 4. Map metric — `src/map-panel.js` + `src/zone-tally.js`
- `tallyZones`: add an `inProgress` field to each zone's count object,
  incremented when `r.being_sequenced`. Windowed automatically (the brush
  re-tallies), like `Positive`/`total`.
- `map-panel.js`: add `METRICS.inProgress = { label: 'Being sequenced (in progress)',
  ramp: <amber ramp>, kind: 'count', fmt: intFmt, value: (f) => <zone inProgress count> }`.
- Register in `SHORT` (`Seq~`), `FULL`, and the `ORDER` array.
- Passive view: selecting it does **not** toggle prioritisation (unlike
  `toSequence`); no knob/compute side effects.

### 5. Histogram track — `src/timeseries-panel.js`
- New colour constant `INPROG_COLOR` (amber).
- Derive `inProgMap` (date → count) from the line-list rows where
  `being_sequenced`, honouring the current zone selection + date window (same
  filter the bars use).
- Render a third dot track styled like the "Sequences"/"To sequence" tracks;
  add a legend entry ("In sequencing") and a tooltip row.
- Always shown when in-process samples fall in the view (no toggle).
- Add `in_progress` to the CSV export `EXPORT_COLS`.

### 6. Heatmap third box — `src/prio-heatmap.js`
- Accept an `inProgress` map (`zone|bin` → count) in `update(...)` opts.
- Cell layout top→bottom: maroon existing band → **amber in-process band
  (small/short, height ∝ in-process count, capped like the existing band)** →
  teal allocation box. Recompute the stacked-box heights to fit three.
- Add an amber tooltip row ("*n* in sequencing").

## Testing

Pure, unit-testable pieces (visual wiring mirrors verified patterns):

- `parseLinelist`: `being_sequenced` truthy for `TRUE/1/yes`, false when blank or
  column absent.
- `tallyZones`: `inProgress` counts only flagged rows and respects the window.
- `buildCells`: `inProgressRows` raise `h`/`H_k` and populate `inProgressHistory`
  separately from `cellHistory`; an in-process sample is absent from the
  resulting `prioritise` selection and its cell is down-weighted.
- Histogram date→count derivation honours zone selection + window.

## Out of scope

- Populating `being_sequenced` in the data pipeline (`scripts/`) — data side.
- The "Use your own line list" upload format (no `being_sequenced` there).
