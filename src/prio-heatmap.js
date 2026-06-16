// src/prio-heatmap.js
// Zone × time-bin allocation matrix for the prioritisation page. Rows = candidate health zones
// (alphabetical), columns = time bins. Each candidate cell is drawn faintly; cells chosen to
// sequence fill teal (darker = more selected), updating live as the knobs change.
//
// Rows come from the Ct-UNFILTERED candidate universe (passed in via opts.zones), so the Ct knob
// only changes cell values, never the number of rows. There are too many zones to label, so the
// y-axis has no persistent labels: hover any cell for a tooltip + a row/column highlight and the
// hovered zone's name pinned at the left. Height is bounded; rows compress to fit when numerous.

const SVNS = 'http://www.w3.org/2000/svg';
const elem = (n, a) => { const e = document.createElementNS(SVNS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const PAD = { left: 8, right: 12, top: 4, bottom: 22 };
const TEAL = '#205c4c';
const AVAIL_FILL = '#dde7e2';   // candidate cell, nothing selected (the "░")
const EXIST = '#7c1d1d';        // existing-sequences band (maroon), matches the distribution panel's
                                // sequence circles; intensity ∝ phylogeny sequences in the cell
const EXIST_EMPTY = '#efece7';  // band placeholder when a cell has no prior sequences
const INPROG = '#c77d2e';       // in-process-of-being-sequenced band (amber); intensity ∝ in-process count
const DAY = 86400000;
const ROW_IDEAL = 14, PLOT_MAX = 320;   // grow rows to ~14px, then cap the plot height & compress

export function createHeatmap(host) {
  const holder = document.createElement('div'); holder.className = 'ps-svg';
  const tip = document.createElement('div'); tip.className = 'ps-tip'; tip.style.display = 'none';
  host.append(holder, tip);
  let last = null;   // { cellSummary, params, opts } — kept so we can re-render on resize/tab-show

  // Engine locations are upper-case canonical Noms; show them title-cased (hyphens/spaces = breaks).
  const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  const fmtDate = (origin, bin, binW) =>
    new Date(+new Date(origin) + (bin + 0.5) * binW * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  function render() {
    holder.replaceChildren();
    if (!last) return;
    const W = host.clientWidth || 0;
    if (W < 80) return;                          // hidden tab / not laid out yet — ResizeObserver re-fires later
    const { cellSummary, opts } = last;
    const binW = opts.binWidthDays || 1, origin = opts.origin;
    // Existing phylogeny sequences per cell — drawn even where there is no candidate this batch,
    // so a location/date with sequences but nothing to sequence still shows its maroon band.
    const existing = opts.existing || new Map();
    const inProgress = opts.inProgress || new Map();
    const splitKey = (key) => { const i = key.lastIndexOf('|'); return { location: key.slice(0, i), timeBin: +key.slice(i + 1) }; };
    const toCells = (m) => { const out = []; for (const [key, count] of m) { if (count > 0) out.push({ ...splitKey(key), count }); } return out; };
    const existCells = toCells(existing);
    const inProgCells = toCells(inProgress);

    const baseZones = (opts.zones && opts.zones.length) ? opts.zones : cellSummary.map((c) => c.location);
    const zones = [...new Set([...baseZones, ...existCells.map((e) => e.location), ...inProgCells.map((e) => e.location)])].sort();
    const nZones = zones.length;

    const plotH = Math.min(nZones * ROW_IDEAL, PLOT_MAX) || ROW_IDEAL;
    const H = PAD.top + PAD.bottom + plotH;
    const svg = elem('svg', { width: W, height: H }); holder.appendChild(svg);

    if ((!cellSummary.length && !existCells.length) || !nZones) {
      const t = elem('text', { x: W / 2, y: H / 2, 'font-size': 11, fill: '#9c968b', 'text-anchor': 'middle' });
      t.textContent = 'No eligible cells for these parameters.'; svg.appendChild(t); return;
    }

    const bins = [...cellSummary.map((c) => c.timeBin), ...existCells.map((e) => e.timeBin), ...inProgCells.map((e) => e.timeBin)];
    const minBin = Math.min(...bins), maxBin = Math.max(...bins);
    const nCols = maxBin - minBin + 1;
    const plotW = W - PAD.left - PAD.right;
    const colW = plotW / nCols, rowH = plotH / nZones;
    const rowIndex = new Map(zones.map((z, i) => [z, i]));
    const cellAt = new Map();
    const maxSel = Math.max(1, ...cellSummary.map((c) => c.selected));
    const maxExist = Math.max(1, ...existCells.map((e) => e.count));
    const maxInProg = Math.max(1, ...inProgCells.map((e) => e.count));
    const candAt = new Map(cellSummary.map((c) => [`${c.location}|${c.timeBin}`, c]));
    const drawKeys = new Set([...candAt.keys(),
      ...existCells.map((e) => `${e.location}|${e.timeBin}`),
      ...inProgCells.map((e) => `${e.location}|${e.timeBin}`)]);

    // Each cell stacks three boxes (same width): a shorter TOP band for sequences already in the
    // phylogeny (maroon ∝ count), a thin MIDDLE band for samples in the process of being sequenced
    // (amber ∝ count), and a BOTTOM box for this batch's allocation (faint if unselected, teal ∝
    // selected). History-only cells (sequences/in-process but no candidate this batch) still draw
    // their bands. The two thin bands always reserve their height so the teal boxes line up.
    for (const key of drawKeys) {
      const i = key.lastIndexOf('|');
      const location = key.slice(0, i), timeBin = +key.slice(i + 1);
      const ri = rowIndex.get(location); if (ri == null) continue;
      const ci = timeBin - minBin;
      const x = PAD.left + ci * colW, y = PAD.top + ri * rowH;
      const cw = Math.max(0.5, colW - 0.6);
      const totalH = Math.max(0.5, rowH - 0.6);
      const existH = Math.min(totalH * 0.28, 4);                    // shorter top band (phylogeny)
      const inProgH = Math.min(totalH * 0.20, 3);                   // thin middle band (in-process)
      const allocH = Math.max(0.5, totalH - existH - inProgH - 1.2); // two 0.6 gaps
      const c = candAt.get(key) || null;
      const ex = existing.get(key) || 0;
      const ip = inProgress.get(key) || 0;
      // top band: maroon ∝ existing sequences; faint placeholder for candidate cells with none.
      if (ex > 0 || c) {
        svg.appendChild(elem('rect', {
          x: x + 0.3, y: y + 0.3, width: cw, height: existH,
          fill: ex > 0 ? EXIST : EXIST_EMPTY, 'fill-opacity': ex > 0 ? (0.3 + 0.7 * ex / maxExist) : 1,
        }));
      }
      // middle band: amber ∝ in-process count (drawn only where present; slot is always reserved).
      if (ip > 0) {
        svg.appendChild(elem('rect', {
          x: x + 0.3, y: y + 0.3 + existH + 0.6, width: cw, height: inProgH,
          fill: INPROG, 'fill-opacity': 0.3 + 0.7 * ip / maxInProg,
        }));
      }
      // bottom box: this batch's allocation — only where there is a candidate.
      if (c) {
        cellAt.set(key, c);
        const sel = c.selected > 0;
        svg.appendChild(elem('rect', {
          x: x + 0.3, y: y + 0.3 + existH + inProgH + 1.2, width: cw, height: allocH,
          fill: sel ? TEAL : AVAIL_FILL, 'fill-opacity': sel ? (0.3 + 0.7 * c.selected / maxSel) : 1,
        }));
      }
    }

    // x-axis date ticks (~6 across the span).
    const nTicks = Math.min(6, nCols);
    for (let k = 0; k < nTicks; k++) {
      const ci = Math.round((k / (nTicks - 1 || 1)) * (nCols - 1));
      const x = PAD.left + (ci + 0.5) * colW;
      svg.appendChild(elem('line', { x1: x, y1: PAD.top + plotH, x2: x, y2: PAD.top + plotH + 3, stroke: '#c9c7c2', 'stroke-width': 1 }));
      const lbl = elem('text', { x, y: H - 7, 'font-size': 9, fill: '#9c968b', 'text-anchor': 'middle' });
      lbl.textContent = origin ? fmtDate(origin, minBin + ci, binW) : `bin ${minBin + ci}`;
      svg.appendChild(lbl);
    }

    // Hover crosshair: row + column highlight, drawn on top. Zone name lives in the tooltip only.
    const colHi = elem('rect', { x: PAD.left, y: PAD.top, width: colW, height: plotH, fill: '#000', 'fill-opacity': 0.05, display: 'none', 'pointer-events': 'none' });
    const rowHi = elem('rect', { x: PAD.left, y: PAD.top, width: plotW, height: rowH, fill: '#000', 'fill-opacity': 0.06, display: 'none', 'pointer-events': 'none' });
    svg.append(colHi, rowHi);

    const hideHover = () => { hideTip(); colHi.setAttribute('display', 'none'); rowHi.setAttribute('display', 'none'); };
    svg.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const ci = Math.floor((ev.clientX - r.left - PAD.left) / colW);
      const ri = Math.floor((ev.clientY - r.top - PAD.top) / rowH);
      if (ri < 0 || ri >= nZones || ci < 0 || ci >= nCols) { hideHover(); return; }
      const zone = zones[ri], bin = minBin + ci;
      colHi.setAttribute('x', PAD.left + ci * colW); colHi.setAttribute('display', '');
      rowHi.setAttribute('y', PAD.top + ri * rowH); rowHi.setAttribute('display', '');
      showTip(ev, zone, bin, cellAt.get(`${zone}|${bin}`), origin, binW);
    });
    svg.addEventListener('mouseleave', hideHover);
  }

  function showTip(ev, zone, bin, c, origin, binW) {
    const when = origin ? fmtDate(origin, bin, binW) : `bin ${bin}`;
    const ex = last && last.opts && last.opts.existing ? (last.opts.existing.get(`${zone}|${bin}`) || 0) : 0;
    const ip = last && last.opts && last.opts.inProgress ? (last.opts.inProgress.get(`${zone}|${bin}`) || 0) : 0;
    // No-candidate cells mirror the candidate layout: 0 avail / 0 to sequence, with the zone's
    // risk (per-location, constant in time) pulled from the risk map.
    const riskVal = c ? c.risk : (last && last.opts && last.opts.risk ? last.opts.risk.get(zone) : undefined);
    const avail = c ? c.available : 0;
    const sel = c ? c.selected : 0;
    tip.innerHTML = `<div class="ps-tip-h">${titleCase(zone)}</div><div>${when}</div>`
      + `<div><b>${avail}</b> avail · risk <b>${riskVal == null ? '—' : (+riskVal).toFixed(3)}</b></div>`
      + `<div><span style="color:${EXIST}"><b>${ex}</b> existing sequence${ex === 1 ? '' : 's'}</span></div>`
      + (ip > 0 ? `<div><span style="color:${INPROG}"><b>${ip}</b> in sequencing</span></div>` : '')
      + `<div><span style="color:${TEAL}"><b>${sel}</b> to sequence next</span>`
        + ((c && c.floorSelected > 0 && c.propSelected > 0)
          ? ` <span style="color:#9c968b">(floor ${c.floorSelected} + prop ${c.propSelected})</span>` : '')
        + `</div>`;
    tip.style.display = 'block';
    const rect = host.getBoundingClientRect();
    let left = ev.clientX - rect.left + 12;
    if (left + tip.offsetWidth > rect.width) left = rect.width - tip.offsetWidth - 4;
    tip.style.left = `${Math.max(2, left)}px`;
    tip.style.top = `${ev.clientY - rect.top + 12}px`;
  }
  const hideTip = () => { tip.style.display = 'none'; };

  new ResizeObserver(() => render()).observe(host);

  return {
    /** @param {Array} cellSummary  @param {object} params  @param {{origin?:string,binWidthDays?:number,zones?:string[]}} opts */
    update(cellSummary, params, opts) { last = { cellSummary, params, opts }; render(); },
  };
}
