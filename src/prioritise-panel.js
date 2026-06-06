// src/prioritise-panel.js
// Prioritisation tab: methodology write-up + local upload + activate switch + knobs,
// running the client-side engine and pushing results to the map + chart panels.
import { prioritise } from './prioritise.js';
import { buildCells, parseUpload } from './prioritise-data.js';
import { createScatter } from './prio-scatter.js';
import { buildKnobs } from './prio-knobs.js';

const DEFAULTS = { delta: 0.5, lam: Infinity, n: 50, ctThreshold: 32, binWidthDays: 1 };

const METHODOLOGY_HTML = `
  <p class="prio-lead">Risk-based sequencing prioritisation</p>

  <h4>Problem &amp; objective</h4>
  <ul>
    <li>Samples accrue continuously across locations (health zones) and time, but sequencing capacity is limited to a fixed quota of <em>N</em> samples per batch.</li>
    <li>Our goal is therefore to choose which samples to sequence so that the <strong>cumulative sequenced samples is representative of where and when infections have been occurring (e.g., using estimated relative risks or reported positives as proxy).</strong>
    <li>Because samples may be drawn retrospectively as well as prospectively, the entire pool of unsequenced samples (Ct &lt; 31) is re-ranked for each batch.</li>
  </ul>

  <h4>Semantics &amp; definitions</h4>
  <p>A <strong>cell</strong> = a (location, time-bin) pair, written as (<em>k</em>, τ). Each sample is assigned to a cell based on the location from which it was sampled and the date of symptom onset of the patient (binned at a chosen temporal resolution).</p>
  <table>
    <thead><tr><th>Symbol</th><th>Interpretation</th><th>Note</th></tr></thead>
    <tbody>
      <tr>
        <td style="width: 70px;">risk(<em>k</em>, τ)</td>
        <td>Predicted prevalence at health zone <em>k</em> at time τ</td>
        <td>By default, we take the current snapshot and assume it is constant into the past</td>
      </tr>
      <tr>
        <td style="width: 70px;">h(<em>k</em>, τ)</td>
        <td>Number of samples already sequenced from cell (<em>k</em>, τ)</td>
        <td>From previous batches</td>
      </tr>
      <tr>
        <td style="width: 70px;">δ</td>
        <td>Shape / smoothing parameter</td>
        <td>0.5 by default; see below for more details</td>
      </tr>
      <tr>
        <td style="width: 70px;">λ</td>
        <td>Recency timescale (days)</td>
        <td>By default, we set λ = ∞, representing no preference for more recent samples.</td>
      </tr>
      <tr>
        <td style="width: 70px;">bin width</td>
        <td>Temporal resolution of a cell</td>
        <td>Daily by default</td>
      </tr>
      <tr>
        <td style="width: 70px;"><em>N</em></td>
        <td>Per-batch sequencing budget</td>
        <td>50 samples by default</td>
      </tr>
    </tbody>
  </table>

  <h4>Priority weight &amp; selection</h4>
  <p>For a given batch, samples are selected iteratively until the sequencing budget <em>N</em> is reached. At each step <em>i</em> = 1…<em>N</em>, every cell (<em>k</em>, τ) with an available sample is assigned a priority weight given by:

  <p class="prio-formula">w(<em>k</em>, τ) = <span class="frac"><span class="frac-n">risk(<em>k</em>, τ)</span><span class="frac-d">h(<em>k</em>, τ) + δ</span></span> · exp<span class="big-paren">(</span>−<span class="frac"><span class="frac-n"><em>t</em> − τ</span><span class="frac-d">λ</span></span><span class="big-paren">)</span></p>
  <p>where <em>t</em> is the current time, <em>δ</em> is a shape / smoothing parameter, and <em>λ</em> is a recency timescale (days). This formulation has the following properties:</p>
  <ul>
    <li>Cells corresponding to locations and time periods with high prevalence receive higher weights.</li>
    <li>The factor 1 / ( h(<em>k</em>, τ) + δ ) is an inverse-coverage penalty that down-weights cells already well represented among sequenced samples.</li>
    <li>The exponential decay term exp( −(<em>t</em> − τ) / λ ) introduces a preference for more recent samples, with a smaller λ favoring more recent samples.</li>
  </ul>

  <p>The parameter δ is a free parameter with the following properties:</p>
  <table>
    <thead><tr><th>δ</th><th>Property</th></tr></thead>
    <tbody>
      <tr>
        <td style="width: 50px;">→ 0</td>
        <td>Every cell with an available, eligible sample has at least one sample sequenced; locations and time periods with low prevalence may be over-represented</td>
      </tr>
      <tr>
        <td style="width: 50px;">≈ 0.5</td>
        <td>Near-unbiased, proportional to risk</td>
      </tr>
      <tr>
        <td style="width: 50px;">→ 1</td>
        <td>Greater preference for locations and time periods with high prevalence</td>
      </tr>
    </tbody>
  </table>

  <p>Pseudo-code for selecting the top-<em>N</em> samples:</p>
  <pre>for i = 1 to N do
    for each cell (k,τ) with an available sample and risk(k,τ) &gt; 0:
        w(k,τ) ← risk(k,τ) / (h(k,τ) + δ) · exp(−(t − τ)/λ)
    if no such cell:  stop
    (k*,τ*) ← argmax w(k,τ)        # ties broken at random
    draw one random sample from (k*,τ*); append to ranked list
    h(k*,τ*) ← h(k*,τ*) + 1        # demotes this cell next round
return ranked                     # the top-N list for the lab</pre>

  <h4>Example output</h4>
  <p>With δ = 0.5 and λ ≈ ∞ (no preference for more recent samples):</p>
  <div class="prio-tablewrap">
  <table>
    <thead><tr><th>sample_id</th><th>health_zone</th><th>onset</th><th>risk</th><th>status</th><th>ct</th><th>h</th><th>w</th></tr></thead>
    <tbody>
      <tr><td>001</td><td>Bunia</td><td>29/05/2026</td><td>0.85</td><td>Positive</td><td>30.1</td><td>9</td><td>0.089</td></tr>
      <tr><td>002</td><td>Bunia</td><td>30/05/2026</td><td>0.91</td><td>Positive</td><td>23.4</td><td>10</td><td>0.087</td></tr>
      <tr><td>003</td><td>Bunia</td><td>30/05/2026</td><td>0.91</td><td><strong>Negative</strong></td><td>—</td><td>10</td><td>(ineligible)</td></tr>
      <tr><td>004</td><td>Lulingu</td><td>02/06/2026</td><td>0.072</td><td>Positive</td><td>25.5</td><td>0</td><td><strong>0.144</strong></td></tr>
      <tr><td>005</td><td>Katwa</td><td>03/06/2026</td><td>0.52</td><td>Positive</td><td><strong>33.53</strong></td><td>2</td><td>(ineligible)</td></tr>
    </tbody>
  </table>
  </div>
  <p>Only sample <strong>#004</strong> is sequenced in this iteration — its corresponding cell has the highest weight (a recent, un-sequenced cell), while <strong>#003</strong> (negative) and <strong>#005</strong> (Ct ≥ 32) are ineligible.</p>
`;

