// src/prioritise-panel.js
// Prioritisation tab: methodology write-up + local upload + activate switch + knobs,
// running the client-side engine and pushing results to the map + chart panels.
import { prioritise } from './prioritise.js';
import { buildCells, parseUpload, validateUpload, summarizeUpload } from './prioritise-data.js';
import { createHeatmap } from './prio-heatmap.js';
import { buildKnobs, buildSeedControl } from './prio-knobs.js';

const DEFAULTS = { delta: 0.5, tilt: 0, floorTilt: 0, n: 50, ctThreshold: 32, binWidthDays: 1, mode: 'proportional', floorSize: 1, floorBudgetCap: null, stalenessWindow: null, seed: 1 };

// Downloadable starter file for "Use your own line list" — full header + two example rows.
const UPLOAD_TEMPLATE = [
  'row_id,sample_id,health_zone,health_area,status,ct,date,sequenced,being_sequenced',
  '1,DRC-0001,Bunia,Hoho,Positive,24.3,2026-05-03,,',
  '2,DRC-0002,Bunia,Hoho,Positive,22.1,2026-05-04,1,',
].join('\n');

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
        <td style="width: 70px;">β<sub>r</sub></td>
        <td>Temporal preference (risk-based pass)</td>
        <td>β<sub>r</sub> &gt; 0 favours more recent samples, β<sub>r</sub> &lt; 0 favours earlier samples; by default β<sub>r</sub> = 0 (no temporal preference)</td>
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

  <p class="prio-formula">w(<em>k</em>, τ) = <span class="frac"><span class="frac-n">risk(<em>k</em>, τ)</span><span class="frac-d">h(<em>k</em>, τ) + δ</span></span> · exp<span class="big-paren">(</span>β<sub>r</sub> · <em>u</em>(τ)<span class="big-paren">)</span></p>
  <p>where <em>δ</em> is a shape / smoothing parameter, <em>β<sub>r</sub></em> reflects temporal preference for this risk-based pass (with β<sub>r</sub> &gt; 0 favouring more recent samples, e.g. to better capture recent viral movements, and β<sub>r</sub> &lt; 0 favouring earlier samples), and <em>u</em>(τ) ∈ [0, 1] is the normalised position of τ within the sampling window (0 = earliest, 1 = most recent). This formulation has the following properties:</p>
  <ul>
    <li>Cells corresponding to locations and time periods with high prevalence receive higher weights.</li>
    <li>The factor 1 / ( h(<em>k</em>, τ) + δ ) is an inverse-coverage penalty that down-weights cells already well represented among sequenced samples.</li>
    <li>The temporal factor exp( β<sub>r</sub> · <em>u</em>(τ) ) favours more recent samples when β<sub>r</sub> &gt; 0 and earlier samples when β<sub>r</sub> &lt; 0; β<sub>r</sub> = 0 means no temporal preference.</li>
  </ul>

  <p>The parameter δ is a free parameter with the following properties:</p>
  <table>
    <thead><tr><th>δ</th><th>Property</th></tr></thead>
    <tbody>
      <tr>
        <td style="width: 50px;">→ 0</td>
        <td>Greater preference for locations and time periods with few sequenced samples; cells with low prevalence may be over-represented</td>
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
        w(k,τ) ← risk(k,τ) / (h(k,τ) + δ) · exp(β_r·u(k,τ))
    if no such cell:  stop
    (k*,τ*) ← argmax w(k,τ)        # ties broken at random
    draw one random sample from (k*,τ*); append to ranked list
    h(k*,τ*) ← h(k*,τ*) + 1        # demotes this cell next round
return ranked                     # the top-N list for the lab</pre>

  <h4>Example output</h4>
  <p>With δ = 0.5 and β = 0 (no temporal preference):</p>
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

