// src/prio-scatter.js
// Interactive scatter for the prioritisation methodology page. One point per cell
// (zone × time-bin): y = risk/(h+δ) (intrinsic priority — high-risk & under-sequenced sit
// at the top), x = weight w = y·decay. Points on the dashed y=x reference line carry no
// recency penalty (λ = ∞); as λ shrinks, older cells slide left off the line. Top-N
// selected cells are green, the rest grey; point area ∝ available samples. Hover for detail.

const SVNS = 'http://www.w3.org/2000/svg';
const elem = (n, a) => { const e = document.createElementNS(SVNS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const PAD = { left: 40, right: 12, top: 12, bottom: 30 };
const H = 230;
const GREEN = '#205c4c', GREY = '#b9b6ae';
const DAY = 86400000;

export function createScatter(host) {
  const holder = document.createElement('div'); holder.className = 'ps-svg';
  const tip = document.createElement('div'); tip.className = 'ps-tip'; tip.style.display = 'none';
  host.append(holder, tip);
  let last = null;   // { cellSummary, params, opts } — kept so we can re-render on resize/tab-show

  const fmtDate = (origin, bin, binW) =>
    new Date(+new Date(origin) + (bin + 0.5) * binW * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  function render() {
    holder.replaceChildren();
    if (!last) return;
    const W = host.clientWidth || 0;
    if (W < 80) return;                         // hidden tab / not laid out yet — ResizeObserver re-fires later
    const { cellSummary, params, opts } = last;
    const svg = elem('svg', { width: W, height: H }); holder.appendChild(svg);

    const delta = params.delta;
    const pts = cellSummary.map((c) => {
      const h0 = c.hFinal - c.selected;         // history before this batch
      const cov = c.risk / (h0 + delta);        // risk / (h + δ)  → y
      return { c, h0, y: cov, x: cov * c.decay, sel: c.selected > 0, avail: c.available };
    });

    const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
    const x0 = PAD.left, yB = H - PAD.bottom;
    if (!pts.length) {
      const t = elem('text', { x: x0 + plotW / 2, y: PAD.top + plotH / 2, 'font-size': 11, fill: '#9c968b', 'text-anchor': 'middle' });
      t.textContent = 'No eligible cells for these parameters.'; svg.appendChild(t); return;
    }
    const maxV = (Math.max(...pts.map((p) => p.y)) || 1) * 1.06;
    const xPx = (v) => x0 + (v / maxV) * plotW;
    const yPx = (v) => yB - (v / maxV) * plotH;

    // axes
    svg.appendChild(elem('line', { x1: x0, y1: yB, x2: x0 + plotW, y2: yB, stroke: '#c9c7c2', 'stroke-width': 1 }));
    svg.appendChild(elem('line', { x1: x0, y1: yB, x2: x0, y2: PAD.top, stroke: '#c9c7c2', 'stroke-width': 1 }));
    // y = x reference diagonal (cells on it carry no recency penalty)
    svg.appendChild(elem('line', { x1: xPx(0), y1: yPx(0), x2: xPx(maxV), y2: yPx(maxV), stroke: '#bdbab2', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
    // axis labels
    const xl = elem('text', { x: x0 + plotW / 2, y: H - 7, 'font-size': 9.5, fill: '#7a756b', 'text-anchor': 'middle' });
    xl.textContent = 'weight  w  →'; svg.appendChild(xl);
    const yl = elem('text', { x: 11, y: PAD.top + plotH / 2, 'font-size': 9.5, fill: '#7a756b', 'text-anchor': 'middle', transform: `rotate(-90 11 ${PAD.top + plotH / 2})` });
    yl.textContent = 'risk / (h + δ)  →'; svg.appendChild(yl);

    // points: grey drawn first, green on top; area ∝ available
    const maxAvail = Math.max(...pts.map((p) => p.avail), 1);
    pts.sort((a, b) => a.sel - b.sel);
    for (const p of pts) {
      const r = 2 + 5 * Math.sqrt(p.avail / maxAvail);
      const dot = elem('circle', {
        cx: xPx(p.x), cy: yPx(p.y), r,
        fill: p.sel ? GREEN : GREY, 'fill-opacity': p.sel ? 0.72 : 0.4,
        stroke: p.sel ? '#143f33' : 'none', 'stroke-width': 0.7,
      });
      dot.addEventListener('mousemove', (ev) => showTip(ev, p));
      dot.addEventListener('mouseleave', hideTip);
      svg.appendChild(dot);
    }
  }

  function showTip(ev, p) {
    const c = p.c, o = last.opts || {};
    const when = o.origin ? fmtDate(o.origin, c.timeBin, o.binWidthDays || 1) : `bin ${c.timeBin}`;
    tip.innerHTML = `<div class="ps-tip-h">${c.location}</div>`
      + `<div>${when}</div>`
      + `<div>risk <b>${(+c.risk).toFixed(3)}</b> · h <b>${p.h0}</b> · avail <b>${p.avail}</b></div>`
      + `<div>w <b>${p.x.toFixed(3)}</b>${p.sel ? ` · <span style="color:${GREEN}">to&nbsp;sequence ${c.selected}</span>` : ''}</div>`;
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
    /** @param {Array} cellSummary  @param {object} params  @param {{origin?:string,binWidthDays?:number}} opts */
    update(cellSummary, params, opts) { last = { cellSummary, params, opts }; render(); },
  };
}
