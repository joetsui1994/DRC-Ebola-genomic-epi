# Sequencing Prioritisation in the Dashboard — Design Spec

**Date:** 2026-06-05
**Status:** Approved design (pre-implementation-plan)
**Source methodology:** `ebola-drc-genomes/sampling_heuristic/implementation_plan.md` and `prioritise.py` (the reference Python engine).

---

## 1. Goal & scope

Bring the sequencing-prioritisation heuristic into the dashboard as an interactive, **client-side** feature that:

1. **Communicates** the method (a written, plain-language page).
2. **Runs live** as the user adjusts parameters (δ, λ, N, eligibility-Ct, bin_width).
3. **Visualises** the resulting allocation across **space** (map) and **time** (Sample-distribution chart).
4. Supports two data sources:
   - **Public mode** — the dashboard's de-identified line-list → per-cell **counts** only (no sample list, since the data is non-identifiable).
   - **Upload mode** — the user drops their own line-list (with real `sample_id`s) which is parsed **locally in the browser and never uploaded**; produces the real ranked top-N list to download, plus the same map/chart.

Everything runs in the browser (the dashboard is a static GitHub-Pages site; there is no backend). No sample-identifiable data is ever committed or transmitted.

**Out of scope** (see §11).

---

## 2. Background — the heuristic

Each "batch", rank the pool of unsequenced *sequenceable* samples and take the top-N, so cumulative sequencing tracks **relative risk** across **(location × time-bin)** cells, favouring **recent** and **under-sequenced** cells.

Per-cell weight at batch time *t*:

```
w(k, τ) = risk(k, τ) / (h(k, τ) + δ) · exp(−(t − τ) / λ)
```

