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
