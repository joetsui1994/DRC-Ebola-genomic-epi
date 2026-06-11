import { createTimeScale, scaleFromAnchors } from './time-scale.js';

// "Sample distribution" panel: a stacked bar chart of line-list samples — one
// bar per day, segments by status. The x-axis is locked to the tree's view
// transform (stays aligned with the phylogeny regardless of the subset plotted);
// the y-axis rescales to the (filtered) data. A zone⇄area toggle controls whether
// a tip selection filters the line-list by health_zone or health_area.

const SVNS = 'http://www.w3.org/2000/svg';
const PAD = { left: 34, right: 20, top: 14, bottom: 22 };
const DAY_MS = 86400000;

const STATUS = ['Positive', 'Negative', 'Invalid', 'Unclassified'];
const STATUS_SET = new Set(STATUS);
const STATUS_COLOR = {
  Positive:     '#9e2b2b',
  Negative:     '#6f9bbf',
  Invalid:      '#d8a86f',
  Unclassified: '#d3cfc8',
};
/** A row passes the Ct filter when: the filter is off (ct null), or it isn't a positive,
 *  or it's a positive with a numeric Ct strictly below the threshold. */
export function ctPass(r, ct) {
  if (ct == null || r.status !== 'Positive') return true;
  const v = parseFloat(r.ct);
  return Number.isFinite(v) && v < ct;
}

/** Latest *plotted* date for the given rows + the tree-width fraction it implies.
 *  Uses the same filter as the bars (status-valid AND ctPass), so a Ct-hidden point
 *  never extends the axis. rows: selection-filtered rows; t0/t1: domain ms; on: showBeyond;
 *  ct: current Ct threshold or null. Returns { effMax (ms), f∈[F_MIN,1] }. */
export function extentFraction(rows, t0, t1, on, ct = null, F_MIN = 0.4) {
  let effMax = t1;
  if (on) for (const r of rows) {
    if (!STATUS_SET.has(r.status) || !ctPass(r, ct)) continue;
    const t = +new Date(r.date);
    if (!isNaN(t) && t > effMax) effMax = t;
  }
  const f = effMax > t0 ? Math.max(F_MIN, Math.min(1, (t1 - t0) / (effMax - t0))) : 1;
  return { effMax, f };
}

/** Convert a drag's start/end x (svg px) to an ordered time window, or null if the drag was
 *  too short to be a brush (a click → clear). `scale` exposes xToDate. */
export function brushWindow(x0, x1, scale, minPx = 3) {
  if (Math.abs(x1 - x0) < minPx) return null;
  return { d0: +scale.xToDate(Math.min(x0, x1)), d1: +scale.xToDate(Math.max(x0, x1)) };
}

const SEQ_COLOR = '#7c1d1d';   // sequence-availability track (genomic samples) — maroon
const ALLOC_COLOR = '#205c4c'; // to-sequence allocation track (prioritisation) — teal-green