- `risk(k, τ)` — relative risk of cell *(zone k, time-bin τ)*. Currently a **location-only snapshot** stretched flat across time (the geojson's `relative_risk`).
- `h(k, τ)` — number already sequenced from that cell (grows during the loop).
- `δ` (delta) — coverage vs strict proportionality (→0 spreads to thin cells; ~0.5 near-proportional; →1 concentrates on hotspots).
- `λ` (lambda) — recency timescale in **days** (∞ = flat in time; small = strong recency tilt).

**Algorithm** (greedy "highest-averages", *not* score-and-sort): for N iterations — compute `w` for every cell with samples left and `risk>0`; pick the max (random tie-break); draw one random sample from that cell; increment that cell's `h`. The pick **order** is the ranking. The in-loop `h`-update is what keeps the allocation proportional rather than piling onto the hottest cell. Early-stop when no cell has remaining risk-bearing samples.

**Outputs:** `selection` (ranked picks) and `cell_summary` (per cell: `risk, decay, available, selected, h_final`).

---

## 3. Architecture & data flow

```
 line-list (public)  ─┐                          ┌─▶ map "To sequence" choropleth (per-zone selected)
 OR uploaded CSV ─────┤                          │
 geojson relative_risk┤─▶ data-prep ─▶ prioritise ┼─▶ chart time-bin allocation overlay
 tree tips (history h)┘     (cells)    (greedy)   │
                                                  └─▶ (upload only) ranked top-N list → download
```

All pieces are pure, client-side modules. The Prioritisation tab owns the parameters + upload + on/off; when **active**, the Map tab and the chart render the result and re-run on any knob change.

---

## 4. Components

### 4.1 `src/prioritise.js` — the engine (pure)
Direct port of `prioritise.py`:
- `assignCell(date, origin, binWidthDays) -> int` — floor of day-offset / bin width.
- `decay(binIndex, origin, binWidthDays, tNow, lam) -> number` — `exp(-ageDays/λ)` at the bin midpoint; `1` when `λ` is null/∞.
- `prioritise({ cells, n, delta, lam, binWidthDays, tNow, origin, seed }) -> { selection, cellSummary }`
  - `cells`: array of `{ location, timeBin, risk, available, h, ids? }` (ids present in upload mode).
  - Greedy loop exactly as the Python: `w = risk/(h+δ)·decay`, filtered to `available>0 && risk>0`; pick max with `>= wmax - 1e-9·wmax` tie set, random tie-break; decrement `available` (pop an id in upload mode); `h++`. Stop early when the candidate set is empty.
  - Returns `selection` (rank-ordered: `{ rank, location, timeBin, weight, sampleId? }`) and `cellSummary` (`{ location, timeBin, risk, decay, available, selected, hFinal }`).
- **Seeded RNG**: mulberry32 (small, deterministic) for shuffles + tie-breaks. Fixed default seed so results are stable across knob changes (only the parameters move them).

Properties to preserve (per the methodology): in-loop `h`-update, random within-cell draws, capping at availability, early-stop on all-zero risk.

### 4.2 `src/prioritise-data.js` — data prep (pure)
Builds `cells[]` from a line-list, risk, and history:
- **Eligibility**: `status === 'Positive' && ct` numeric `&& ct < ctThreshold`, with a valid date and a zone that canonicalises (via the existing alias `canon`) to a `Nom` present in the risk set. Ineligible/invalid rows are dropped and counted (diagnostics).
- **Cells**: group eligible rows by `(canonZone, assignCell(date))`. Per cell: `risk` (from the geojson `relative_risk` for that zone), `available = eligibleCount − sequencedCount`, `h = sequencedCount`, and in upload mode an `ids` pool (shuffled).
- **History (`h`)**: counts per cell of the already-sequenced set —
  - Public mode: the **tree tips** (`{date, health_zone}` → cell).
  - Upload mode: **zero**, unless the uploaded CSV has a `sequenced` column (truthy = already sequenced → contributes to `h`, excluded from `available`).
- `origin` = earliest date across candidates+history; `tNow` = latest. (Matches the Python defaults; consistent bins across modes.)

### 4.3 Map panel tabs + Prioritisation page
- The map panel (`#map`) gets a small **tab strip**: **Map** | **Prioritisation**. Switching swaps the panel body between the Leaflet map and a scrollable Prioritisation page (the map instance is preserved/`invalidateSize`d on return).
- **Prioritisation page** contains:
  - **Methodology explainer** — plain-language write-up of the weight formula, each knob's effect, the greedy loop, the public-vs-upload distinction, and the data sources used.
  - **Upload** — a drop zone / file input; read with the File API, parsed in-browser. Shows parse diagnostics (rows kept/dropped, unknown zones). Clearly states "stays on your device".
  - **Activate** switch (+ "Run with public data" as the default source when no file is loaded). Also surfaces the diagnostics and, in upload mode, the **Download ranked list** button.

### 4.4 Map "To sequence" metric
- A new entry in the existing choropleth metric button group, **present only while prioritisation is active** (and ideally auto-selected on activation): per-zone **selected count** (summed over time-bins) from `cellSummary`. Its own sequential ramp + legend ("To sequence", `0 (none)` + class breaks), reusing the metric machinery (`recomputeBreaks`, `renderLegend`). Recomputes whenever a knob changes.

### 4.5 Chart time-bin allocation overlay
- On the Sample-distribution panel, a **second track / overlay** (sibling to the sequence track) showing the **to-sequence count per time-bin** under the current knobs — so the budget's split across time is visible alongside the spatial split.
- Selection-aware like the rest: shows the selected zone's per-bin allocation when a zone is selected, the global allocation otherwise. (Allocation itself is computed globally over the full pool; the overlay slices it.)

### 4.6 Wiring / reactivity
- A small **prioritisation controller** (in `main.js`/a new module) holds the state `{ active, source: 'public'|'upload', uploadedRows, delta, lam, n, ctThreshold, binWidthDays }`, owns the recompute, and pushes results to the map metric + chart overlay.
- Recompute is debounced on knob input (cheap — a few ms — so effectively live). On deactivate, it tears down the metric + overlay and the map reverts.

---

## 5. Data contracts

**Risk** — from the committed geojson: `{ canonNom: relative_risk }`. Snapshot, flat across time (drop-in for a future `[zone, time_bin, risk]` table; no engine change needed).

**Candidates (public)** — eligible positive rows of `linelist_data.csv` (`health_zone, status, date, ct`). No IDs → counts only.

**Upload CSV (local)** — header (case-insensitive), minimally:
| Column | Required | Notes |
|---|---|---|
| `sample_id` | yes | Real lab ID (stays in-browser) |
| `health_zone` | yes | Canonicalised to a geojson `Nom` |
| `status` | yes | Eligibility = `Positive` |
| `ct` | yes | Numeric; eligibility = `ct < ctThreshold` |
| `date` | yes | Collection/fallback date (ISO or DD/MM/YYYY) |
| `health_area` | no | Carried through if present |
| `sequenced` | no | Truthy = already sequenced → `h`, not `available` |

**History (`h`)** — per-cell counts (tips in public; `sequenced` rows or zero in upload).

**Outputs** —
- `cellSummary` (both modes): `zone, timeBin, risk, decay, available, selected, hFinal` → map + chart + a downloadable **per-cell counts** CSV.
- `selection` (upload only): `rank, sample_id, zone, timeBin, weight` → downloadable ranked top-N list.

---

## 6. Two modes (summary)

| | Public | Upload (local) |
|---|---|---|
| Candidate source | de-identified `linelist_data.csv` | user CSV (File API, never sent) |
| Sample IDs | none → counts only | real → ranked list |
| History `h` | tree tips per cell | `sequenced` column, else 0 |
| Map + chart | yes | yes |
| Downloads | per-cell counts CSV | counts CSV **+** ranked top-N list |

---

## 7. Parameters & defaults

| Knob | Default | Range/notes |
|---|---|---|
| `delta` (δ) | 0.5 | ~0 … ~1 (slider) |
| `lam` (λ) | 14 | days; includes an ∞/"off" end (slider/input) |
| `n` (budget N) | 30 | positive integer (input) |
| `ctThreshold` | 31 | eligibility, strict `<` (input). Independent of the existing viz Ct filter |
| `binWidthDays` | 7 | days (input) |

Seed fixed (default `1`) for reproducibility.

---

## 8. UX flow (activation)

1. Open the **Prioritisation** tab → read the methodology; optionally upload a file (diagnostics shown).
2. Flip **Activate** → switch back to the **Map** tab: knobs panel appears on the map, "To sequence" metric is selected, chart overlay shows.
3. Move any knob → map + chart + (upload) downloadable list update live.
4. **Deactivate** on the Prioritisation tab → knobs/metric/overlay removed; map back to normal.

---

## 9. Edge cases & validation

- `N` larger than the eligible pool → loop stops early; report the actual selected count (< N).
- All-zero risk in scope → early stop (nothing selected).
- A zone absent from the risk surface → risk 0 → never selected; counted in diagnostics.
- Empty candidate pool (no eligible positives) → empty result + a clear "no eligible samples" state.
- Upload parse errors (missing columns, unparseable dates, unknown zones) → per-row drop with counts surfaced on the page; never throw the app.
- Determinism: same inputs + same seed → identical ranking.

---

## 10. Testing

- **`prioritise.js`** (Vitest, mirrors methodology §7): proportionality (λ=∞, flat `h`, large N → per-zone counts track risk ratios); recency (finite λ → recent bins favoured); coverage (small δ → every nonzero-risk cell with availability gets ≥1 before any doubles); availability cap; history carryover (a heavily-sequenced cell is demoted); determinism; edge cases (N > pool, all-zero risk, zone-not-in-risk). Include 1–2 **golden tests** matching a `prioritise.py` run on the same fixed inputs/seed.
- **`prioritise-data.js`**: eligibility filter, cell assignment, canon mapping, `available = eligible − sequenced`, upload parsing (incl. `sequenced` column + bad rows).

---

## 11. Out of scope / future

- **Design-corrected estimation** (post-stratification; methodology §8) — downstream, not in the dashboard.
- **LIMS / operational batch persistence** — the dashboard is exploratory; the real lab hand-off runs in the offline pipeline.
- **Time-series risk surface** — use the snapshot; the lookup is already shaped to accept `[zone, time_bin, risk]` later with no engine change.
- **Reserved "exploration" share** for proxy-empty cells (methodology open question) — deferred.

---

## 12. Notes

- Zone names are reconciled through the dashboard's existing `aliases.csv` / `canon` so candidates, tips, and the risk surface share canonical `Nom`s (the reference Python uses its own `Nyankunde`/`Gety` snapshot keys; the dashboard standard is `Nyakunde`/`Gethy` — the engine is name-agnostic, the dashboard supplies canonical keys).
- The Ct eligibility here is conceptually the same "lower Ct = better template, strictly below" rule used by the existing Ct filter, but is a **separate** control (different default/semantic), to avoid coupling the prioritisation pool to the visualisation filter.
