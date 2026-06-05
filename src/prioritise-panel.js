// src/prioritise-panel.js
// Prioritisation tab: methodology write-up + local upload + activate switch + knobs,
// running the client-side engine and pushing results to the map + chart panels.
import { prioritise } from './prioritise.js';
import { buildCells, parseUpload } from './prioritise-data.js';

const DEFAULTS = { delta: 0.5, lam: 14, n: 30, ctThreshold: 31, binWidthDays: 7 };

const METHODOLOGY_HTML = `
  <h4>What this does</h4>
  <p>Ranks unsequenced <em>sequenceable</em> samples so cumulative sequencing tracks
  <strong>relative risk</strong> across (health-zone × time-bin) cells, favouring
  <strong>recent</strong> and <strong>under-sequenced</strong> cells. Each cell gets a weight</p>
  <p style="text-align:center"><code>w = risk / (h + δ) · exp(−age/λ)</code></p>
  <p>and a greedy loop repeatedly picks the highest-weight cell, draws one sample, and
  bumps that cell's <code>h</code> — <em>N</em> times. The pick order is the ranking.</p>
  <h4>The knobs</h4>
  <ul style="margin:0;padding-left:18px">
    <li><strong>δ</strong> — coverage vs strict proportionality (small spreads to thin cells; ~0.5 near-proportional; large concentrates on hotspots).</li>
    <li><strong>λ</strong> — recency timescale in days (∞ = flat in time).</li>
    <li><strong>N</strong> — batch budget (how many to sequence).</li>
    <li><strong>Eligibility Ct</strong> — a positive is sequenceable if its Ct is strictly below this.</li>
    <li><strong>bin width</strong> — days per time-bin.</li>
  </ul>
  <h4>Data used</h4>
  <p>Candidates = eligible positives from the line-list; <code>risk</code> = each zone's
  relative risk; history (<code>h</code>) = the sequences already in the tree. With the
  public (de-identified) data we can only show <strong>how many</strong> to sequence per
  zone × time — not which. Upload your own line-list (with sample IDs) to get the actual
  ranked list; <strong>your file is parsed in your browser and never uploaded anywhere.</strong></p>
`;

export function createPrioritisationPanel(container, { risk, canon, tips, onChange }) {
  container.innerHTML = METHODOLOGY_HTML
    + '<h4>Run</h4>'
    + '<label class="prio-up"><input type="file" id="prio-file" accept=".csv,text/csv"> upload a line-list (local only)</label>'
    + '<div id="prio-diag" class="prio-diag"></div>'
    + '<label class="prio-act"><input type="checkbox" id="prio-active"> Activate prioritisation</label>'
    + '<div id="prio-dl"></div>';

  const fileEl = container.querySelector('#prio-file');
  const diagEl = container.querySelector('#prio-diag');
  const activeEl = container.querySelector('#prio-active');
  const dlEl = container.querySelector('#prio-dl');

  const seqRows = (tips || []).filter((t) => t.date).map((t) => ({ health_zone: t.health_zone, date: t.date }));
  let uploadRows = null;                 // null = public mode
  let params = { ...DEFAULTS };
  let lastCellSummary = [], lastSelection = [];

  function compute() {
    const inUpload = !!uploadRows;
    const candidateRows = inUpload ? uploadRows.filter((r) => !r.sequenced)
                                   : window.__PRIO_LINELIST__ || [];
    const sequencedRows = inUpload ? uploadRows.filter((r) => r.sequenced) : seqRows;
    const { cells, origin, tNow, diagnostics } = buildCells({
      candidateRows, sequencedRows, risk, canon,
      ctThreshold: params.ctThreshold, binWidthDays: params.binWidthDays,
      subtractHistory: !inUpload, withIds: inUpload,
    });
    const { selection, cellSummary } = prioritise({
      cells, n: params.n, delta: params.delta, lam: params.lam,
      binWidthDays: params.binWidthDays, origin, tNow, seed: 1,
    });
    lastCellSummary = cellSummary; lastSelection = selection;
    diagEl.textContent = inUpload
      ? `${diagnostics.kept} eligible, ${diagnostics.dropped} dropped · ${selection.length} selected`
      : `${diagnostics.kept} eligible candidates · ${selection.length} to sequence`;
    onChange({ active: activeEl.checked, cellSummary, selection, origin, binWidthDays: params.binWidthDays, mode: inUpload ? 'upload' : 'public' });
    renderDownloads(inUpload);
  }

  function renderDownloads(inUpload) {
    dlEl.replaceChildren();
    if (!activeEl.checked) return;
    const counts = document.createElement('button'); counts.className = 'prio-dl-btn'; counts.textContent = '⤓ counts CSV';
    counts.onclick = () => download('prioritisation_counts.csv',
      ['location,time_bin,risk,decay,available,selected,h_final',
        ...lastCellSummary.map((c) => [c.location, c.timeBin, c.risk, c.decay, c.available, c.selected, c.hFinal].join(','))].join('\n'));
    dlEl.appendChild(counts);
    if (inUpload) {
      const list = document.createElement('button'); list.className = 'prio-dl-btn'; list.textContent = '⤓ ranked list CSV';
      list.onclick = () => download('prioritisation_ranked.csv',
        ['rank,sample_id,location,time_bin,weight',
          ...lastSelection.map((s) => [s.rank, s.sampleId, s.location, s.timeBin, s.weight].join(','))].join('\n'));
      dlEl.appendChild(list);
    }
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  fileEl.addEventListener('change', (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { uploadRows = parseUpload(String(reader.result)).rows; compute(); };
    reader.readAsText(f);
  });
  // On activate, let compute() be the single authoritative onChange (it fires with the full
  // payload, so the map/chart get data in one pass — no all-zeros flicker). On deactivate,
  // there's no data to compute; just signal inactive so the map/chart clear.
  activeEl.addEventListener('change', () => {
    if (activeEl.checked) compute(); else onChange({ active: false });
  });

  return {
    /** Update knobs (from the on-map panel) and recompute. */
    setParams(p) { params = { ...params, ...p }; if (activeEl.checked) compute(); },
    isActive: () => activeEl.checked,
    getParams: () => ({ ...params }),
  };
}