export function createPrioritisationPanel(container, { risk, canon, tips, onChange }) {
  container.innerHTML = METHODOLOGY_HTML
    + '<h4>Explore the weighting</h4>'
    + '<p class="ps-cap">Each point is a cell (zone × time-bin): <b>y</b> = risk/(h+δ), <b>x</b> = the weight <em>w</em>. '
      + 'Cells on the dashed line carry no recency penalty; lower <em>λ</em> to pull older cells left. '
      + '<span style="color:#205c4c;font-weight:600">Green</span> = would be sequenced (top-<em>N</em>); point size ∝ available samples.</p>'
    + '<div id="prio-scatter"></div>'
    + '<div id="prio-scatter-knobs" class="ps-knobs"></div>'
    + '<h4>Export the ranking</h4>'
    + '<p class="ps-cap">Download the prioritisation computed from the current knob values (δ, λ, <em>N</em>, eligibility Ct, bin width). With the public data this is a cell-level ranking; uploads (coming soon) will carry real sample IDs.</p>'
    + '<div class="prio-dl"><button class="prio-dl-btn" id="dl-ranked" type="button">⤓ ranked list (CSV)</button>'
      + '<button class="prio-dl-btn" id="dl-counts" type="button">⤓ per-cell counts (CSV)</button></div>'
    + '<div id="prio-diag" class="prio-diag"></div>'
    + '<h4>Use your own line list</h4>'
    + '<p class="ps-cap">Prioritisation runs on the public data by default. To activate it on the map, switch the choropleth metric (top-right of the Outbreak map) to <strong>Seq+</strong>. Optionally upload your own line list to get a ranked list with real sample IDs — parsed in your browser, never uploaded. Relative risk per zone is taken from the map data (a current snapshot, constant in time); the upload supplies only the line list.</p>'
    + '<p class="ps-cap">Expected CSV columns:</p>'
    + '<div class="prio-tablewrap"><table>'
      + '<thead><tr><th>column</th><th>required</th><th>example</th><th>notes</th></tr></thead>'
      + '<tbody>'
      + '<tr><td>sample_id</td><td>yes</td><td>DRC-0420</td><td>identifier carried into the ranked output; must be unique</td></tr>'
      + '<tr><td>health_zone</td><td>yes</td><td>Bunia</td><td>must match a health zone on the map (one with a relative risk); others are dropped</td></tr>'
      + '<tr><td>status</td><td>yes</td><td>Positive</td><td>only <em>Positive</em> rows are eligible for sequencing</td></tr>'
      + '<tr><td>ct</td><td>positives</td><td>24.3</td><td>eligible when Ct is below the selected threshold</td></tr>'
      + '<tr><td>date</td><td>yes</td><td>2026-05-03</td><td>symptom-onset date (where available) — ISO or DD/MM/YYYY</td></tr>'
      + '<tr><td>health_area</td><td>optional</td><td>Hoho</td><td>finer location label (display only)</td></tr>'
      + '<tr><td>sequenced</td><td>optional</td><td>1</td><td>mark already-sequenced rows (1 / true / yes) → history <em>h</em>; blank = candidate</td></tr>'
      + '</tbody></table></div>'
    + '<label class="prio-up"><span class="prio-soon">coming soon</span><input type="file" id="prio-file" accept=".csv,text/csv" disabled><span class="prio-up-note">upload a line list — soon to be available (will be parsed in your browser, never uploaded)</span></label>';

  const fileEl = container.querySelector('#prio-file');
  const diagEl = container.querySelector('#prio-diag');
  const scatter = createScatter(container.querySelector('#prio-scatter'));

  const seqRows = (tips || []).filter((t) => t.date).map((t) => ({ health_zone: t.health_zone, date: t.date }));
  let uploadRows = null;                 // null = public mode
  let params = { ...DEFAULTS };
  let active = false;                    // true while the map's "To sequence" (Seq+) metric is selected

  // Run the engine on the current data + params, without touching the map/chart.
  function runEngine() {
    const inUpload = !!uploadRows;
    const candidateRows = inUpload ? uploadRows.filter((r) => !r.sequenced) : window.__PRIO_LINELIST__ || [];
    const sequencedRows = inUpload ? uploadRows.filter((r) => r.sequenced) : seqRows;
    const built = buildCells({
      candidateRows, sequencedRows, risk, canon,
      ctThreshold: params.ctThreshold, binWidthDays: params.binWidthDays,
      subtractHistory: !inUpload, withIds: inUpload,
    });
    const { selection, cellSummary } = prioritise({
      cells: built.cells, n: params.n, delta: params.delta, lam: params.lam,
      binWidthDays: params.binWidthDays, origin: built.origin, tNow: built.tNow, seed: 1,
    });
    return { inUpload, selection, cellSummary, origin: built.origin, diagnostics: built.diagnostics };
  }

  // Update the live count readout + the scatter from an engine result (both paths use this).
  function render(r) {
    diagEl.textContent = r.inUpload
      ? `${r.diagnostics.kept} eligible, ${r.diagnostics.dropped} dropped · ${r.selection.length} to sequence`
      : `${r.diagnostics.kept} eligible candidates · ${r.selection.length} to sequence`;
    scatter.update(r.cellSummary, params, { origin: r.origin, binWidthDays: params.binWidthDays });
  }

  // Active path: also drive the map + chart.
  function compute() {
    const r = runEngine();
    onChange({ active, cellSummary: r.cellSummary, selection: r.selection, origin: r.origin, binWidthDays: params.binWidthDays, mode: r.inUpload ? 'upload' : 'public' });
    render(r);
  }

  // Inactive path: keep the methodology scatter + count live as the shared knobs change.
  function refreshScatter() { render(runEngine()); }

  // active → drive the map/chart; otherwise just keep the methodology scatter live.
  function recompute() { if (active) compute(); else refreshScatter(); }

  // Single entry point for a parameter change (from the page knobs OR the on-map knobs).
  function applyParams(p) { params = { ...params, ...p }; recompute(); }

  // Toggled by the map's "To sequence" (Seq+) metric: on → compute + drive the map/chart;
  // off → clear the map/chart (the scatter keeps its last state).
  function setActive(on) {
    active = !!on;
    if (active) compute();
    else { onChange({ active: false }); refreshScatter(); }
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  fileEl.addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { uploadRows = parseUpload(String(reader.result)).rows; recompute(); };
    reader.readAsText(f);
  });

  // Always-available exports — recomputed from the current knob values at click time, so the
  // file is never a stale by-product of the last map interaction.
  const round = (v) => (Number.isFinite(v) ? +v.toFixed(6) : v);
  const binDate = (bin, origin) => new Date(+new Date(origin) + (bin + 0.5) * params.binWidthDays * 86400000).toISOString().slice(0, 10);
  container.querySelector('#dl-ranked').addEventListener('click', () => {
    const r = runEngine();
    download('prioritisation_ranked.csv', ['rank,sample_id,location,time_bin,date,weight',
      ...r.selection.map((s) => [s.rank, s.sampleId ?? '', s.location, s.timeBin, binDate(s.timeBin, r.origin), round(s.weight)].join(','))].join('\n'));
  });
  container.querySelector('#dl-counts').addEventListener('click', () => {
    const r = runEngine();
    download('prioritisation_counts.csv', ['location,time_bin,risk,decay,available,selected,h_final',
      ...r.cellSummary.map((c) => [c.location, c.timeBin, c.risk, c.decay, c.available, c.selected, c.hFinal].join(','))].join('\n'));
  });

  // The N budget can be dialled up to the full eligible-candidate pool. Eligibility maxes
  // out at a permissive Ct and is independent of bin/δ/λ, so this is a cheap one-shot count.
  function eligibleCeiling() {
    const inUpload = !!uploadRows;
    const candidateRows = inUpload ? uploadRows.filter((r) => !r.sequenced) : window.__PRIO_LINELIST__ || [];
    return Math.max(1, buildCells({ candidateRows, sequencedRows: [], risk, canon, ctThreshold: 1e9, binWidthDays: 1, subtractHistory: false }).diagnostics.kept);
  }

  // Page knob strip beside the scatter — shares params with the on-map knobs.
  const pageKnobs = buildKnobs(container.querySelector('#prio-scatter-knobs'), { getParams: () => ({ ...params }), onChange: applyParams, getMaxN: eligibleCeiling });
  refreshScatter();   // initial render (the ResizeObserver paints it once the tab is first shown)

  return {
    /** Update knobs (from the on-map panel) and recompute. */
    setParams(p) { applyParams(p); },
    /** Toggle prioritisation — called by the map's "To sequence" (Seq+) metric. */
    setActive,
    /** Re-sync the page knob sliders to the shared params (called when the tab is shown). */
    refreshKnobs: () => pageKnobs.refresh(),
    /** Eligible-candidate ceiling — the on-map knobs use it as the N slider max. */
    getMaxN: () => eligibleCeiling(),
    isActive: () => active,
    getParams: () => ({ ...params }),
  };
}
