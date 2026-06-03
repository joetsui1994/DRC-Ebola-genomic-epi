import { nodeToDate, MS_PER_YEAR } from './time-scale.js';

// Floating info card pinned to the tree panel. Shows details for the current
// selection — a single tip (id, date, location), or an internal node (its date +
// the 95% HPD uncertainty range). Auto-updates on selection, hides otherwise.

const real = (v) => (v && v !== 'null') ? v : null;
const fmtDate = (d) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/**
 * @param {string} containerId  element to pin the card inside (the tree panel)
 * @param {{mostRecentDate:string, canon?:(n:string)=>string}} ctx
 */
export function createNodeInfo(containerId, { mostRecentDate, canon = (v) => v } = {}) {
  const host = document.getElementById(containerId);
  const card = document.createElement('div');
  card.className = 'node-info';
  card.style.display = 'none';
  host.appendChild(card);

  // Pin the card just below PearTree's toolbar (top-left) so it never overlaps the
  // button groups — the toolbar's centre section can wrap, so measure it live.
  const positionTop = () => {
    const tb = host.querySelector('.pt-toolbar');
    const top = tb ? (tb.getBoundingClientRect().bottom - host.getBoundingClientRect().top + 8) : 50;
    card.style.top = `${Math.max(8, top)}px`;
  };
  requestAnimationFrame(positionTop);
  setTimeout(positionTop, 250);                 // after the embed settles
  new ResizeObserver(positionTop).observe(host); // re-pin when the toolbar wraps/resizes

  const row = (k, v) => (v ? `<div class="ni-row"><span class="ni-k">${k}</span><span class="ni-v">${v}</span></div>` : '');

  // The node-bar uncertainty: height_95%_HPD = [loHeight, hiHeight] (years). Larger
  // height = older = earlier date, so it maps to { lower: earliest, upper: latest }.
  function hpd(node) {
    const arr = node?.annotations?.['height_95%_HPD'];
    if (!Array.isArray(arr) || arr.length < 2) return null;
    const mr = +new Date(mostRecentDate);
    const lo = Math.min(arr[0], arr[1]), hi = Math.max(arr[0], arr[1]);
    if (hi === lo) return null;
    return {
      lower: fmtDate(new Date(mr - hi * MS_PER_YEAR)),   // earliest (older)
      upper: fmtDate(new Date(mr - lo * MS_PER_YEAR)),   // latest (younger)
    };
  }

  function renderTip(t) {
    const a = t.annotations || {};
    const coords = (real(a.lat) != null && real(a.lon) != null) ? `${(+a.lat).toFixed(3)}, ${(+a.lon).toFixed(3)}` : '';
    card.innerHTML =
      '<div class="ni-head">Leaf</div>' +
      `<div class="ni-title">${a.accession || t.name || t.id}</div>` +
      row('Date', fmtDate(nodeToDate(t, mostRecentDate))) +
      row('Health zone', real(a.health_zone) ? canon(a.health_zone) : '') +
      row('Health area', real(a.health_area)) +
      row('Coordinates', coords);
  }

  function renderNode(node) {
    const h = hpd(node);
    card.innerHTML =
      '<div class="ni-head">Internal node</div>' +
      `<div class="ni-title">${fmtDate(nodeToDate(node, mostRecentDate))}</div>` +
      (h ? row('95% HPD lower', h.lower) + row('95% HPD upper', h.upper) : '');
  }

  return {
    /** Update the card from an onSelect payload. */
    show({ target, selected }) {
      if (selected && selected.length === 1) { renderTip(selected[0]); card.style.display = ''; return; }
      if (target && !target.isTip) { renderNode(target); card.style.display = ''; return; }
      card.style.display = 'none';   // nothing selected, or a marker/zone group (no single node)
    },
    clear() { card.style.display = 'none'; },
  };
}