const el = (name, attrs) => {
  const n = document.createElementNS(SVNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const upper = (s) => (s || '').toUpperCase().trim();

// Adaptive time-axis ticks: pick a "nice" interval (day → weekly → monthly) so
// labels are as dense as the pixel width allows (~70px apart) without packing.
function timeTicks(pxWidth, t0, t1) {
  const spanDays = Math.max(1, (t1 - t0) / DAY_MS);
  const target = Math.max(2, Math.min(14, Math.floor((pxWidth || 0) / 58)));
  const rawStep = spanDays / target;                        // desired step, in days
  const multiYear = new Date(t0).getFullYear() !== new Date(t1).getFullYear();
  const dayFmt = multiYear ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' };
  const monFmt = { month: 'short', year: 'numeric' };

  const ticks = [];
  const step = [1, 2, 3, 7, 14].find((s) => s >= rawStep);
  if (step) {                                               // day / week steps
    let d = new Date(t0); d.setHours(0, 0, 0, 0);
    if (step >= 7) { const mon = (d.getDay() + 6) % 7; if (mon) d = new Date(+d + (7 - mon) * DAY_MS); } // anchor on Monday
    for (let t = +d; t <= t1; t += step * DAY_MS) ticks.push({ date: new Date(t), fmt: dayFmt });
  } else {                                                  // month steps
    const ms = [1, 2, 3, 6, 12].find((s) => s >= rawStep / 30) || 12;
    let d = new Date(t0); d = new Date(d.getFullYear(), d.getMonth() + (d.getDate() > 1 ? 1 : 0), 1);
    while (+d <= t1) { ticks.push({ date: new Date(d), fmt: monFmt }); d = new Date(d.getFullYear(), d.getMonth() + ms, 1); }
  }
  return ticks;
}

/**
 * @param {string} containerId
 * @param {{date:string,status:string,health_zone:string,health_area:string}[]} rows
 * @param {{minDate:string,maxDate:string}} domain  tree time domain (root → most-recent)
 * @param {{onCtChange?:(t:?number)=>void}} [opts]  notified when the Ct filter changes
 */
export function createTimeseriesPanel(containerId, rows, domain, { onCtChange = () => {}, tips = [], onExtentChange = () => {}, onWindowChange = () => {} } = {}) {
  const host = document.getElementById(containerId);
  host.replaceChildren();

  // Ct filter (positives only): a number input + proportion readout in the header.
  const ctWrap = document.createElement('span');
  ctWrap.className = 'dist-ct';
  ctWrap.innerHTML = '<label>Ct&lt;</label><input type="number" min="1" max="99" step="1" placeholder="off">';
  const ctInput = ctWrap.querySelector('input');
  // Prepend into the header's pinned tools group so it reads Ct · CSV · → left-to-right.
  const distTools = document.getElementById('dist-tools');
  if (distTools) distTools.prepend(ctWrap);
  let ctThreshold = null;   // null = off
  ctInput.addEventListener('input', () => {
    const v = parseInt(ctInput.value, 10);
    ctThreshold = (Number.isFinite(v) && v > 0) ? v : null;
    onCtChange(ctThreshold);   // keep the map's Positive metric in sync
    applyExtent();
  });

  // zone⇄area toggle + status legend — a row near the top, offset from the left
  // edge so it clears the y-axis tick labels
  const toggle = document.createElement('div');
  toggle.className = 'dist-toggle';
  const btnZone = document.createElement('button'); btnZone.textContent = 'Zone';
  const btnArea = document.createElement('button'); btnArea.textContent = 'Area';
  toggle.append(btnZone, btnArea);

  const legend = document.createElement('div');
  legend.className = 'dist-legend';
  legend.innerHTML = STATUS.map(s => `<span><i style="background:${STATUS_COLOR[s]}"></i>${s}</span>`).join('')
    + `<span><i class="seq-dot" style="background:${SEQ_COLOR}"></i>Sequences</span>`;

  const controls = document.createElement('div');   // top-left row: toggle + legend
  controls.className = 'dist-controls';
  controls.append(toggle, legend);

  const holder = document.createElement('div');
  holder.className = 'dist-svg';
  const tip = document.createElement('div');
  tip.className = 'dist-tip';
  tip.style.display = 'none';
  // Persistent summary card for the brushed window (bottom-left). Like `tip`, it lives on
  // host (not holder) so the per-render SVG wipe doesn't remove it; pointer-events:none so it
  // never blocks brushing/hover on the bars beneath. Hidden until a window is brushed.
  const summary = document.createElement('div');
  summary.className = 'dist-window-summary';
  summary.style.display = 'none';
  host.append(controls, holder, tip, summary);   // tip/summary on host (holder is wiped each render)

  function showTip(ev, dateStr, counts) {
    const d = new Date(dateStr);
    let html = `<div class="tip-date">${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>`;
    for (const st of STATUS) html += `<div class="tip-row"><i style="background:${STATUS_COLOR[st]}"></i>${st}<b>${counts[st]}</b></div>`;
    const seqN = seqMap.get(dateStr) || 0;
    if (seqN) html += `<div class="tip-row"><i class="seq-dot" style="background:${SEQ_COLOR}"></i>Sequences<b>${seqN}</b></div>`;
    const toSeqN = allocMap.get(dateStr) || 0;
    if (toSeqN) html += `<div class="tip-row"><i class="seq-dot" style="background:${ALLOC_COLOR}"></i>To sequence<b>${toSeqN}</b></div>`;
    tip.innerHTML = html;
    tip.style.display = 'block';
    const rect = host.getBoundingClientRect();
    const cx = ev.clientX - rect.left, cy = ev.clientY - rect.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = cx + 12; if (left + tw > rect.width) left = cx - tw - 12; if (left < 0) left = 2;
    let top = cy + 12;  if (top + th > rect.height) top = cy - th - 12; if (top < 0) top = 2;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = () => { tip.style.display = 'none'; };

  let sel = { zones: [], areas: [] };   // original-case names
  let mode = 'zone';
  const scopeEl = document.getElementById('dist-scope');
  const note = document.getElementById('dist-note');   // "N not shown (…)" in the panel header
  let markerDates = [];
  let transform = null;
  let scale, markerLayer, H;
  let seqMap = new Map();   // date → #sequences (current selection), for the track + tooltip
  let allocMap = new Map(); // date → #to-sequence (prioritisation), for the track + tooltip
  let allocation = null;   // cellSummary[] | null  (to-sequence per zone×bin)
  let allocOpts = null;    // { binWidthDays, origin } | null

  const t0 = +new Date(domain.minDate);
  const t1 = +new Date(domain.maxDate);

  let showBeyond = false;            // toggle: extend the axis past the tree's latest date
  let win = null;                    // brushed time window { d0, d1 } in ms, or null
  let effMaxMs = t1;                 // current effective right-edge date (ms); = t1 when off
  let extentRaf = 0;                 // rAF handle, coalesces tree-resize requests
  let lastF = 1;                     // tree width-fraction the tree is currently at (for prediction)
  let autoCorr = 0;                  // consecutive calibration re-sends since the last user action

  // The naïve fill fraction f = (t1-t0)/(effMax-t0) assumes compressing the tree keeps its left
  // edge fixed, but PearTree shifts the whole tree (offsetX moves), so the post-tree tail lands
  // short of the right edge — a gap. We instead learn the tree's φ→geometry response (offsetX and
  // right-edge x1, both ~linear in φ at a given width) and solve for the φ that makes the uniform
  // axis fill exactly. Calibration is per-width; ≥2 samples at distinct φ are needed to fit.
  let calib = { W: 0, samples: [] };   // [{ phi, offsetX, x1 }]
  function recordCalib(phi, t) {
    const W = host.clientWidth || 0; if (!W) return;
    if (W !== calib.W) calib = { W, samples: [] };
    const s = { phi, offsetX: t.offsetX, x1: t.offsetX + t.maxX * t.scaleX };
    const i = calib.samples.findIndex((p) => Math.abs(p.phi - phi) < 0.015);
    if (i >= 0) {
      // Same fraction but the tree reports a different geometry → its layout changed (tip labels,
      // node-bars, legend…). The other samples are now stale: drop them and recalibrate from this.
      const old = calib.samples[i];
      if (Math.abs(old.offsetX - s.offsetX) > 2 || Math.abs(old.x1 - s.x1) > 2) {
        calib = { W, samples: [s] }; autoCorr = 0; return;
      }
      calib.samples[i] = s;
    } else {
      calib.samples.push(s);
      if (calib.samples.length > 5) calib.samples.shift();
    }
  }
  function fitLine(key) {   // least-squares y = m·phi + b
    const s = calib.samples, n = s.length;
    let sx=0, sy=0, sxx=0, sxy=0;
    for (const p of s) { sx+=p.phi; sy+=p[key]; sxx+=p.phi*p.phi; sxy+=p.phi*p[key]; }
    const den = n*sxx - sx*sx;
    if (Math.abs(den) < 1e-9) return null;
    const m = (n*sxy - sx*sy)/den;
    return { m, b: (sy - m*sx)/n };
  }
  const clampF = (f) => Math.max(0.4, Math.min(1, f));   // F_MIN matches extentFraction
  // φ to ask the tree for: 1 when not extending; the corrected fill fraction once calibrated;
  // the naïve f0 meanwhile (which also gathers the second calibration sample).
  function desiredFraction() {
    if (!showBeyond || effMaxMs <= t1) return 1;
    const f0 = clampF((t1 - t0) / (effMaxMs - t0));
    const W = host.clientWidth || 0;
    if (calib.W !== W || calib.samples.length < 2) return f0;
    const fo = fitLine('offsetX'), fx = fitLine('x1');
    if (!fo || !fx) return f0;
    const X_R = W - PAD.right, k = (effMaxMs - t1) / (t1 - t0);
    // want xMax(φ) = x1(φ)·(1+k) − k·offsetX(φ) = X_R
    const den = fx.m * (1 + k) - k * fo.m;
    if (Math.abs(den) < 1e-9) return f0;
    return clampF((X_R - (fx.b * (1 + k) - k * fo.b)) / den);
  }
  // Push the desired fraction to the tree if it differs from the current one (coalesced via rAF),
  // predicting the transform so this synchronous render is already close to the refit result.
  function syncTreeFraction() {
    const phi = desiredFraction();
    if (Math.abs(phi - lastF) <= 0.005) return;
    // Predict the tree's transform at the new fraction so this synchronous render already matches
    // the upcoming refit — otherwise the beyond region flashes un-squashed for a frame. When
    // calibrated, predict both offsetX and the right edge (the tree shifts left, not just scales).
    if (transform && transform.maxX > 0) {
      const fo = (calib.W === (host.clientWidth || 0) && calib.samples.length >= 2) ? fitLine('offsetX') : null;
      const fx = fo ? fitLine('x1') : null;
      if (fo && fx) {
        const offsetX = fo.m * phi + fo.b, x1 = fx.m * phi + fx.b;
        transform = { ...transform, offsetX, scaleX: (x1 - offsetX) / transform.maxX };
      } else if (lastF > 0) {
        transform = { ...transform, scaleX: transform.scaleX * (phi / lastF) };
      }
    }
    lastF = phi;
    if (extentRaf) cancelAnimationFrame(extentRaf);
    extentRaf = requestAnimationFrame(() => { extentRaf = 0; onExtentChange(phi); });
  }

  // Recompute the effective max from the current selection/Ct, sync the tree fraction, re-render.
  function applyExtent() {
    const ext = extentFraction(filteredRows(), t0, t1, showBeyond, ctThreshold);
    effMaxMs = ext.effMax;
    autoCorr = 0;            // user action: allow the calibration loop to re-converge
    syncTreeFraction();
    render();
  }

  function updateToggleUI() {
    btnZone.classList.toggle('active', mode === 'zone');
    btnArea.classList.toggle('active', mode === 'area');
    btnArea.disabled = sel.areas.length === 0;
    const names = mode === 'area' ? sel.areas : sel.zones;
    const level = mode === 'area' ? 'health area' : 'health zone';
    if (scopeEl) scopeEl.textContent = names.length ? `· ${names.join(', ')} (${level})` : '';
  }
  btnZone.onclick = () => { mode = 'zone'; updateToggleUI(); applyExtent(); };
  btnArea.onclick = () => { if (sel.areas.length === 0) return; mode = 'area'; updateToggleUI(); applyExtent(); };
  updateToggleUI();

  // ── CSV export ─────────────────────────────────────────────────────────────
  // One row per date: status counts (Ct-filtered), total, existing sequences, and the
  // to-sequence-next allocation. Honours the location selection, the Ct filter, and the
  // brushed window (when set, dates are clipped to it; otherwise to the visible axis).
  const EXPORT_COLS = ['date', ...STATUS, 'total', 'existing_seq', 'to_sequence'];
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  function exportWindow() { return win ? { lo: Math.min(win.d0, win.d1), hi: Math.max(win.d0, win.d1) } : null; }
  function exportRows() {
    const w = exportWindow();
    const inRange = (ds) => {
      const t = +new Date(ds);
      if (isNaN(t)) return false;
      return w ? (t >= w.lo && t <= w.hi) : (t >= t0 && t <= effMaxMs);
    };
    const counts = aggregate();                                          // selection + Ct, [t0,effMaxMs]
    const seq = seqByDate();                                             // selection, [t0,t1]
    const alloc = allocByDate(allocOpts?.binWidthDays || 7, allocOpts?.origin || domain.minDate);
    const days = new Set();
    for (const d of counts.keys()) if (inRange(d)) days.add(d);
    for (const d of seq.keys()) if (inRange(d)) days.add(d);
    for (const d of alloc.keys()) if (inRange(d)) days.add(d);
    return [...days].sort().map((ds) => {
      const c = counts.get(ds) || { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0 };
      const total = STATUS.reduce((s, k) => s + c[k], 0);
      return { date: ds, ...c, total, existing_seq: seq.get(ds) || 0, to_sequence: alloc.get(ds) || 0 };
    });
  }
  const buildCsvText = (rows) =>
    [EXPORT_COLS.join(','), ...rows.map((r) => EXPORT_COLS.map((k) => r[k]).join(','))].join('\n') + '\n';

  // Human-readable description of the active filters + a default (editable) filename.
  function exportFacts() {
    const names = mode === 'area' ? sel.areas : sel.zones;
    const level = mode === 'area' ? 'health area' : 'health zone';
    const location = names.length
      ? `${names.join(', ')} (${names.length} ${level}${names.length > 1 ? 's' : ''})`
      : 'All locations';
    const w = exportWindow();
    const timeRange = w ? `${fmtDay(w.lo)} – ${fmtDay(w.hi)} (selected window)`
      : showBeyond ? `${fmtDay(t0)} – ${fmtDay(effMaxMs)} (incl. beyond tree)`
      : `${fmtDay(t0)} – ${fmtDay(t1)} (full range)`;
    const ct = ctThreshold == null ? 'None' : `Ct < ${ctThreshold} (positives only)`;
    const locTag = names.length ? names.join('-') : 'all';
    const rangeTag = w ? `${ymd(w.lo)}_${ymd(w.hi)}` : (showBeyond ? `${ymd(t0)}_${ymd(effMaxMs)}` : 'full');
    const ctTag = ctThreshold == null ? '' : `_ct${ctThreshold}`;
    const filename = `sample-distribution_${locTag}_${rangeTag}${ctTag}`.replace(/[^\w.-]+/g, '_') + '.csv';
    return { location, timeRange, ct, filename };
  }

  // Confirmation dialog: shows what's being exported, lets the user edit the filename, downloads.
  let exportModal = null;
  function ensureExportModal() {
    if (exportModal) return exportModal;
    const overlay = document.createElement('div');
    overlay.className = 'export-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="export-modal" role="dialog" aria-modal="true" aria-label="Download sample distribution">
        <h4>Download data</h4>
        <dl class="export-summary">
          <dt>Location</dt><dd data-k="location"></dd>
          <dt>Time range</dt><dd data-k="time"></dd>
          <dt>Ct filter</dt><dd data-k="ct"></dd>
        </dl>
        <label class="export-filename">Filename<input type="text" spellcheck="false"></label>
        <div class="export-actions">
          <button type="button" class="export-cancel">Cancel</button>
          <button type="button" class="export-go">Download CSV</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => { overlay.style.display = 'none'; };
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.export-cancel').onclick = close;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.style.display !== 'none') close(); });
    exportModal = {
      overlay, close,
      val: (k) => overlay.querySelector(`[data-k="${k}"]`),
      input: overlay.querySelector('.export-filename input'),
      go: overlay.querySelector('.export-go'),
    };
    return exportModal;
  }
  function openExportDialog() {
    const m = ensureExportModal();
    const facts = exportFacts();
    const rows = exportRows();
    m.val('location').textContent = facts.location;
    m.val('time').textContent = facts.timeRange;
    m.val('ct').textContent = facts.ct;
    m.input.value = facts.filename;
    m.go.disabled = rows.length === 0;
    m.go.onclick = () => {
      let name = (m.input.value || '').trim() || 'sample-distribution';
      if (!/\.csv$/i.test(name)) name += '.csv';
      const blob = new Blob([buildCsvText(rows)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      m.close();
    };
    m.overlay.style.display = '';
    m.input.focus(); m.input.select();
  }
  const downloadEl = document.getElementById('dist-download');
  if (downloadEl) downloadEl.onclick = openExportDialog;
  const beyondEl = document.getElementById('dist-beyond');
  if (beyondEl) beyondEl.onclick = () => {
    showBeyond = !showBeyond;
    beyondEl.classList.toggle('active', showBeyond);
    beyondEl.textContent = showBeyond ? '←' : '→';   // → extend right · ← collapse back
    beyondEl.title = showBeyond ? 'Hide samples beyond the tree’s latest date'
                                : 'Show samples dated after the tree’s latest tip';
    applyExtent();
  };

  function filteredRows() {
    const names = mode === 'area' ? sel.areas : sel.zones;
    if (!names.length) return rows;                           // no selection → all
    const set = new Set(names.map(upper));
    const field = mode === 'area' ? 'health_area' : 'health_zone';
    return rows.filter(r => set.has(upper(r[field])));
  }

  // Samples the chart can't show for the current selection: undated, or dated outside
  // the tree window. (The map choropleth counts all of them, hence the difference.)
  const fmtDay = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  function updateNote() {
    if (!note) return;
    let after = 0, before = 0, undated = 0;
    const undByStatus = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0 };
    for (const r of filteredRows()) {
      if (!STATUS.includes(r.status)) continue;
      const t = +new Date(r.date);
      if (!r.date || isNaN(t)) { undated++; undByStatus[r.status]++; }
      else if (t > effMaxMs) after++;
      else if (t < t0) before++;
    }
    const total = after + before + undated;
    if (!total) { note.style.display = 'none'; note.textContent = ''; return; }
    const parts = [], plain = [];
    if (after)  { parts.push(`${after} after ${fmtDay(effMaxMs)}`); plain.push(`${after} after ${fmtDay(effMaxMs)}`); }
    if (before) { parts.push(`${before} before ${fmtDay(t0)}`);     plain.push(`${before} before ${fmtDay(t0)}`); }
    if (undated) {
      // Status breakdown of the undated samples (P/N/I/U), each integer in its bar colour.
      const bd = STATUS.map((s) => `<b style="color:${STATUS_COLOR[s]}">${undByStatus[s]}</b>`).join('/');
      parts.push(`${undated} undated (${bd})`);
      plain.push(`${undated} undated (${STATUS.map((s) => `${s[0]}:${undByStatus[s]}`).join(' ')})`);
    }
    note.innerHTML = `· ${total} not shown (${parts.join(', ')})`;
    note.title = `${total} samples not shown — ${plain.join(', ')}`;
    note.style.display = '';
  }

  // Summary card for the brushed window — recomputed in render(), so it tracks the window,
  // the location selection (filteredRows/filteredTips), the Ct filter (ctPass), and the
  // prioritisation allocation (allocation) automatically. Hidden when no window is set.
  function updateWindowSummary() {
    if (!win) { summary.style.display = 'none'; return; }
    const lo = Math.min(win.d0, win.d1), hi = Math.max(win.d0, win.d1);
    const inWin = (v) => { const t = +new Date(v); return !isNaN(t) && t >= lo && t <= hi; };

    // Test positivity within the window: positives / (positives + negatives), Ct-filtered.
    let pos = 0, neg = 0;
    for (const r of filteredRows()) {
      if (!inWin(r.date) || !ctPass(r, ctThreshold)) continue;
      if (r.status === 'Positive') pos++;
      else if (r.status === 'Negative') neg++;
    }
    const tested = pos + neg;
    const pct = tested ? Math.round((pos / tested) * 100) : null;

    // Sequences (tree tips) available in the window for the current selection.
    let seq = 0;
    for (const tp of filteredTips()) if (inWin(tp.date)) seq++;

    // Additional sequences the prioritisation would take in the window (only when Seq+ active).
    let toSeq = 0;
    if (allocation) {
      const m = allocByDate(allocOpts?.binWidthDays || 7, allocOpts?.origin || domain.minDate);
      for (const [day, n] of m) if (inWin(day)) toSeq += n;
    }

    const days = Math.max(1, Math.round((hi - lo) / 86400000));
    const lines = [`<div class="ws-range">${fmtDay(lo)} – ${fmtDay(hi)} · ${days} d</div>`];
    lines.push(`<div>${pct == null
      ? '<span class="ws-dim">no tests in range</span>'
      : `<b>${pct}%</b> positive <span class="ws-dim">(${pos}/${tested})</span>`}</div>`);
    // Append the proportion of (Ct-eligible) positives sequenced to the sequences line.
    const seqPct = pos ? Math.round((seq / pos) * 100) : null;
    lines.push(`<div class="ws-seq"><b>${seq}</b> existing sequence${seq === 1 ? '' : 's'}${seqPct == null ? '' : ` (${seqPct}% of +ve)`}</div>`);
    if (allocation) lines.push(`<div class="ws-alloc"><b>${toSeq}</b> to sequence next</div>`);
    summary.innerHTML = lines.join('');
    summary.style.display = '';
  }

  function aggregate() {
    const byDay = new Map();
    for (const r of filteredRows()) {
      const t = +new Date(r.date);
      if (isNaN(t) || t < t0 || t > effMaxMs) continue;      // clip to the (possibly extended) axis
      if (!STATUS.includes(r.status)) continue;
      if (!ctPass(r, ctThreshold)) continue;                 // Ct filter (positives only)
      let d = byDay.get(r.date);
      if (!d) { d = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0 }; byDay.set(r.date, d); }
      d[r.status]++;
    }
    return byDay;
  }

  // Sequences (tree tips) filtered by the same selection as the bars.
  function filteredTips() {
    const names = mode === 'area' ? sel.areas : sel.zones;
    if (!names.length) return tips;
    const set = new Set(names.map(upper));
    const field = mode === 'area' ? 'health_area' : 'health_zone';
    return tips.filter(t => set.has(upper(t[field])));
  }
  function seqByDate() {
    const m = new Map();
    for (const t of filteredTips()) {
      const ts = +new Date(t.date);
      if (isNaN(ts) || ts < t0 || ts > t1) continue;     // tree tips never post-date t1 (not effMaxMs)
      m.set(t.date, (m.get(t.date) || 0) + 1);
    }
    return m;
  }

  // To-sequence counts per date for the current selection (sum cellSummary.selected over
  // cells; in zone mode, restrict to the selected zones; map each bin to its midpoint date).
  function allocByDate(binWidthDays, origin) {
    if (!allocation) return new Map();
    const names = mode === 'area' ? sel.areas : sel.zones;
    const set = names.length ? new Set(names.map(upper)) : null;
    const m = new Map();
    for (const c of allocation) {
      if (!c.selected) continue;
      if (set && mode === 'zone' && !set.has(upper(c.location))) continue;   // zone-filtered
      const mid = +new Date(origin) + (c.timeBin + 0.5) * binWidthDays * 86400000;
      const day = new Date(mid).toISOString().slice(0, 10);
      m.set(day, (m.get(day) || 0) + c.selected);
    }
    return m;
  }

  function buildScale(W) {
    if (transform && transform.maxX > 0) {
      const x1 = transform.offsetX + transform.maxX * transform.scaleX;
      return scaleFromAnchors({ date0: domain.minDate, x0: transform.offsetX, date1: domain.maxDate, x1 });
    }
    return createTimeScale({ minDate: domain.minDate, maxDate: domain.maxDate, width: W, padLeft: PAD.left, padRight: PAD.right });
  }

  function drawMarkers() {
    if (!markerLayer) return;
    markerLayer.replaceChildren();
    for (const d of markerDates) {
      if (!d) continue;
      const x = scale.dateToX(d);
      markerLayer.appendChild(el('line', {
        x1: x, y1: PAD.top, x2: x, y2: H - PAD.bottom,
        stroke: SEQ_COLOR, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.5,
      }));
    }
  }

  function render() {
    const W = host.clientWidth || 400;
    H = host.clientHeight || 200;
    holder.replaceChildren();

    const svg = el('svg', { width: W, height: H });
    holder.appendChild(svg);

    scale = buildScale(W);
    const baseY = H - PAD.bottom;
    const xMin = scale.dateToX(domain.minDate);
    const dx = (d) => scale.dateToX(d);   // uniform scale; beyond-fill is handled by the tree fraction
    const xMax = dx(new Date(effMaxMs));   // extends past the tree when showBeyond

    const byDay = aggregate();
    seqMap = seqByDate();
    let yMax = 1;
    for (const d of byDay.values()) {
      const tot = d.Positive + d.Negative + d.Invalid + d.Unclassified;
      if (tot > yMax) yMax = tot;
    }
    // Reserve a band below the legend for the sequence-availability track and, when
    // prioritisation is active, the to-sequence allocation track beneath it (lowered with a
    // gap). The bars start below whichever tracks are shown so neither line crosses them.
    const alloc = allocByDate(allocOpts?.binWidthDays || 7, allocOpts?.origin || domain.minDate);
    allocMap = alloc;                                     // expose to the hover tooltip
    const trackY = PAD.top + 24;                          // sequence-availability track
    const allocY = seqMap.size ? trackY + 14 : trackY;   // to-sequence track (below, with a gap)
    const plotTop = (alloc.size ? allocY : trackY) + 8;
    const plotH = baseY - plotTop;
    const yToPx = (v) => baseY - (v / yMax) * plotH;
    const barW = Math.max(1, Math.abs(scale.dateToX(new Date(t0 + DAY_MS)) - xMin) - 1);

    for (const v of [...new Set([0, Math.round(yMax / 2), yMax])]) {
      const y = yToPx(v);
      svg.appendChild(el('line', { x1: PAD.left, y1: y, x2: xMax, y2: y, stroke: '#eee', 'stroke-width': 1 }));
      const lbl = el('text', { x: PAD.left - 4, y: y + 3, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'end' });
      lbl.textContent = String(v);
      svg.appendChild(lbl);
    }

    svg.appendChild(el('line', { x1: xMin, y1: baseY, x2: xMax, y2: baseY, stroke: '#c9c7c2', 'stroke-width': 1 }));
    for (const { date, fmt } of timeTicks(Math.abs(xMax - xMin), t0, effMaxMs)) {
      const tx = dx(date);
      if (tx < PAD.left - 1 || tx > W - 2) continue;        // keep labels inside the plot
      svg.appendChild(el('line', { x1: tx, y1: baseY, x2: tx, y2: baseY + 3, stroke: '#c9c7c2', 'stroke-width': 1 }));
      const lbl = el('text', { x: tx, y: baseY + 13, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'middle' });
      lbl.textContent = date.toLocaleDateString('en-GB', fmt);
      svg.appendChild(lbl);
    }

    // Brushed time-window band (behind the bars; persists across re-renders, tracks the scale).
    if (win) {
      const bx0 = dx(new Date(win.d0)), bx1 = dx(new Date(win.d1));
      svg.appendChild(el('rect', { x: Math.min(bx0, bx1), y: PAD.top, width: Math.max(1, Math.abs(bx1 - bx0)),
        height: baseY - PAD.top, fill: 'rgba(124,29,29,0.10)', stroke: 'rgba(124,29,29,0.45)', 'stroke-width': 1, 'pointer-events': 'none' }));
    }

    for (const [dateStr, counts] of byDay) {
      const x = dx(dateStr) - barW / 2;
      let top = baseY;
      for (const st of STATUS) {
        const c = counts[st];
        if (!c) continue;
        const h = (c / yMax) * plotH;
        svg.appendChild(el('rect', { x, y: top - h, width: barW, height: h, fill: STATUS_COLOR[st] }));
        top -= h;
      }
    }

    // Sequence-availability track: a dashed maroon line + circles sized by #sequences/day.
    // Hidden entirely when the current selection has no sequences.
    if (seqMap.size) {
      svg.appendChild(el('line', {
        x1: xMin, y1: trackY, x2: xMax, y2: trackY,
        stroke: SEQ_COLOR, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.5,
      }));
      for (const [dateStr, n] of seqMap) {
        const cx = dx(dateStr);
        if (cx < PAD.left - 1 || cx > W - 1) continue;
        const r = Math.min(6, 2 + 1.6 * Math.sqrt(n));
        svg.appendChild(el('circle', { cx, cy: trackY, r, fill: SEQ_COLOR, 'fill-opacity': 0.45 }));
      }
    }

    // To-sequence allocation track: a dashed teal-green line + circles sized by #to-sequence
    // per bin (selection-aware). Mirrors the sequence track, sat below it with a gap.
    if (alloc.size) {
      svg.appendChild(el('line', {
        x1: xMin, y1: allocY, x2: xMax, y2: allocY,
        stroke: ALLOC_COLOR, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.5,
      }));
      for (const [dateStr, k] of alloc) {
        const cx = dx(dateStr);
        if (cx < PAD.left - 1 || cx > W - 1) continue;
        const r = Math.min(6, 2 + 1.6 * Math.sqrt(k));
        svg.appendChild(el('circle', { cx, cy: allocY, r, fill: ALLOC_COLOR, 'fill-opacity': 0.55 }));
      }
    }

    markerLayer = el('g', {});
    svg.appendChild(markerLayer);
    drawMarkers();

    // transparent per-day hit-areas (full height: track + bars) drive the hover tooltip;
    // include sequence- and to-sequence-only dates so their circles are hoverable too.
    const dayPx = Math.abs(scale.dateToX(new Date(t0 + DAY_MS)) - xMin);
    for (const dateStr of new Set([...byDay.keys(), ...seqMap.keys(), ...allocMap.keys()])) {
      const counts = byDay.get(dateStr) || { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0 };
      const hit = el('rect', {
        x: dx(dateStr) - dayPx / 2, y: PAD.top,
        width: Math.max(2, dayPx), height: baseY - PAD.top, fill: 'transparent',
      });
      hit.addEventListener('mousemove', (ev) => showTip(ev, dateStr, counts));
      svg.appendChild(hit);
    }
    svg.addEventListener('mouseleave', hideTip);

    updateNote();
    updateWindowSummary();
  }

  // Horizontal brush: drag on the chart to pick a time window; a click (tiny drag) clears it.
  // Listeners live on `holder` (persistent) since the svg is rebuilt each render; a live <rect>
  // is drawn directly during the drag (no re-render), finalised on mouseup.
  let drag = null;   // { x0, rect } while dragging
  const relX = (ev) => ev.clientX - holder.getBoundingClientRect().left;
  holder.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0 || !scale) return;
    hideTip();
    const svgEl = holder.querySelector('svg');
    const rect = svgEl ? el('rect', { x: relX(ev), y: PAD.top, width: 0, height: H - PAD.bottom - PAD.top,
      fill: 'rgba(124,29,29,0.10)', stroke: 'rgba(124,29,29,0.45)', 'stroke-width': 1, 'pointer-events': 'none' }) : null;
    if (rect && svgEl) svgEl.appendChild(rect);
    drag = { x0: relX(ev), rect };
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const x = relX(ev), xl = Math.min(drag.x0, x), w = Math.abs(x - drag.x0);
    if (drag.rect) { drag.rect.setAttribute('x', xl); drag.rect.setAttribute('width', Math.max(0, w)); }
  });
  window.addEventListener('mouseup', (ev) => {
    if (!drag) return;
    const next = brushWindow(drag.x0, relX(ev), scale);
    drag = null;
    win = next;
    onWindowChange(next ? next.d0 : null, next ? next.d1 : null);
    render();   // draw the persistent band (or none) and drop the live rect
  });

  render();
  // On resize the width changes → calibration resets and the tree refits (→ setTransform), so
  // re-sync the fraction for the new width rather than just re-rendering at the stale one.
  const ro = new ResizeObserver(() => applyExtent());
  ro.observe(host);

  return {
    /** Set the Ct filter programmatically (from the map's Ct input). Mirrors the input
     *  display + re-renders; does NOT call onCtChange (the caller already applied it to the
     *  map), so the two inputs sync without an event loop. */
    setCtThreshold(t) {
      ctThreshold = (typeof t === 'number' && t > 0) ? t : null;
      ctInput.value = ctThreshold == null ? '' : String(ctThreshold);
      applyExtent();
    },
    setMarkers(dates) { markerDates = (dates || []).filter(Boolean); drawMarkers(); },
    setTransform(t) {
      transform = (t && t.maxX > 0) ? t : null;
      // Learn the tree's geometry at the fraction we last asked for, then re-evaluate the desired
      // fraction (the first beyond toggle sends f0, this second pass solves the corrected φ).
      if (transform) {
        recordCalib(lastF, transform);
        if (autoCorr < 4) { const prev = lastF; syncTreeFraction(); if (lastF !== prev) autoCorr++; }
      }
      render();
    },
    /** Set/clear the to-sequence allocation overlay (cellSummary[] + {binWidthDays, origin}, or null). */
    setAllocation(cs, opts) { allocation = cs; allocOpts = opts || null; render(); },
    /** Filter to a selection's health zones/areas. `{ zones:[], areas:[] }` ([] = all). */
    setSelection({ zones, areas } = {}) {
      sel = { zones: [...new Set(zones || [])], areas: [...new Set(areas || [])] };
      if (mode === 'area' && sel.areas.length === 0) mode = 'zone';   // no areas → fall back to zone
      updateToggleUI();
      applyExtent();
    },
  };
}
