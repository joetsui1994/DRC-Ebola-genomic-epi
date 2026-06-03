import { nodeToDate } from './time-scale.js';

// Wires the three panels. The active selection is either a TIP-SET (from the tree
// or map markers) or a ZONE (from a health-zone polygon); clicking one replaces the
// other. A selection drives: marker highlight, choropleth zone outline, the
// bar-chart zone/area filter, and the time-series date marker.

const real = (v) => (v && v !== 'null') ? v : null;
const up = (s) => (s || '').toUpperCase().trim();

/**
 * @param {object} tree   from createTreePanel
 * @param {object} map    from createMapPanel
 * @param {object} ts     from createTimeseriesPanel
 * @param {{mostRecentDate:string}} meta
 * @param {{id:string,health_zone:?string}[]} tips
 * @param {(name:string)=>string} [canon]  normalise a zone name to the canonical Nom
 * @param {{show:Function,clear:Function}} [nodeInfo]  floating node-info card
 */
export function startCoordinator(tree, map, ts, meta, tips = [], canon = (v) => v, nodeInfo = null) {
  const cz = (v) => { const r = real(v); return r ? canon(r) : null; };   // canonical zone, or null

  // zone (upper-cased canonical) → tip accessions/names in that zone, for highlighting
  // on a polygon click (so the polygon `Nom` matches the normalised annotation).
  const zoneToTipNames = new Map();
  for (const t of tips) {
    const z = cz(t.health_zone);
    if (!z) continue;
    const k = up(z);
    if (!zoneToTipNames.has(k)) zoneToTipNames.set(k, []);
    zoneToTipNames.get(k).push(t.id);
  }

  // Keep the time-series x-axis locked to the tree's live view transform.
  const seedTransform = tree.getViewTransform?.();
  if (seedTransform) ts.setTransform(seedTransform);
  tree.onViewChange?.((t) => ts.setTransform(t));

  let zoneSelecting = false;   // true while a polygon click drives a zone selection
  let programmatic = false;    // true while WE mutate the tree (vs. a direct tree click)
  let activeKey = null;        // key of the current map-initiated selection (for click-again-to-deselect)

  function clearAll() {
    activeKey = null;
    programmatic = true;
    tree.clear();              // onSelect (normal path) resets chart/outline/markers
    programmatic = false;
  }

  // map marker → select that group's tips (by accession/name); click again → deselect
  map.onMarkerClick((names) => {
    const key = 'tips:' + [...names].sort().join(',');
    if (key === activeKey) { clearAll(); return; }
    activeKey = key;
    programmatic = true;
    tree.selectByNames(names);
    programmatic = false;
  });
  map.onBackgroundClick(() => clearAll());

  // health-zone polygon → standalone zone selection (works even with no samples);
  // clicking the same zone again deselects it.
  map.onZoneClick((zoneName, opts = {}) => {
    const key = 'zone:' + up(zoneName);
    // a polygon click toggles; search (opts.toggle === false) always selects
    if (opts.toggle !== false && key === activeKey) { clearAll(); return; }
    activeKey = key;
    const names = zoneToTipNames.get(up(zoneName)) || [];
    zoneSelecting = true;
    programmatic = true;
    tree.clear();                                 // reset any prior tip selection
    if (names.length) tree.selectByNames(names);  // highlight this zone's tips + markers
    programmatic = false;
    zoneSelecting = false;
    // the zone itself is authoritative for the chart, outline and date marker
    ts.setMarkers([]);
    ts.setSelection({ zones: [zoneName], areas: [] });
    map.highlightZones([zoneName]);
  });

  // tree selection → map + choropleth + bar chart + date marker
  tree.onSelect(({ target, selected, mrca }) => {
    const tipNames = selected.map((n) => n.name);
    map.highlight(tipNames);                       // markers always reflect the tip set
    nodeInfo?.show({ target, selected });          // floating node-info card (any selection)
    if (zoneSelecting) return;                      // zone click drives chart/outline itself
    if (!programmatic) activeKey = null;            // a direct tree click is not a map-toggle target

    const node = target || mrca || null;
    const d = nodeToDate(node, meta.mostRecentDate);
    ts.setMarkers(d ? [d] : []);
    const zones = new Set(selected.map((n) => cz(n.annotations?.health_zone)).filter(Boolean));
    const areas = new Set(selected.map((n) => real(n.annotations?.health_area)).filter(Boolean));
    map.highlightZones([...zones]);
    ts.setSelection({ zones: [...zones], areas: [...areas] });
  });
}
