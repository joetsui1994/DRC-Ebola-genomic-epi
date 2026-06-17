# Fuller "Use your own line list" upload UX

**Date:** 2026-06-17
**Status:** Approved

## Problem

The line-list upload (under Sequencing prioritisation) is now enabled with
up-front QA and drop-reason counts, but the interaction is bare: there's no way
to undo an upload without reloading, no template to format against, only count-
level feedback, and the file picker is the only entry point. This adds four
improvements on top of the launched feature.

## Decisions (from brainstorming)

Build all four: clear/reset, downloadable template, richer file report, and
drag-and-drop. Builds on `feature/launch-linelist-upload` (ships together).

## Components

### 1. Clear / reset to public
- A small **"✕ clear"** button in the upload row, shown only while an upload is
  active (`uploadRows` non-null).
- Click → `uploadRows = null`, reset the file input value, clear the message,
  `recompute()`. Returns to the public data with no page reload.

### 2. Downloadable template
- A **"⤓ template"** link beside the file picker.
- Downloads `linelist_template.csv` via the existing `download()` helper: the
  full header (`sample_id, health_zone, status, ct, date, health_area,
  sequenced, being_sequenced, row_id`) plus two example rows — one plain
  candidate positive, one with `sequenced=1`.
- The template string is a module constant.

### 3. Richer file report
- New **pure** helper in `prioritise-data.js`:
  `summarizeUpload(rows, risk, canon)` → `{ total, byStatus, undated, noCt,
  unknownZones }`.
  - `byStatus`: count per status value (as parsed/normalised).
  - `undated`: rows with no parseable `date`.
  - `noCt`: rows whose `ct` is not a finite number.
  - `unknownZones`: distinct `health_zone` values (original casing) whose
    `up(canon(zone))` is not in `risk` — i.e. would be dropped. Determined with
    the same rule `buildCells` uses, so the report matches engine behaviour.
- On a successful load the info message renders a short report, e.g.
  *"Loaded 312 rows — 188 Positive, 96 Negative, 28 Unclassified · 14 undated ·
  9 no Ct · 2 unknown zones: Nowhere, Foo (dropped)"*. The unknown-zone list is
  capped at ~8 with a "+N more" suffix.
- The hard-error path (missing required columns, via `validateUpload`) is
  unchanged. The engine's eligible/dropped readout stays in `#prio-diag`.

### 4. Drag-and-drop
- Make the `.prio-up` area a drop zone: `dragenter`/`dragover` add a highlight
  class (and `preventDefault` so the browser doesn't navigate to the file);
  `dragleave`/`drop` remove it; `drop` reads the first file.
- Refactor the current file-`change` handler into a shared `handleFile(file)`
  so the picker and the drop use identical parse → validate → report → apply
  logic.

## Edge cases

- Drop of a non-file / multiple files → use the first file; if none, ignore.
- Clear while no upload active → button isn't shown, so no-op.
- `summarizeUpload` on empty rows → zeros and empty `unknownZones`.
- Rejected file (failed `validateUpload`) → no report; the existing red error
  shows and the app stays on public data.

## Testing

- `summarizeUpload`: status tallies, undated/no-Ct counts, unknown-zone
  collection (respecting `canon` + `risk`), de-duplication, empty input.
- Runtime (jsdom drive): clear returns to public mode; template download fires
  with the expected header; drop applies a file via the same path as the picker;
  the report renders with unknown zones listed.

## Out of scope

- The export exclusion list (explicitly dropped).
- Persisting an upload across reloads (parsed in-browser, intentionally
  ephemeral).
- Per-row inline error annotations / a full preview table.
