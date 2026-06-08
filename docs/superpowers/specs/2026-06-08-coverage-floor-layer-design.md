# Coverage Floor Layer — Design Spec

**Date:** 2026-06-08
**Status:** Approved design (pre-implementation-plan)
**Builds on:** `2026-06-05-sequencing-prioritisation-design.md` (the proportional engine already shipped in the dashboard).
**Source spec:** `coverage_floor_layer.md` (the layer's algorithm + parameters).

---

## 1. Goal & scope

The shipped proportional layer (`prioritise()`) allocates the batch budget *N* per `(location, time-bin)` cell in proportion to risk. That is the desired *representation*, but it can leave an entire location with **zero** sequences if its risk is low relative to hotspots.

This feature adds a **coverage floor**: a priority pass that runs **before** the proportional loop and guarantees every *uncovered* location (never sequenced) at least `floor_size` samples before the proportional layer spends the rest of the budget. Low-risk locations may be *under-sampled*; they must not be *shut out*.

Everything stays **client-side** in `ituri-dashboard`, the same as the proportional layer. There is no backend and no second engine to keep in sync — the Python prototype in `ebola-drc-genomes/sampling_heuristic/` is historical.

In the UI, the feature is exposed in the **prioritisation page** via:
1. A new methodology subsection placed **immediately before** "Explore the allocation".
2. A **3-way mode selector** in "Explore the allocation" — *Proportional only* / *Coverage floor + proportional* / *Coverage floor only* — plus floor parameter knobs, both also present on the on-map knob strip.
3. The existing heatmap, coloured by **total** selected, with a floor-vs-proportional breakdown in the tooltip.

**Out of scope** (see §10): `staleness_window` (param wired, UI deferred), time-series risk, design-corrected estimation.

---

## 2. Background — how the floor fits the heuristic

The floor is a **pre-pass** that reuses the *exact same* per-cell weight as the proportional loop:

```
w(k, τ) = risk(k, τ) / (h(k, τ) + δ) · exp(−(t − τ) / λ)
```

It introduces **no new selection logic** — only a new ordering of *which cells get picked first*.

Definitions:

- `H_k` — cumulative sequenced count at location *k*, summed over **all** time-bins of the **pre-batch** sequencing history. (Not the per-cell `h`; the location-level total.)
- **Uncovered location** — `H_k == 0` **and** ≥1 available candidate sample this batch. (With `staleness_window` deferred, "covered" means *ever* sequenced.)
- For an uncovered location every cell has `h == 0`, so its weight reduces to `risk · decay` ordering — most-recent bin under flat risk.

Algorithm (per `coverage_floor_layer.md`):

```
floor_budget ← cap(floor_budget_cap, N)          # default: N (uncapped)
uncovered ← locations with H_k == 0 AND ≥1 available cell
rank uncovered by their single best available cell weight, descending
picks ← []
for loc in uncovered (ranked):
    if floor_budget == 0: break
    take min(floor_size, available_at(loc), floor_budget) from loc's top cells by weight
        (each pick increments that cell's h and the cell's selected count)
    append to picks; decrement floor_budget by the number taken
return picks                                       # prepend to the ranked list
```

Floor picks **prepend** the ranked selection and their `h`-updates are applied **before** the proportional loop runs, so the proportional layer sees their effect (a floored location's cells are now demoted). Locations not reached this batch carry over (they remain `H_k == 0` next batch).

---

## 3. Mode semantics

A single 3-way `mode` parameter, set by the selector:

| Mode | Behaviour |
|---|---|
| `'proportional'` | Today's behaviour. No floor pass; the greedy loop spends all of *N*. |
| `'both'` | Floor pre-pass consumes from *N* (capped by `floor_budget_cap`), then the proportional loop spends the remaining budget. The spec's intended operating mode. |
| `'floor'` | Floor pre-pass only. Guarantees `floor_size` per uncovered location (up to `floor_budget`); the proportional loop is skipped, so any leftover budget is **unused**. A pure "coverage view". |

There is deliberately **no "neither" state** — the selector always picks exactly one mode.

The shipped default remains `'proportional'` so existing behaviour is unchanged until the user opts in. (Confirm during implementation whether to flip the default to `'both'`.)

---

## 4. Components & changes

### 4.1 `src/prioritise.js` — engine (pure)

`prioritise()` gains four parameters with backward-compatible defaults:

| Param | Default | Meaning |
|---|---|---|
| `mode` | `'proportional'` | `'proportional' \| 'both' \| 'floor'` (see §3). Default preserves current behaviour. |
| `floorSize` | `1` | Samples guaranteed per uncovered location. Always capped at availability. |
| `floorBudgetCap` | `null` | Max share of *N* the floor may consume: fraction in `(0,1]`, an absolute int, or `null` (uncapped). |
| `stalenessWindow` | `null` | **Wired but UI-deferred.** `null` → covered = ever sequenced. (Future: a location counts as covered only if sequenced within this many days of `tNow`.) |

Input change: the engine needs **location-level pre-batch history** to compute `H_k`. The per-cell `h` already on `cells[]` is **not sufficient** (see §4.2 — cells with no current candidates are dropped). So `prioritise()` accepts a new input, `locHistory`, supplied by `buildCells` (§4.2).

New internal `coverageFloor(...)` step, run before the existing greedy loop when `mode !== 'proportional'`:
- Compute `floorBudget = resolveFloorBudget(floorBudgetCap, n)` — `null` → `n`; fraction in `(0,1]` → `ceil(frac · n)`; otherwise `floor(cap)` clamped to `[0, n]` (so non-integers floor and negatives become 0).
- `uncovered` = locations with `H_k == 0` (from `locHistory`) that have ≥1 cell with `available > 0 && risk > 0`.
- Rank `uncovered` by each location's **single best available cell weight** (`risk/(h+δ)·decay`, `h == 0` here), descending; random tie-break with the existing seeded RNG.
- For each uncovered location in order, while `floorBudget > 0`: pick from its top cells by weight, taking `min(floorSize, locAvailable, floorBudget)` total; for each pick decrement that cell's `available`, increment its `h`/`selected`, pop an `id` in upload mode, and append a `{ ...pick, layer: 'floor' }` to the selection; decrement `floorBudget`.
- Then the existing greedy loop runs for `n − floorPicks.length` (skipped entirely in `'floor'` mode), tagging its picks `layer: 'proportional'`.

Output changes:
- `selection[]` entries gain `layer: 'floor' | 'proportional'`.
- `cellSummary[]` entries gain `floorSelected` and `propSelected` (with `selected = floorSelected + propSelected`, unchanged in meaning for the heatmap colour).

**Properties preserved:** in-loop `h`-update, random within-cell draws, capping at availability, early stop on all-zero risk, determinism under a fixed seed. The floor pass uses the same RNG instance so the whole result stays reproducible.

### 4.2 `src/prioritise-data.js` — data prep (pure)

**Bug to fix as part of this work:** `buildCells` currently drops any cell with `available ≤ 0`, so a location sequenced in a past batch but with **no candidates this batch** never appears in `cells`. Computing `H_k` from the emitted `cells` would then wrongly mark such a location "uncovered". Likewise, a location with candidates in one bin but history only in another (currently-empty) bin would under-count its `H_k`.

Fix: `buildCells` returns an additional `locHistory` derived from the **full** `hMap` (built before the `available > 0` filter):
- v1: `locHistory: Map<location, totalH>` (sum of history over all that location's bins).
- Shaped so the deferred `stalenessWindow` can later filter by bin age — keep the per-bin history available (e.g. `Map<location, Array<{ timeBin, count }>>`), and derive the v1 total from it. (Implementer's choice; the engine only needs `H_k == 0` for v1.)

No change to eligibility, cell assignment, canon mapping, or the `available`/`h` computation.

### 4.3 `src/prio-knobs.js` — shared knob strip (page **and** map)

`buildKnobs` is the single strip used by both the prioritisation page (`prioritise-panel.js`) and the on-map Leaflet control (`map-panel.js`), both bound to the same `getParams`/`setParams`. Adding the floor controls here surfaces them in **both** places automatically.

Additions:
- **Mode selector** — a 3-way segmented/radio control (`'proportional' | 'both' | 'floor'`). Not a slider; rendered as its own row at the top of the floor group.
- **`floorSize`** — small integer slider (1…~5).
- **`floorBudgetCap`** — slider over `0…100%` of *N* with an "off/∞" end stop mapping to `null` (mirroring the existing λ ∞-stop pattern).
- The three floor controls are **disabled/greyed** when `mode === 'proportional'`.
- `stalenessWindow` is **not** rendered in v1 (param defaults to `null`).

`refresh()` must re-sync the new controls (including the mode selector) to the shared params, same as the existing sliders, so the page and map strips never show stale state after the other was used.

### 4.4 `src/prio-heatmap.js` — allocation matrix

- **No colour change.** Cells stay teal by total `selected` (`= floorSelected + propSelected`).
- **Tooltip** gains a breakdown when both layers contributed: `to sequence X (floor f + proportional p)`. When only one layer contributed, show just the total.

### 4.5 `src/prioritise-panel.js` — methodology + wiring

- **New methodology subsection** inserted in `METHODOLOGY_HTML`/the panel markup **immediately before** `<h4>Explore the allocation</h4>`: explains the coverage floor — its purpose (no location shut out), that it is a pre-pass reusing the same weight, the `floor_size` / `floor_budget_cap` knobs, and the three modes.
- **Reword the existing δ table.** The current "δ → 0 ⇒ every cell with an available sample gets ≥1" row sells δ as the coverage mechanism. With the floor layer owning coverage, reframe δ as a gentle smoother (≈0.5, near-proportional) and point coverage at the new section. (This mirrors the note in `coverage_floor_layer.md`: forcing δ→0 to manufacture coverage was the previous failure mode.)
- `DEFAULTS` gains `mode: 'proportional'`, `floorSize: 1`, `floorBudgetCap: null`, `stalenessWindow: null`.
- `params` are threaded unchanged through `runEngine()` into `prioritise()` (now also passing `locHistory` from `buildCells`).
- **Export CSVs** gain a `layer` column on the ranked list, and `floor_selected` / `prop_selected` columns on the per-cell counts.

---

## 5. Data contracts (changes only)

**Engine input** — `prioritise({ cells, locHistory, n, delta, lam, binWidthDays, origin, tNow, seed, mode, floorSize, floorBudgetCap, stalenessWindow })`.
- `locHistory`: `Map<location, totalH>` (v1) — pre-batch cumulative sequenced count per location.

**`selection[]`** — adds `layer: 'floor' | 'proportional'`.

**`cellSummary[]`** — adds `floorSelected`, `propSelected` (`selected` unchanged = their sum).

**Exports** —
- ranked list: `rank, sample_id, location, time_bin, date, weight, layer`.
- per-cell counts: `location, time_bin, risk, decay, available, selected, floor_selected, prop_selected, h_final`.

---

## 6. Parameters & defaults (new only)

| Knob | Default | Range / UI |
|---|---|---|
| `mode` | `'proportional'` | segmented control: Proportional only / Coverage floor + proportional / Coverage floor only |
| `floorSize` | `1` | int slider 1…~5 |
| `floorBudgetCap` | `null` | slider 0…100% of *N* with ∞/off end stop → `null` |
| `stalenessWindow` | `null` | **deferred** — wired, not in v1 UI |

Existing δ/λ/N/Ct/bin knobs and the fixed seed are unchanged.

---

## 7. Edge cases & validation

- `available_at(loc) < floor_size` → take all available; the location is then covered (`h > 0`).
- `uncovered × floor_size` exceeds `floor_budget` → fill in ranked order until exhausted; unreached locations carry to next batch.
- Location with `H_k == 0` but **no** available samples this batch → skip; consumes no budget, stays eligible next batch.
- `floor_budget_cap` smaller than needed → same carry-over behaviour.
- `'floor'` mode with `floorBudget` not exhausted → leftover budget intentionally unused; report actual selected count.
- A location with past history but zero candidates this batch → correctly counted as covered via `locHistory` (the §4.2 fix), never floored.
- Determinism: same inputs + same seed → identical floor + proportional ranking.
- Backward compatibility: `mode === 'proportional'` (the default) reproduces the current engine output exactly.

---

## 8. Testing (Vitest)

**`prioritise.js`:**
- Floor coverage: in `'both'`/`'floor'` mode, every uncovered location with availability gets ≥1 (up to `floorSize`) before the proportional loop runs.
- Pre-pass ordering: floor picks occupy the top of the ranked list; uncovered locations are floored in best-cell-weight order.
- `h` hand-off: a location floored in the pre-pass is demoted in the subsequent proportional loop (its cells' `h` reflect the floor picks).
- Caps: `floorSize` capped at availability; `floorBudgetCap` (fraction and int) bounds total floor picks; carry-over when budget is exhausted.
- `'floor'` mode leaves leftover budget unused.
- **Regression:** `mode: 'proportional'` is byte-for-byte identical to the pre-change engine on shared fixtures/seed.
- Determinism under a fixed seed across all modes.

**`prioritise-data.js`:**
- `locHistory` counts all pre-batch history, including locations/bins with no current candidates (the §4.2 fix) — the key regression test for the bug.

---

## 9. UX flow

1. Prioritisation page → read the new coverage-floor section (before "Explore the allocation").
2. In "Explore the allocation", choose a **mode**; if a floor mode is selected, adjust `floor_size` / `floor_budget_cap`. Floor knobs grey out in *Proportional only*.
3. The heatmap updates live (total colour; tooltip shows the floor/proportional split). The same controls are available on the on-map knob strip when prioritisation is active.
4. Exports reflect the current mode + floor params, with the new `layer` / `floor_selected` / `prop_selected` columns.

---

## 10. Out of scope / future

- **`staleness_window`** — param is wired (`null` default), but no UI and no age-filtering logic in v1. A later pass adds the slider + the "covered within window" filter over `locHistory`'s per-bin counts.
- **Distinguishing floor picks by colour** in the heatmap — deferred; v1 shows total colour + tooltip breakdown only.
- **Time-series risk surface** and **design-corrected estimation** — unchanged from the proportional spec; out of scope here.

---

## 11. Notes

- The floor layer is a strict superset of the current behaviour: with `mode: 'proportional'` nothing changes. This keeps the change low-risk and the regression test trivial to assert.
- `δ` can now sit at its near-proportional default (≈0.5) instead of being driven toward 0 to manufacture coverage — coverage is the floor's job. The methodology prose must reflect this so the page is internally consistent.
