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
    const zones = (opts.zones && opts.zones.length)
      ? opts.zones
      : [...new Set(cellSummary.map((c) => c.location))].sort();
    const nZones = zones.length;

    const plotH = Math.min(nZones * ROW_IDEAL, PLOT_MAX) || ROW_IDEAL;
    const H = PAD.top + PAD.bottom + plotH;
    const svg = elem('svg', { width: W, height: H }); holder.appendChild(svg);

    if (!cellSummary.length || !nZones) {
      const t = elem('text', { x: W / 2, y: H / 2, 'font-size': 11, fill: '#9c968b', 'text-anchor': 'middle' });
      t.textContent = 'No eligible cells for these parameters.'; svg.appendChild(t); return;
    }

    const bins = cellSummary.map((c) => c.timeBin);
    const minBin = Math.min(...bins), maxBin = Math.max(...bins);
    const nCols = maxBin - minBin + 1;
    const plotW = W - PAD.left - PAD.right;
    const colW = plotW / nCols, rowH = plotH / nZones;
    const rowIndex = new Map(zones.map((z, i) => [z, i]));
    const cellAt = new Map();
    const maxSel = Math.max(1, ...cellSummary.map((c) => c.selected));

    // Cells: faint for available-but-unselected, teal (∝ selected) for chosen.
    for (const c of cellSummary) {
      const ri = rowIndex.get(c.location); if (ri == null) continue;
      const ci = c.timeBin - minBin;
      cellAt.set(`${c.location}|${c.timeBin}`, c);
      const x = PAD.left + ci * colW, y = PAD.top + ri * rowH;
      const sel = c.selected > 0;
      svg.appendChild(elem('rect', {
        x: x + 0.3, y: y + 0.3, width: Math.max(0.5, colW - 0.6), height: Math.max(0.5, rowH - 0.6),
        fill: sel ? TEAL : AVAIL_FILL, 'fill-opacity': sel ? (0.3 + 0.7 * c.selected / maxSel) : 1,
      }));
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
    tip.innerHTML = `<div class="ps-tip-h">${titleCase(zone)}</div><div>${when}</div>`
      + (c
        ? `<div>avail <b>${c.available}</b> · risk <b>${(+c.risk).toFixed(3)}</b></div>`
          + `<div>h(k,τ) <b>${c.h0}</b> · H(k) <b>${c.Hk}</b></div>`
          + `<div><span style="color:${TEAL}">to sequence <b>${c.selected}</b></span>`
            + ((c.floorSelected > 0 && c.propSelected > 0)
              ? ` <span style="color:#9c968b">(floor ${c.floorSelected} + prop ${c.propSelected})</span>` : '')
            + `</div>`
        : '<div style="color:#9c968b">no samples</div>');
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