const COVERAGE_FLOOR_HTML = `
  <h4>Ensuring spatial coverage</h4>
  <p>The selection procedure above treats each cell (<em>k</em>, τ) independently - as a result a 
  location may receive <strong>zero</strong> sequencing quota for a given batch, even if it has
  no previously sequenced samples. While this is not unexpected given the objective of the heuristic,
  such an approach might not be desirable if we also want to ensure that any viral importation events to
  previously unaffected locations are likely to be captured in the phylogeny.
  <p>To address this, we here introduce an additional selection pass where every location with no
  previously sequenced samples is allocated <em>floor size</em> sequencing quota, with samples then drawn from the
  highest-weight cell(s) in the location. A budget cap can be specified to ensure that only a certain
  proportion of the total sequencing budget is used for this pass.
  <p>It should be noted that this pass runs <em>before</em> the risk-based selection procedure, using the
  same priority weight above — but with its <em>own</em> temporal preference specified by β<sub>s</sub> — to
  determine which cell(s) to draw from given the allocated quota for a given location. Ties between cells with the same weight are broken at random.
  <table>
    <thead><tr><th>Parameter</th><th>Default</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td style="width:90px;">floor size</td><td>1</td><td>Maximum number of samples to be drawn from each location with no previously sequenced samples; 1 = "one sample per location, if available".</td></tr>
      <tr><td style="width:90px;">budget cap</td><td>∞</td><td>Maximum total number of samples to be drawn from locations with no previously sequenced samples; ∞ = no guarantee for leftover sequencing budget for risk-based selection.</td></tr>
      <tr><td style="width:90px;">β<sub>s</sub></td><td>0</td><td>Temporal preference, with β<sub>s</sub> &lt; 0 favouring earlier samples and β<sub>s</sub> &gt; 0 favouring more recent samples.</td></tr>
    </tbody>
  </table>
`;

