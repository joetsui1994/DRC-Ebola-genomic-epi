# Temporal Preference: Signed-Tilt Extension — Design

**Date:** 2026-06-09
**Status:** Approved for implementation
**Source idea:** `temporal_tilt_extension.md`

## Summary

Generalise the recency decay in the cell priority weight so it can prefer **recent**
*or* **earlier** samples, controlled by a single signed parameter `tilt` (β). Earliness
is wanted when the objective favours old samples (e.g. refining TMRCA / molecular-clock
estimates). `tilt` **fully replaces** the old recency timescale `lam` (λ).

## Behaviour

The cell weight currently multiplies risk/coverage by a recency decay:

```
w(k, τ) = [ risk(k, τ) / (h + δ) ] · exp(−(t − τ) / λ)
```

Replace the decay factor with a signed temporal tilt:

```
u(τ) = (τ − τ_min) / (τ_max − τ_min)     # normalise time to [0,1]; 0 = earliest, 1 = most recent
g(τ) = exp(β · u(τ))                       # new temporal factor
w(k, τ) = [ risk(k, τ) / (h + δ) ] · g(τ)
```

- `β > 0` → prefer recent; `β < 0` → prefer early; `β = 0` → flat (no temporal preference).
- Magnitude is the strength: `g(recent) / g(early) = exp(β)` (β=2 ≈ 7×, β=4 ≈ 55×).
- `τ_min`, `τ_max` reuse the binner's reference window — `origin` and `tNow` from
  `buildCells` (earliest / latest collection time across the candidate + sequenced pool).

### Equivalence to old behaviour
The old `exp(−(t−τ)/λ)` corresponds to a positive tilt of roughly `β ≈ (window days) / λ`
(e.g. λ=14 over a 56-day window ≈ β=4). Today's default `λ = ∞` (flat) maps to `β = 0`.

## Scope (agreed)

Full replacement of `lam` with `tilt` in the **engine, knob, defaults, CSV export, and
tests**. Methodology write-up is edited **only where λ appears** (kept minimal); the rest
of the prose is left as-is.

## Design (Approach A — clean swap at the existing seam)

The selection loop and coverage-floor pass are **unchanged**; only the per-cell temporal
factor and the `lam`→`tilt` rename move.

### 1. Engine math — `src/prioritise.js`

Replace `decay()` with a parallel pure function:

```js
/** Signed temporal tilt g(τ) = exp(β·u) at the bin midpoint, u∈[0,1] over [origin, tNow].
 *  β>0 favours recent, β<0 favours early, β=0 → 1 (flat). Degenerate window → 1. */
export function temporalTilt(binIndex, origin, binWidthDays, tNow, tilt) {
  if (!tilt) return 1;                          // β = 0 / null → flat
  const tMin = +new Date(origin), tMax = +new Date(tNow);
  if (!(tMax > tMin)) return 1;                 // single-bin / degenerate window → flat
  const cellMid = tMin + (binIndex + 0.5) * binWidthDays * MS_PER_DAY;
  const u = Math.min(1, Math.max(0, (cellMid - tMin) / (tMax - tMin)));
  return Math.exp(tilt * u);
}
```

- `decayC[]` becomes `tiltC[]`, built at the same line:
  `const tiltC = C.map((c) => temporalTilt(c.timeBin, origin, binWidthDays, tNow, tilt));`
- `wOf = (i) => C[i].risk / (C[i].h + delta) * tiltC[i];`
- Coverage-floor tie-break: `key = Math.max(...idxs.map((i) => C[i].risk * tiltC[i]));`
  → with β<0 a floor sample is drawn from the early end automatically; no special handling.
- `prioritise({ … lam = 14 … })` signature param → `tilt = 0`.

**Numerical stability:** the source idea's `subtract β·max(u)` trick is **omitted**. With β
capped at ±20 and u∈[0,1], the exponent stays in [−20, 20] and `exp` in ~[2e-9, 5e8] — no
overflow risk — so the per-cell function stays clean and independently testable.

### 2. Parameter plumbing & defaults

