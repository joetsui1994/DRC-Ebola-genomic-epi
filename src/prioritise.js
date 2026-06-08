// src/prioritise.js
// Pure port of the reference prioritise.py engine (sampling_heuristic). No DOM.

const MS_PER_DAY = 86400000;

/** Small deterministic PRNG → function returning floats in [0,1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map a date to an integer time-bin index relative to `origin`. */
export function assignCell(date, origin, binWidthDays) {
  const days = (+new Date(date) - +new Date(origin)) / MS_PER_DAY;
  return Math.floor(days / binWidthDays);
}

/** exp(-age/lam) at the bin midpoint; 1 when lam is null/∞; age floored at 0. */
export function decay(binIndex, origin, binWidthDays, tNow, lam) {
  if (lam == null || !isFinite(lam)) return 1;
  const cellMid = +new Date(origin) + (binIndex + 0.5) * binWidthDays * MS_PER_DAY;
  const ageDays = Math.max((+new Date(tNow) - cellMid) / MS_PER_DAY, 0);
  return Math.exp(-ageDays / lam);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** Resolve the floor budget: null → n; fraction in (0,1] → ceil(frac·n); else floor(cap) (≥0), capped at n. */
export function resolveFloorBudget(cap, n) {
  if (cap == null) return n;
  if (cap > 0 && cap <= 1) return Math.ceil(cap * n);
  return Math.max(0, Math.min(n, Math.floor(cap)));
}

/**
 * Pick the highest-weight index from `eligIdx` (random tie-break via `rng`).
 * Infinity-safe: a relative tolerance is NaN at w=∞, so match on exact equality there.
 * Returns the chosen index, or null when `eligIdx` is empty.
 */
function pickBest(eligIdx, wOf, rng) {
  if (!eligIdx.length) return null;
  let wmax = -Infinity;
  for (const i of eligIdx) { const w = wOf(i); if (w > wmax) wmax = w; }
  const ties = isFinite(wmax)
    ? eligIdx.filter((i) => wOf(i) >= wmax - 1e-9 * wmax)
    : eligIdx.filter((i) => wOf(i) === wmax);
  return ties.length > 1 ? ties[Math.floor(rng() * ties.length)] : ties[0];
}

/**
 * Coverage-floor pre-pass. Mutates the working cells `C` and pushes floor picks onto
 * `selection`. Uncovered = location with H_k == 0 (from `locHistory`) and ≥1 eligible cell.
 * Locations are floored in best-cell-weight order; within a location, top cells by weight.
 */
function coverageFloor({ C, decayC, wOf, rng, locHistory, floorSize, floorBudget, selection }) {
  const byLoc = new Map();
  for (let i = 0; i < C.length; i++) {
    if (C[i].available <= 0 || C[i].risk <= 0) continue;
    if (!byLoc.has(C[i].location)) byLoc.set(C[i].location, []);
    byLoc.get(C[i].location).push(i);
  }

  const uncovered = [];
  for (const [loc, idxs] of byLoc) {
    if (((locHistory && locHistory.get(loc)) || 0) !== 0) continue;
    // At floor time every cell of an uncovered location has h==0, so weight ordering
    // ≡ risk·decay ordering (and stays finite even when delta==0).
    const key = Math.max(...idxs.map((i) => C[i].risk * decayC[i]));
    uncovered.push({ idxs, key, r: rng() });
  }
  uncovered.sort((a, b) => (b.key - a.key) || (a.r - b.r));

  let budget = floorBudget;
  for (const u of uncovered) {
    if (budget <= 0) break;
    let take = Math.min(floorSize, budget);
    while (take > 0) {
      const elig = u.idxs.filter((i) => C[i].available > 0 && C[i].risk > 0);
      const idx = pickBest(elig, wOf, rng);
      if (idx == null) break;
      const c = C[idx];
      selection.push({
        rank: selection.length + 1, location: c.location, timeBin: c.timeBin,
        weight: wOf(idx), sampleId: c.ids ? c.ids.pop() : null, layer: 'floor',
      });
      c.available -= 1; c.h += 1; c.selected += 1; c.floorSelected += 1;
      take -= 1; budget -= 1;
    }
  }
}

/**
 * Greedy "highest-averages" prioritisation.
 * cells: [{ location, timeBin, risk, available, h, ids? }]
 * Returns { selection, cellSummary } (selection in rank order; cellSummary per cell).
 */
export function prioritise({
  cells, locHistory = null, n, delta = 0.5, lam = 14, binWidthDays = 7, origin, tNow, seed = 1,
  mode = 'proportional', floorSize = 1, floorBudgetCap = null,
  stalenessWindow = null, // reserved for a future "covered within window" rule; unused in v1 (covered = ever sequenced)
}) {
  void stalenessWindow;   // intentionally unused in v1
  const rng = mulberry32(seed);
  const C = cells.map((c) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    available0: c.available, available: c.available, h: c.h || 0, h0: c.h || 0,
    selected: 0, floorSelected: 0, propSelected: 0,
    ids: c.ids ? [...c.ids] : null,
  }));
  for (const c of C) if (c.ids) shuffle(c.ids, rng);
  const decayC = C.map((c) => decay(c.timeBin, origin, binWidthDays, tNow, lam));
  const wOf = (i) => C[i].risk / (C[i].h + delta) * decayC[i];

  const selection = [];

  if (mode === 'floor' || mode === 'both') {
    coverageFloor({
      C, decayC, wOf, rng, locHistory, floorSize,
      floorBudget: resolveFloorBudget(floorBudgetCap, n), selection,
    });
  }

  if (mode !== 'floor') {
    for (let rank = selection.length + 1; rank <= n; rank++) {
      const elig = [];
      for (let i = 0; i < C.length; i++) {
        if (C[i].available <= 0 || C[i].risk <= 0) continue;
        elig.push(i);
      }
      const idx = pickBest(elig, wOf, rng);
      if (idx == null) break;
      const c = C[idx];
      selection.push({
        rank, location: c.location, timeBin: c.timeBin,
        weight: wOf(idx), sampleId: c.ids ? c.ids.pop() : null, layer: 'proportional',
      });
      c.available -= 1; c.h += 1; c.selected += 1; c.propSelected += 1;
    }
  }

  const cellSummary = C.map((c, i) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    decay: Math.round(decayC[i] * 1000) / 1000,
    available: c.available0, selected: c.selected,
    floorSelected: c.floorSelected, propSelected: c.propSelected, hFinal: c.h,
    h0: c.h0, Hk: (locHistory && locHistory.get(c.location)) || 0,
  })).sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : a.timeBin - b.timeBin));

  return { selection, cellSummary };
}
