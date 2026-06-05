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

/**
 * Greedy "highest-averages" prioritisation.
 * cells: [{ location, timeBin, risk, available, h, ids? }]
 * Returns { selection, cellSummary } (selection in rank order; cellSummary per cell).
 */
export function prioritise({ cells, n, delta = 0.5, lam = 14, binWidthDays = 7, origin, tNow, seed = 1 }) {
  const rng = mulberry32(seed);
  const C = cells.map((c) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    available0: c.available, available: c.available, h: c.h || 0, selected: 0,
    ids: c.ids ? [...c.ids] : null,
  }));
  for (const c of C) if (c.ids) shuffle(c.ids, rng);
  const decayC = C.map((c) => decay(c.timeBin, origin, binWidthDays, tNow, lam));

  const selection = [];
  for (let rank = 1; rank <= n; rank++) {
    const elig = [];
    for (let i = 0; i < C.length; i++) {
      if (C[i].available <= 0 || C[i].risk <= 0) continue;
      elig.push({ i, w: C[i].risk / (C[i].h + delta) * decayC[i] });
    }
    if (!elig.length) break;
    const wmax = elig.reduce((m, e) => (e.w > m ? e.w : m), -Infinity);
    const ties = elig.filter((e) => e.w >= wmax - 1e-9 * wmax).map((e) => e.i);
    const idx = ties.length > 1 ? ties[Math.floor(rng() * ties.length)] : ties[0];
    const c = C[idx];
    selection.push({
      rank, location: c.location, timeBin: c.timeBin,
      weight: c.risk / (c.h + delta) * decayC[idx],
      sampleId: c.ids ? c.ids.pop() : null,
    });
    c.available -= 1; c.h += 1; c.selected += 1;
  }

  const cellSummary = C.map((c, i) => ({
    location: c.location, timeBin: c.timeBin, risk: c.risk,
    decay: Math.round(decayC[i] * 1000) / 1000,
    available: c.available0, selected: c.selected, hFinal: c.h,
  })).sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : a.timeBin - b.timeBin));

  return { selection, cellSummary };
}