export function createPrioritisationPanel(container, { risk, canon, tips, onChange }) {
  container.innerHTML = METHODOLOGY_HTML
    + COVERAGE_FLOOR_HTML
    + '<h4>Explore the allocation</h4>'
    + '<p class="ps-cap">Each row corresponds to a health zone (with eligible samples, existing sequences, or samples in sequencing) and each column a time-bin. '
      + 'Each cell stacks up to three boxes: the top band (<i class="ps-swatch" style="background:#7c1d1d"></i> maroon) indicates the number of sequences already in the phylogeny for that health zone and time-bin; '
      + 'the thin middle band (<i class="ps-swatch" style="background:#c77d2e"></i> amber) indicates samples currently in the process of being sequenced; '
      + 'and the lower box (<i class="ps-swatch" style="background:#205c4c"></i> teal) indicates the number of samples to be sequenced according to our heuristic given the current configurations. '
      + 'A darker colour indicates more samples.</p>'
    + '<div id="prio-heatmap"></div>'
    + '<div id="prio-scatter-knobs" class="ps-knobs"></div>'
    + '<div id="prio-seed" class="prio-seed-page"></div>'
    + '<h4>Export the ranking</h4>'
    + '<p class="ps-cap">Download the prioritisation computed from the current knob values (δ, β, <em>N</em>, eligibility Ct, bin width). The ranked list carries the sample IDs drawn from each selected cell.</p>'
    + '<div class="prio-dl"><button class="prio-dl-btn" id="dl-ranked" type="button">⤓ ranked list (CSV)</button>'
      + '<button class="prio-dl-btn" id="dl-counts" type="button">⤓ per-cell counts (CSV)</button></div>'
    + '<div id="prio-diag" class="prio-diag"></div>'
    + '<h4>Use your own line list</h4>'
    + '<p class="ps-cap">Prioritisation runs on the public data by default. To activate it on the map, switch the choropleth metric (top-right of the Outbreak map) to <strong>Seq+</strong>. Optionally upload your own line list to get a ranked list with real sample IDs — parsed in your browser, never uploaded. Relative risk per zone is taken from the map data (a current snapshot, constant in time); the upload supplies only the line list.</p>'
    + '<p class="ps-cap">Expected CSV columns (<button type="button" class="prio-linkbtn" id="prio-template">download a template</button>):</p>'
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
      + '<tr><td>being_sequenced</td><td>optional</td><td>1</td><td>mark in-process samples (1 / true / yes) → removed from selection &amp; added to history <em>h</em></td></tr>'
      + '<tr><td>row_id</td><td>optional</td><td>42</td><td>carried into the ranked output alongside sample_id</td></tr>'
      + '</tbody></table></div>'
    + '<p class="ps-cap">An uploaded line list replaces the public data for the prioritisation (the Lab/DHIS selector no longer applies); it is checked for the required columns before use.</p>'
    + '<div class="prio-up-actions">'
      + '<label class="prio-up"><input type="file" id="prio-file" accept=".csv,text/csv"><span class="prio-up-note">upload a line list, or drop one anywhere on this page (parsed in your browser, never uploaded)</span></label>'
      + '<button type="button" class="prio-clear" id="prio-clear" hidden>✕ clear</button>'
    + '</div>'
    + '<div id="prio-up-msg" class="prio-up-msg" hidden></div>';

  const fileEl = container.querySelector('#prio-file');
  const diagEl = container.querySelector('#prio-diag');
  const heat = createHeatmap(container.querySelector('#prio-heatmap'));

  const seqRows = (tips || []).filter((t) => t.date).map((t) => ({ health_zone: t.health_zone, date: t.date }));
  let uploadRows = null;                 // null = public mode
  let params = { ...DEFAULTS };
  let active = false;                    // true while the map's "To sequence" (Seq+) metric is selected
  let pageActive = false;                // true while the SEQUENCING PRIORITISATION tab is shown

  // Run the engine on the current data + params, without touching the map/chart.
  function runEngine() {
    const inUpload = !!uploadRows;
    const candidateRows = inUpload ? uploadRows.filter((r) => !r.sequenced && !r.being_sequenced) : window.__PRIO_LINELIST__ || [];
    const sequencedRows = inUpload ? uploadRows.filter((r) => r.sequenced) : seqRows;
    // In-process-of-being-sequenced rows raise h/H_k and drop out of selection. In public mode
    // they stay in candidateRows and subtractHistory removes them; in upload mode subtractHistory
    // is off, so they're excluded from candidateRows above and only counted as history here.
    const inProgressRows = (inUpload
      ? uploadRows.filter((r) => r.being_sequenced && !r.sequenced)
      : candidateRows.filter((r) => r.being_sequenced)).map((r) => ({ health_zone: r.health_zone, date: r.date }));
    const built = buildCells({
      candidateRows, sequencedRows, inProgressRows, risk, canon,
      ctThreshold: params.ctThreshold, binWidthDays: params.binWidthDays,
      subtractHistory: !inUpload, withIds: true,   // public linelist now carries sample_id too
    });
    const { selection, cellSummary } = prioritise({
      cells: built.cells, locHistory: built.locHistory, n: params.n, delta: params.delta, tilt: params.tilt, floorTilt: params.floorTilt,
      binWidthDays: params.binWidthDays, origin: built.origin, tNow: built.tNow, seed: params.seed,
      mode: params.mode, floorSize: params.floorSize, floorBudgetCap: params.floorBudgetCap,
      stalenessWindow: params.stalenessWindow,
    });
    // Ct-stable row universe for the heatmap: all candidate zones with the Ct filter OFF, so the
    // Ct knob only changes cell values, never adds/removes rows. Independent of δ/β/N.
    const universe = buildCells({
      candidateRows, sequencedRows, inProgressRows, risk, canon,
      ctThreshold: Infinity, binWidthDays: params.binWidthDays,
      subtractHistory: !inUpload, withIds: false,
    });
    const zones = [...new Set(universe.cells.map((c) => c.location))].sort();
    return { inUpload, selection, cellSummary, origin: built.origin, zones, cellHistory: built.cellHistory, inProgress: built.inProgressHistory, diagnostics: built.diagnostics };
  }

  // Human-readable breakdown of why candidate rows were dropped (upload QA aid).
  function dropReasons(by) {
    const parts = [];
    if (by.notPositive) parts.push(`${by.notPositive} not positive`);
    if (by.ctIneligible) parts.push(`${by.ctIneligible} Ct-ineligible / no Ct`);
    if (by.badDate) parts.push(`${by.badDate} bad/no date`);
    if (by.unknownZone) parts.push(`${by.unknownZone} unknown zone`);
    return parts.join(' · ');
  }

  // Update the live count readout + the heatmap from an engine result (both paths use this).
  function render(r) {
    if (r.inUpload) {
      const reasons = dropReasons(r.diagnostics.byReason);
      diagEl.textContent = `${r.diagnostics.kept} eligible, ${r.diagnostics.dropped} dropped`
        + (reasons ? ` (${reasons})` : '') + ` · ${r.selection.length} to sequence`;
    } else {
      diagEl.textContent = `${r.diagnostics.kept} eligible candidates · ${r.selection.length} to sequence`;
    }
    heat.update(r.cellSummary, params, { origin: r.origin, binWidthDays: params.binWidthDays, zones: r.zones, existing: r.cellHistory, inProgress: r.inProgress, risk });
  }

  // Run the engine, push results out (main.js gates the map choropleth on `active` and the
  // chart overlay on `active || pageActive`), and keep the methodology heatmap live. Every
  // path funnels through here.
  function recompute() {
    const r = runEngine();
    onChange({ active, pageActive, cellSummary: r.cellSummary, selection: r.selection, origin: r.origin, binWidthDays: params.binWidthDays, mode: r.inUpload ? 'upload' : 'public' });
    render(r);
  }

  // Single entry point for a parameter change (from the page knobs OR the on-map knobs).
  function applyParams(p) { params = { ...params, ...p }; recompute(); }

  // Toggled by the map's "To sequence" (Seq+) metric — drives the map choropleth + chart.
  function setActive(on) { active = !!on; recompute(); }

  // Toggled when the SEQUENCING PRIORITISATION tab is shown/hidden — drives the chart overlay.
  function setPageActive(on) { pageActive = !!on; recompute(); }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const upMsgEl = container.querySelector('#prio-up-msg');
  const clearBtn = container.querySelector('#prio-clear');
  function showUpMsg(text, kind) {            // kind: 'error' | 'info' | null (hide)
    if (!text) { upMsgEl.hidden = true; upMsgEl.textContent = ''; upMsgEl.className = 'prio-up-msg'; return; }
    upMsgEl.hidden = false; upMsgEl.textContent = text; upMsgEl.className = `prio-up-msg prio-up-msg--${kind}`;
  }
  function syncUploadUI() { clearBtn.hidden = !uploadRows; }

  // A short report on an accepted file: per-status, undated/no-Ct, and unknown zones (dropped).
  function loadReport(parsed, fileName) {
    const s = summarizeUpload(parsed.rows, risk, canon);
    const statuses = Object.entries(s.byStatus).map(([k, v]) => `${v} ${k}`).join(', ');
    let msg = `Loaded ${s.total} row${s.total === 1 ? '' : 's'} from “${fileName}” — ${statuses}`;
    const notes = [];
    if (s.undated) notes.push(`${s.undated} undated`);
    if (s.noCt) notes.push(`${s.noCt} no Ct`);
    if (notes.length) msg += ` · ${notes.join(' · ')}`;
    if (s.unknownZones.length) {
      const shown = s.unknownZones.slice(0, 8).join(', ');
      const extra = s.unknownZones.length > 8 ? ` +${s.unknownZones.length - 8} more` : '';
      msg += ` · ${s.unknownZones.length} unknown zone${s.unknownZones.length === 1 ? '' : 's'}: ${shown}${extra} (dropped)`;
    }
    return msg;
  }

  // QA the file before anything: validate required columns + data rows, surface any error,
  // and only then apply it. A rejected file leaves the prioritisation on the public data.
  // Shared by the file picker and the drop zone.
  function handleFile(f) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try { parsed = parseUpload(String(reader.result)); }
      catch { uploadRows = null; fileEl.value = ''; showUpMsg('Could not read the file as CSV.', 'error'); syncUploadUI(); recompute(); return; }
      const v = validateUpload(parsed);
      if (!v.ok) { uploadRows = null; fileEl.value = ''; showUpMsg(`Upload rejected — ${v.error}`, 'error'); syncUploadUI(); recompute(); return; }
      uploadRows = parsed.rows;
      showUpMsg(loadReport(parsed, f.name), 'info');
      syncUploadUI();
      recompute();
    };
    reader.onerror = () => { uploadRows = null; fileEl.value = ''; showUpMsg('Could not read the file.', 'error'); syncUploadUI(); recompute(); };
    reader.readAsText(f);
  }
  fileEl.addEventListener('change', (e) => handleFile(e.target.files?.[0]));

  // Clear → drop the uploaded list, return to public data (no reload).
  clearBtn.addEventListener('click', () => {
    uploadRows = null; fileEl.value = ''; showUpMsg(null); syncUploadUI(); recompute();
  });

  // Download a starter template.
  container.querySelector('#prio-template').addEventListener('click', () => download('linelist_template.csv', UPLOAD_TEMPLATE));

  // Drag-and-drop a file anywhere on the prioritisation page → same path as the picker.
  // A full-page overlay (fixed to the container's rect) signals the drop target while dragging.
  const overlay = document.createElement('div');
  overlay.className = 'prio-drop-overlay'; overlay.hidden = true;
  overlay.innerHTML = '<div class="prio-drop-inner">⤓ Drop your line list to load it</div>';
  document.body.appendChild(overlay);
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  function showOverlay() {
    const r = container.getBoundingClientRect();
    Object.assign(overlay.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
    overlay.hidden = false;
  }
  let dragDepth = 0;
  container.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; showOverlay(); });
  container.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  container.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
  container.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; overlay.hidden = true;
    handleFile(e.dataTransfer?.files?.[0]);
  });

  // Always-available exports — recomputed from the current knob values at click time, so the
  // file is never a stale by-product of the last map interaction.
  const round = (v) => (Number.isFinite(v) ? +v.toFixed(6) : v);
  const binDate = (bin, origin) => new Date(+new Date(origin) + (bin + 0.5) * params.binWidthDays * 86400000).toISOString().slice(0, 10);
  container.querySelector('#dl-ranked').addEventListener('click', () => {
    const r = runEngine();
    download('prioritisation_ranked.csv', ['rank,row_id,sample_id,location,time_bin,date,weight,layer',
      ...r.selection.map((s) => [s.rank, s.rowId ?? '', s.sampleId ?? '', s.location, s.timeBin, binDate(s.timeBin, r.origin), round(s.weight), s.layer].join(','))].join('\n'));
  });
  container.querySelector('#dl-counts').addEventListener('click', () => {
    const r = runEngine();
    download('prioritisation_counts.csv', ['location,time_bin,risk,tilt,available,selected,floor_selected,prop_selected,h_final',
      ...r.cellSummary.map((c) => [c.location, c.timeBin, c.risk, c.tilt, c.available, c.selected, c.floorSelected, c.propSelected, c.hFinal].join(','))].join('\n'));
  });

  // The N budget can be dialled up to the full eligible-candidate pool. Eligibility maxes
  // out at a permissive Ct and is independent of bin/δ/β, so this is a cheap one-shot count.
  function eligibleCeiling() {
    const inUpload = !!uploadRows;
    const candidateRows = inUpload ? uploadRows.filter((r) => !r.sequenced && !r.being_sequenced) : window.__PRIO_LINELIST__ || [];
    return Math.max(1, buildCells({ candidateRows, sequencedRows: [], risk, canon, ctThreshold: 1e9, binWidthDays: 1, subtractHistory: false }).diagnostics.kept);
  }

  // Page knob strip beside the heatmap — shares params with the on-map knobs.
  const pageKnobs = buildKnobs(container.querySelector('#prio-scatter-knobs'), { getParams: () => ({ ...params }), onChange: applyParams, getMaxN: eligibleCeiling });
  // Seed re-roll — sits below the knob box, shares the same params.
  const pageSeed = buildSeedControl(container.querySelector('#prio-seed'), { getParams: () => ({ ...params }), onChange: applyParams, text: 'Re-roll random tie-breaks &amp; within-cell draws:' });
  recompute();   // initial render (the ResizeObserver paints it once the tab is first shown)

  return {
    /** Update knobs (from the on-map panel) and recompute. */
    setParams(p) { applyParams(p); },
    /** Re-run the engine, re-reading window.__PRIO_LINELIST__ (sample-collected toggle). */
    refresh: () => recompute(),
    /** Toggle prioritisation — called by the map's "To sequence" (Seq+) metric. */
    setActive,
    /** Toggle the chart overlay with the prioritisation tab — called by the tab switcher. */
    setPageActive,
    /** Re-sync the page knob sliders + seed read-out to the shared params (called when the tab is shown). */
    refreshKnobs: () => { pageKnobs.refresh(); pageSeed.refresh(); },
    /** Eligible-candidate ceiling — the on-map knobs use it as the N slider max. */
    getMaxN: () => eligibleCeiling(),
    isActive: () => active,
    getParams: () => ({ ...params }),
  };
}
