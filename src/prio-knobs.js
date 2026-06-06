// src/prio-knobs.js
// Shared δ/λ/N/Ct/bin knob strip, used both on the map (inside a Leaflet control) and on
// the prioritisation page (beside the scatter). λ is log-scaled with an ∞ top stop (its
// effect is exponential); the recompute is throttled so dragging stays smooth, while the
// numeric readout updates instantly.

const LAM_MAX = 999, LAM_STOPS = 100;
const lamFromSlider = (p) => p >= LAM_STOPS ? Infinity
  : Math.round(Math.pow(10, (p / (LAM_STOPS - 1)) * Math.log10(LAM_MAX)));
const lamToSlider = (lam) => !isFinite(lam) ? LAM_STOPS
  : Math.round(Math.log10(Math.max(1, lam)) / Math.log10(LAM_MAX) * (LAM_STOPS - 1));
const lamLabel = (lam) => isFinite(lam) ? String(lam) : '∞';

function row(label, k, val, min, max, step, disp) {
  return `<div class="pk-row"><span class="pk-l">${label}</span>`
    + `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">`
    + `<span class="pk-v" data-v="${k}">${disp != null ? disp : val}</span></div>`;
}

/**
 * Build the knob rows into `root`, reading initial values from getParams(); each drag fires
 * a throttled onChange({ [key]: value }).
 * @param {HTMLElement} root
 * @param {{ getParams: () => object, onChange: (partial: object) => void, throttleMs?: number }} opts
 */
export function buildKnobs(root, { getParams, onChange, throttleMs = 150 }) {
  const P = getParams();
  root.innerHTML =
    row('δ', 'delta', P.delta, 0.05, 1, 0.05) +
    row('λ (d)', 'lam', lamToSlider(P.lam), 0, LAM_STOPS, 1, lamLabel(P.lam)) +
    row('N', 'n', P.n, 1, 200, 1) + row('Ct<', 'ctThreshold', P.ctThreshold, 1, 45, 1) +
    row('bin (d)', 'binWidthDays', P.binWidthDays, 1, 30, 1);

  let pending = null, timer = null, lastRun = 0;
  const applyNow = () => { timer = null; lastRun = Date.now(); const p = pending; pending = null; if (p) onChange(p); };
  const queue = (k, v) => {
    pending = { ...(pending || {}), [k]: v };
    const wait = throttleMs - (Date.now() - lastRun);
    if (wait <= 0) applyNow();
    else if (!timer) timer = setTimeout(applyNow, wait);
  };
  root.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.k;
    const v = k === 'lam' ? lamFromSlider(parseFloat(inp.value)) : parseFloat(inp.value);
    root.querySelector(`[data-v="${k}"]`).textContent = k === 'lam' ? lamLabel(v) : inp.value;  // instant readout
    queue(k, v);                                                                                // throttled onChange
  }));

  // Re-sync the slider positions + readouts to the current (shared) params — call when this
  // strip becomes visible, so it never shows stale values after the other strip was used.
  function refresh() {
    const P = getParams();
    root.querySelectorAll('input').forEach((inp) => {
      const k = inp.dataset.k;
      inp.value = k === 'lam' ? lamToSlider(P[k]) : P[k];
      root.querySelector(`[data-v="${k}"]`).textContent = k === 'lam' ? lamLabel(P[k]) : String(P[k]);
    });
  }
  return { refresh };
}
