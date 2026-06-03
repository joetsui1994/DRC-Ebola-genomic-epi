import { createTimeScale, scaleFromAnchors } from './time-scale.js';

// "Sample distribution" panel: a stacked bar chart of line-list samples — one
// bar per day, segments by status. The x-axis is locked to the tree's view
// transform (stays aligned with the phylogeny regardless of the subset plotted);
// the y-axis rescales to the (filtered) data. A zone⇄area toggle controls whether
// a tip selection filters the line-list by health_zone or health_area.

const SVNS = 'http://www.w3.org/2000/svg';
const PAD = { left: 34, right: 20, top: 10, bottom: 22 };
const DAY_MS = 86400000;

const STATUS = ['Positive', 'Negative', 'Invalid', 'Unclassified'];
const STATUS_COLOR = {
  Positive:     '#9e2b2b',
  Negative:     '#6f9bbf',
  Invalid:      '#d8a86f',
  Unclassified: '#d3cfc8',
};

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
 */
export function createTimeseriesPanel(containerId, rows, domain) {
  const host = document.getElementById(containerId);
  host.replaceChildren();

  // zone⇄area toggle (top-left)
  const toggle = document.createElement('div');
  toggle.className = 'dist-toggle';
  const btnZone = document.createElement('button'); btnZone.textContent = 'Zone';
  const btnArea = document.createElement('button'); btnArea.textContent = 'Area';
  toggle.append(btnZone, btnArea);

  // status legend — sits to the right of the zone/area toggle (top-left)
  const legend = document.createElement('div');
  legend.className = 'dist-legend';
  legend.innerHTML = STATUS.map(s => `<span><i style="background:${STATUS_COLOR[s]}"></i>${s}</span>`).join('');

  const controls = document.createElement('div');   // top-left row: toggle + legend
  controls.className = 'dist-controls';
  controls.append(toggle, legend);

  const holder = document.createElement('div');
  holder.className = 'dist-svg';
  const tip = document.createElement('div');
  tip.className = 'dist-tip';
  tip.style.display = 'none';
  host.append(controls, holder, tip);   // tip on host (holder is wiped each render)

  function showTip(ev, dateStr, counts) {
    const d = new Date(dateStr);
    let html = `<div class="tip-date">${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</div>`;
    for (const st of STATUS) html += `<div class="tip-row"><i style="background:${STATUS_COLOR[st]}"></i>${st}<b>${counts[st]}</b></div>`;
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

  const t0 = +new Date(domain.minDate);
  const t1 = +new Date(domain.maxDate);

  function updateToggleUI() {
    btnZone.classList.toggle('active', mode === 'zone');
    btnArea.classList.toggle('active', mode === 'area');
    btnArea.disabled = sel.areas.length === 0;
    const names = mode === 'area' ? sel.areas : sel.zones;
    const level = mode === 'area' ? 'health area' : 'health zone';
    if (scopeEl) scopeEl.textContent = names.length ? `· ${names.join(', ')} (${level})` : '';
  }
  btnZone.onclick = () => { mode = 'zone'; updateToggleUI(); render(); };
  btnArea.onclick = () => { if (sel.areas.length === 0) return; mode = 'area'; updateToggleUI(); render(); };
  updateToggleUI();

  // Download the currently-shown aggregated daily counts as CSV.
  function downloadCsv() {
    const byDay = aggregate();
    const dates = [...byDay.keys()].sort();
    const lines = [['date', ...STATUS, 'total'].join(',')];
    for (const ds of dates) {
      const c = byDay.get(ds);
      const tot = STATUS.reduce((s, k) => s + c[k], 0);
      lines.push([ds, ...STATUS.map(k => c[k]), tot].join(','));
    }
    const scope = mode === 'area' ? sel.areas : sel.zones;
    const tag = (scope.length ? scope.join('-') : 'all').replace(/[^\w.-]+/g, '_');
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sample-distribution_${tag}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  const downloadEl = document.getElementById('dist-download');
  if (downloadEl) downloadEl.onclick = downloadCsv;

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
    for (const r of filteredRows()) {
      if (!STATUS.includes(r.status)) continue;
      const t = +new Date(r.date);
      if (!r.date || isNaN(t)) undated++;
      else if (t > t1) after++;
      else if (t < t0) before++;
    }
    const total = after + before + undated;
    if (!total) { note.style.display = 'none'; note.textContent = ''; return; }
    const parts = [];
    if (after) parts.push(`${after} after ${fmtDay(t1)}`);
    if (before) parts.push(`${before} before ${fmtDay(t0)}`);
    if (undated) parts.push(`${undated} undated`);
    note.textContent = `· ${total} not shown (${parts.join(', ')})`;
    note.title = `${total} samples not shown — ${parts.join(', ')}`;
    note.style.display = '';
  }

  function aggregate() {
    const byDay = new Map();
    for (const r of filteredRows()) {
      const t = +new Date(r.date);
      if (isNaN(t) || t < t0 || t > t1) continue;            // clip to the aligned axis
      if (!STATUS.includes(r.status)) continue;
      let d = byDay.get(r.date);
      if (!d) { d = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0 }; byDay.set(r.date, d); }
      d[r.status]++;
    }
    return byDay;
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
        stroke: '#3a3a38', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'stroke-opacity': 0.85,
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
    const xMax = scale.dateToX(domain.maxDate);

    const byDay = aggregate();
    let yMax = 1;
    for (const d of byDay.values()) {
      const tot = d.Positive + d.Negative + d.Invalid + d.Unclassified;
      if (tot > yMax) yMax = tot;
    }
    const plotH = H - PAD.top - PAD.bottom;
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
    for (const { date, fmt } of timeTicks(Math.abs(xMax - xMin), t0, t1)) {
      const tx = scale.dateToX(date);
      if (tx < PAD.left - 1 || tx > W - 2) continue;        // keep labels inside the plot
      svg.appendChild(el('line', { x1: tx, y1: baseY, x2: tx, y2: baseY + 3, stroke: '#c9c7c2', 'stroke-width': 1 }));
      const lbl = el('text', { x: tx, y: baseY + 13, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'middle' });
      lbl.textContent = date.toLocaleDateString('en-GB', fmt);
      svg.appendChild(lbl);
    }

    for (const [dateStr, counts] of byDay) {
      const x = scale.dateToX(dateStr) - barW / 2;
      let top = baseY;
      for (const st of STATUS) {
        const c = counts[st];
        if (!c) continue;
        const h = (c / yMax) * plotH;
        svg.appendChild(el('rect', { x, y: top - h, width: barW, height: h, fill: STATUS_COLOR[st] }));
        top -= h;
      }
    }

    markerLayer = el('g', {});
    svg.appendChild(markerLayer);
    drawMarkers();

    // transparent per-day hit-areas (full plot height) drive the hover tooltip
    const dayPx = Math.abs(scale.dateToX(new Date(t0 + DAY_MS)) - xMin);
    for (const [dateStr, counts] of byDay) {
      const hit = el('rect', {
        x: scale.dateToX(dateStr) - dayPx / 2, y: PAD.top,
        width: Math.max(2, dayPx), height: plotH, fill: 'transparent',
      });
      hit.addEventListener('mousemove', (ev) => showTip(ev, dateStr, counts));
      svg.appendChild(hit);
    }
    svg.addEventListener('mouseleave', hideTip);

    updateNote();
  }

  render();
  const ro = new ResizeObserver(() => render());
  ro.observe(host);

  return {
    setMarkers(dates) { markerDates = (dates || []).filter(Boolean); drawMarkers(); },
    setTransform(t) { transform = (t && t.maxX > 0) ? t : null; render(); },
    /** Filter to a selection's health zones/areas. `{ zones:[], areas:[] }` ([] = all). */
    setSelection({ zones, areas } = {}) {
      sel = { zones: [...new Set(zones || [])], areas: [...new Set(areas || [])] };
      if (mode === 'area' && sel.areas.length === 0) mode = 'zone';   // no areas → fall back to zone
      updateToggleUI();
      render();
    },
  };
}
