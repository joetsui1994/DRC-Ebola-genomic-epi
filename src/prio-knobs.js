// src/prio-knobs.js
// Shared δ/tilt/N/Ct/bin + coverage-floor knob strip, used both on the map (inside a Leaflet
// control) and on the prioritisation page. tilt (β) is a plain signed-linear slider; floorBudgetCap
// has an ∞ end stop; the mode is a <select>. Recompute is throttled; numeric readouts update instantly.

// floorBudgetCap: slider 0..100. 100 = uncapped (null); 1..99 = fraction of N; 0 = 0%.
const capFromSlider = (p) => p >= 100 ? null : p / 100;
const capToSlider = (cap) => cap == null ? 100 : Math.round(cap * 100);
const capLabel = (cap) => cap == null ? '∞' : `${Math.round(cap * 100)}%`;

const MODES = [['proportional', '1. risk-based only'], ['both', '2. risk-based + spatial coverage'], ['floor', '3. spatial coverage']];

function row(label, k, val, min, max, step, disp) {
  return `<div class="pk-row" data-row="${k}"><span class="pk-l">${label}</span>`
    + `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">`
    + `<span class="pk-v" data-v="${k}">${disp != null ? disp : val}</span></div>`;
}
function modeRow(val) {
  const opts = MODES.map(([v, l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('');
  return `<div class="pk-row" data-row="mode"><span class="pk-l">mode</span>`
    + `<select class="pk-mode" data-k="mode">${opts}</select></div>`;
}

/**
 * Build the knob rows into `root`, reading initial values from getParams(); each change fires
 * a throttled onChange({ [key]: value }).
 */
export function buildKnobs(root, { getParams, onChange, getMaxN, throttleMs = 150 }) {
  const P = getParams();
  const nMax = Math.max(1, Math.round((getMaxN && getMaxN()) || 200));
  root.innerHTML =
    modeRow(P.mode || 'proportional') +
    row('δ', 'delta', P.delta, 0.01, 1, 0.01) +
    row('β<sub>r</sub>', 'tilt', P.tilt ?? 0, -20, 20, 0.5) +
    row('N', 'n', P.n, 1, nMax, 1) + row('Ct<', 'ctThreshold', P.ctThreshold, 1, 45, 1) +
    row('bin (d)', 'binWidthDays', P.binWidthDays, 1, 30, 1) +
    row('floor', 'floorSize', P.floorSize ?? 1, 1, 5, 1) +
    row('cap', 'floorBudgetCap', capToSlider(P.floorBudgetCap), 0, 100, 1, capLabel(P.floorBudgetCap)) +
    row('β<sub>s</sub>', 'floorTilt', P.floorTilt ?? 0, -20, 20, 0.5);

  let pending = null, timer = null, lastRun = 0;
  const applyNow = () => { timer = null; lastRun = Date.now(); const p = pending; pending = null; if (p) onChange(p); };
  const queue = (k, v) => {
    pending = { ...(pending || {}), [k]: v };
    const wait = throttleMs - (Date.now() - lastRun);
    if (wait <= 0) applyNow();
    else if (!timer) timer = setTimeout(applyNow, wait);
  };

  // Grey + disable the floor controls when the mode is proportional-only.
  function syncFloorEnabled(mode) {
    const off = mode === 'proportional';
    ['floorSize', 'floorBudgetCap', 'floorTilt'].forEach((k) => {
      const r = root.querySelector(`[data-row="${k}"]`);
      if (!r) return;
      r.classList.toggle('pk-disabled', off);
      r.querySelector('input').disabled = off;
    });
  }
  syncFloorEnabled(P.mode || 'proportional');

  root.querySelectorAll('input[type="range"]').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.k;
    const v = k === 'floorBudgetCap' ? capFromSlider(parseFloat(inp.value)) : parseFloat(inp.value);
    const disp = k === 'floorBudgetCap' ? capLabel(v) : inp.value;
    root.querySelector(`[data-v="${k}"]`).textContent = disp;   // instant readout
    queue(k, v);                                                // throttled onChange
  }));

  const modeSel = root.querySelector('select[data-k="mode"]');
  modeSel.addEventListener('change', () => { syncFloorEnabled(modeSel.value); onChange({ mode: modeSel.value }); });

  // Re-sync sliders + the mode select to the current (shared) params — call when this strip
  // becomes visible, so it never shows stale values after the other strip was used.
  function refresh() {
    const P = getParams();
    root.querySelectorAll('input[type="range"]').forEach((inp) => {
      const k = inp.dataset.k;
      inp.value = k === 'floorBudgetCap' ? capToSlider(P[k]) : P[k];
      const disp = k === 'floorBudgetCap' ? capLabel(P[k]) : String(P[k]);
      root.querySelector(`[data-v="${k}"]`).textContent = disp;
    });
    const m = P.mode || 'proportional';
    root.querySelector('select[data-k="mode"]').value = m;
    syncFloorEnabled(m);
  }
  return { refresh };
}

/**
 * Standalone seed re-roll control, rendered OUTSIDE the knob box. Shows an optional
 * description, a 🎲 button, and the current seed in parentheses. Re-rolling resamples all
 * randomness (tie-breaks + within-cell draws) and recomputes via onChange({ seed }). Shares
 * the same params as buildKnobs, so call refresh() when the strip is shown to stay in sync.
 */
export function buildSeedControl(root, { getParams, onChange, text = '' }) {
  const seedOf = () => getParams().seed ?? 1;
  root.innerHTML =
    (text ? `<span class="prio-seed-desc">${text}</span>` : '')
    + `<span class="prio-seed-val" data-v="seed">(seed ${seedOf()})</span>`
    + `<button type="button" class="pk-reroll" data-k="seed-reroll" title="Randomise the seed — re-roll tie-breaks and within-cell draws">🎲</button>`;
  const valEl = root.querySelector('[data-v="seed"]');
  root.querySelector('[data-k="seed-reroll"]').addEventListener('click', () => {
    const seed = Math.floor(Math.random() * 1e6);
    valEl.textContent = `(seed ${seed})`;
    onChange({ seed });
  });
  return { refresh() { valEl.textContent = `(seed ${seedOf()})`; } };
}