- `src/prioritise-panel.js` `DEFAULTS`: drop `lam: Infinity`, add `tilt: 0`.
- Panel's `prioritise(...)` call: `lam: params.lam` → `tilt: params.tilt`.

### 3. Knob — `src/prio-knobs.js`

- β is a plain signed-linear slider, built with the generic `row()` helper:
  `min = -20, max = 20, step = 0.5, value = 0`. No custom slider mapping.
- Delete `lamFromSlider` / `lamToSlider` / `lamLabel` and the `'lam'` special-cases in the
  `input` handler and `refresh()`. The slider value *is* β.
- Label `λ (d)` → `tilt`; readout shows the signed value (e.g. `1.25`, `-2`, `0`). Keeps the
  same position in the row order (between δ and N).

### 4. CSV + `cellSummary`

- `cellSummary.decay` (rounded `decayC`) → `cellSummary.tilt` (rounded `tiltC`).
- Per-cell counts CSV: header column `decay` → `tilt`; row mapping `c.decay` → `c.tilt`.

### 5. Methodology text — minimal, only where λ appears (`src/prioritise-panel.js`)

- Weight formula (`prio-formula`): decay factor `exp(−(t−τ)/λ)` → `g(τ) = exp(β·u(τ))`.
- Symbol table: the `λ` row → `tilt (β)` — signed temporal preference (β>0 recent, β<0
  early, β=0 flat).
- The decay bullet and the "λ is a recency timescale (days)" clause → reworded for signed
  tilt.
- Pseudo-code line `· exp(−(t − τ)/λ)` → `· exp(β·u(k,τ))`.
- Nothing else in the prose is touched.

### 6. Tests — `src/prioritise.test.js`, `src/prioritise-data.test.js`

- `decay` describe block → `temporalTilt`: β=0 → 1; degenerate window (`tMax==tMin`) → 1;
  monotone increasing in u for β>0 (recent bin > early bin); **reversed** for β<0; a known
  `exp(β·u)` value check at a chosen bin.
- Integration recency test (currently `lam:14`) → with β>0 the recent bin gets more of an
  equal-risk budget; add a β<0 assertion that the early bin is favoured.
- Replace all `lam: Infinity` / `lam: 14` fixtures with `tilt`, and update the import
  `decay` → `temporalTilt`.

## Out of scope / non-goals

- No change to risk, coverage (`h`, δ), Ct eligibility, binning, or the floor budget logic.
- No backward-compatibility shim for `lam` — it is removed, not deprecated.
- No re-introduction of the stability term (YAGNI).

## Extension (2026-06-09): per-pass temporal tilt — β_r / β_s

A single tilt conflated two different temporal objectives: the risk-based (proportional)
pass wants temporal *representativeness* (often β = 0, or mild recency for nowcasting),
whereas the coverage-floor pass often wants the *earliest* sample of a newly-covered
location (to capture introductions / refine TMRCA). Split the single `tilt` into two
independent parameters, both default 0 (preserving prior behaviour):

- **`tilt` (β_r)** — risk-based / proportional pass. `wOf = risk/(h+δ)·exp(β_r·u)`.
- **`floorTilt` (β_s)** — coverage-floor pass. `wFloorOf = risk/(h+δ)·exp(β_s·u)`, used for
  the within-location cell pick and the recorded floor `weight`.

Floor **location ordering** (which uncovered location to cover first under a tight budget)
is by **risk only** (`max(risk)` over the location's cells) — importance, not timing — so
β_s governs only *which time-bin within a location* is drawn. At β_s = 0 this is identical
to the previous default.

- `DEFAULTS.floorTilt = 0`; engine arg `floorTilt = 0`; panel passes it.
- Knob: risk-based row relabelled `β_r`; new `β_s` row grouped with the floor controls and
  disabled in "risk-based only" mode (added to `syncFloorEnabled`); both range ±20, step 0.5.
- Methodology: formula/symbol/pseudo-code use `β_r`; the coverage-floor section documents
  `β_s` and the risk-only ordering.
- Tests: floor draws the earliest cell at β_s < 0, the most recent at β_s > 0, and follows
  β_s independently of β_r.
