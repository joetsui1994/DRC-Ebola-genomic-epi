import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { buildKnobs, buildSeedControl } from './prio-knobs.js';
import { tallyZones } from './zone-tally.js';

// Leaflet map. Markers are built from the tips themselves: tips are grouped by
// health_area when present, else by health_zone, and placed at the tips' lat/lon
// (area centroid, or zone centroid for area-less tips). Clicking a marker emits
// that group's tip ids. A standalone risk choropleth sits underneath, and the
// selected tips' zone polygons can be outlined.

const BASE_STYLE      = { color: '#33567a', fillColor: '#5b86b3', fillOpacity: 0.85, weight: 1.5 }; // muted blue
const HIGHLIGHT_STYLE = { color: '#9a7a16', fillColor: '#f2c84b', fillOpacity: 0.95, weight: 2 };   // yellow (selected)
const HIDDEN_STYLE    = { opacity: 0, fillOpacity: 0 };   // marker filtered out by the time window

const RISK_RAMP   = ['#f6e3df', '#e8b3a6', '#d08163', '#aa4a32', '#7c1d1d'];   // risk + total
const RISK_NODATA = '#e8e6e1';
const TOSEQ_RAMP = ['#e7eef0', '#bcd4c9', '#86b8a0', '#4f8f78', '#205c4c'];   // "to sequence" (teal-green)
// Per-status sequential ramps (light → dark) keyed on the bar-chart status hues,
// extended into a saturated dark end so all 5 classes stay distinct even for the
// pale tan/grey statuses.
const STATUS_RAMP = {
  Positive:     ['#f7dcd6', '#e3998c', '#cc5a48', '#a83327', '#741a1a'],
  Negative:     ['#dbe7f0', '#a9c5db', '#6f9bbf', '#3f6f99', '#1f456e'],
  Invalid:      ['#f4e6d2', '#e6c79b', '#d39e5f', '#a8742f', '#6f4718'],
  Unclassified: ['#ededeb', '#cbc6bd', '#a39c8f', '#6f685c', '#403b31'],
};
const COUNT_NODATA = '#eeece6';   // zones with 0 samples
const ZONE_STROKE_ON  = { color: '#ffffff', weight: 0.4 };              // boundaries while choropleth shown
const ZONE_STROKE_OFF = { color: 'rgba(60,48,36,0.28)', weight: 0.6 };  // faint boundaries while risk hidden
const ZONE_STROKE_SEL = { color: '#7c1d1d', weight: 2.6 };             // selected-zone outline (maroon)

const upper = (s) => (s || '').toUpperCase().trim();
const realVal = (v) => (v && v !== 'null') ? v : null;

function quantileBreaks(values, classes) {
  const s = [...values].sort((a, b) => a - b);
  const breaks = [];
  for (let i = 1; i < classes; i++) breaks.push(s[Math.floor((i / classes) * s.length)]);
  return breaks;
}
// Evenly-spaced breaks over the VALUE range [min, max] — gives the high end its own
// classes regardless of how the data is distributed (vs quantiles, which collapse a
// sparse high tail into one class on right-skewed data like relative risk).
function equalIntervalBreaks(min, max, classes) {
  const breaks = [];
  for (let i = 1; i < classes; i++) breaks.push(min + (i / classes) * (max - min));
  return breaks;
}
function classIndex(v, breaks) {
  let i = 0;
  while (i < breaks.length && v >= breaks[i]) i++;
  return i;
}

// ── Mobility arrows ──
const MOB_OUT = '#b23b2e';            // outflow / export (leaving the selected zone)
const MOB_IN  = '#2f6f9f';            // inflow / import  (arriving at the selected zone)
const MOB_TOPN = 20;                  // per zone, per direction — cap to stay readable
const MOB_VMIN = 15, MOB_VMAX = 12000;

function mobNorm(v) {                  // log-normalise a flow volume to 0..1
  const c = Math.max(MOB_VMIN, Math.min(MOB_VMAX, v));
  return (Math.log(c) - Math.log(MOB_VMIN)) / (Math.log(MOB_VMAX) - Math.log(MOB_VMIN));
}
const mobWeight  = (v) => 1 + mobNorm(v) * 5;       // 1..6 px
const mobOpacity = (v) => 0.3 + mobNorm(v) * 0.55;  // 0.30..0.85

// Quadratic-bézier samples between two centroids, bowed to the LEFT of travel so
// a→b and b→a curve on opposite sides. lat/lng treated as planar (fine near 0° lat).
function bezierPts(a, b, N = 22) {
  const ax = a.lng, ay = a.lat, bx = b.lng, by = b.lat;
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1, k = 0.15;
  const cx = (ax + bx) / 2 + (-dy / len) * len * k;
  const cy = (ay + by) / 2 + (dx / len) * len * k;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t;
    pts.push(L.latLng(u * u * ay + 2 * u * t * cy + t * t * by, u * u * ax + 2 * u * t * cx + t * t * bx));
  }
  return pts;
}
// Arrowhead triangle (as a 3-point polyline) at pEnd, oriented along pPrev→pEnd.
function arrowHead(pPrev, pEnd, size) {
  const dx = pEnd.lng - pPrev.lng, dy = pEnd.lat - pPrev.lat, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, baseX = pEnd.lng - ux * size, baseY = pEnd.lat - uy * size;
  const px = -uy, py = ux, wing = size * 0.55;
  return [L.latLng(baseY + py * wing, baseX + px * wing), L.latLng(pEnd.lat, pEnd.lng), L.latLng(baseY - py * wing, baseX - px * wing)];
}

/**
 * @param {string} containerId
 * @param {{id:string,health_zone:?string,health_area:?string,lat:?number,lon:?number}[]} tips
 */
export function createMapPanel(containerId, tips, { onCtChange = () => {} } = {}) {
  const map = L.map(containerId, { zoomControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);

  // group tips: key = health_area (if present) else health_zone
  const groups = new Map();           // key -> { key, lat, lon, tipIds }
  for (const t of tips) {
    if (t.lat == null || t.lon == null) continue;
    const area = realVal(t.health_area);
    const key = area || realVal(t.health_zone);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) { g = { key, level: area ? 'area' : 'zone', lat: t.lat, lon: t.lon, tipIds: [], dates: [] }; groups.set(key, g); }
    g.tipIds.push(t.id); g.dates.push(t.date);
  }

  const markers = [];                 // { group, marker }
  const latlngs = [];
  for (const g of groups.values()) {
    const m = L.circleMarker([g.lat, g.lon], {
      ...BASE_STYLE, radius: 6 + 3 * Math.sqrt(g.tipIds.length), bubblingMouseEvents: false,
    }).addTo(map).bindTooltip(`${g.key} (health ${g.level}) · ${g.tipIds.length}`);
    markers.push({ group: g, marker: m });
    latlngs.push([g.lat, g.lon]);
  }
  const fit = () => { if (latlngs.length) map.fitBounds(latlngs, { padding: [30, 30] }); };

  let clickHandler = null;
  let bgHandler = null;
  for (const { group, marker } of markers) marker.on('click', () => { if (!group._winHidden && clickHandler) clickHandler(group.tipIds); });
  map.on('click', () => bgHandler && bgHandler());   // empty-map click → deselect

  // Leaflet needs a sized container; Safari resolves the flex/absolute layout
  // late, so defer the first size+fit (with a fallback) and keep it sized.
  const sizeAndFit = () => { map.invalidateSize(); fit(); };
  requestAnimationFrame(sizeAndFit);
  setTimeout(sizeAndFit, 200);
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(document.getElementById(containerId));

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML =
      '<span><i style="background:#5b86b3;border-color:#33567a"></i>Location</span>' +
      '<span><i style="background:#f2c84b;border-color:#9a7a16"></i>Selected</span>';
    return div;
  };
  legend.addTo(map);

  // ── Health-zone layer: risk choropleth + clickable selection ──
  // One always-present, always-clickable GeoJSON layer; its style follows state
  // (risk colour on/off, selected outline) so zones stay selectable even when the
  // choropleth colour is toggled off.
  let zoneLayer = null, metric = 'risk', METRICS = null;   // current choropleth metric + definitions
  let choroLegend = null, choroLegendDiv = null;
  let ctThreshold = null;            // Ct filter for the Positive metric (null = off)
  let zonePosCt = new Map();         // upper Nom → positive-sample Ct values (for live re-counting)
  let zoneCounts = new Map();        // upper Nom → {status counts} (dynamic; windowed by the brush)
  let linelistRows = [];             // retained for windowed re-tally (set in addZoneLayer)
  let applyCounts = null;            // recompute breaks + redraw after a re-tally (set in addZoneLayer)
  let applyCtThreshold = null;       // recompute Positive metric + redraw (set in addZoneLayer)
  let toSeqByZone = new Map();       // upper Nom -> to-sequence count (prioritisation)
  let applyToSeq = null;             // recompute "To sequence" metric + redraw (set in addZoneLayer)
  let prioKnobsCtl = null;           // on-map δ/β/N/Ct/bin knobs control (prioritisation)
  let mapKnobsRefresh = null;        // re-sync the on-map knob sliders to the shared params
  let prioRef = null;                // the prioritisation panel (set in attachPrioKnobs)
  // Prioritisation is "on" exactly when the chosen choropleth metric is "To sequence":
  // selecting it shows the knobs + asks the panel to compute; leaving it hides + clears.
  function setPrio(on) {
    if (prioKnobsCtl) { if (on) prioKnobsCtl.addTo(map); else prioKnobsCtl.remove(); }
    prioRef?.setActive(on);
  }
  const selectedZones = new Set();   // upper-cased Nom of currently-selected zones
  const nameToLayer = new Map();     // upper-cased Nom → polygon layer (for search-and-zoom)
  const nameToCentroid = new Map();  // upper-cased Nom → L.LatLng (for mobility arrows)
  let zoneClickHandler = null;

  // Mobility-arrow state (drawn for the selected zone when the layer is toggled on).
  let mobility = null, mobilityGroup = null, mobLegend = null;
  let mobilityOn = false;
  let mobilitySel = [];               // zone names currently driving the arrows

  function styleFor(f) {
    const sel = selectedZones.has(upper(f.properties.Nom));
    let fill;
    if (metric === 'off' || !METRICS) {
      fill = { fillColor: '#000000', fillOpacity: 0 };          // hidden: faint boundaries only
    } else {
      const cfg = METRICS[metric];
      const v = cfg.value(f);
      if (cfg.kind === 'count') {
        fill = (v > 0)
          ? { fillColor: cfg.ramp[classIndex(v, cfg.breaks)], fillOpacity: 0.62 }
          : { fillColor: COUNT_NODATA, fillOpacity: 0.4 };       // 0 samples
      } else {
        fill = (typeof v === 'number')
          ? { fillColor: cfg.ramp[classIndex(v, cfg.breaks)], fillOpacity: 0.6 }
          : { fillColor: RISK_NODATA, fillOpacity: 0.5 };
      }
    }
    const stroke = sel ? ZONE_STROKE_SEL : (metric === 'off' ? ZONE_STROKE_OFF : ZONE_STROKE_ON);
    return { ...fill, ...stroke };
  }
  function restyle() {
    if (!zoneLayer) return;
    zoneLayer.setStyle(styleFor);
    zoneLayer.eachLayer((l) => { if (selectedZones.has(upper(l.feature?.properties?.Nom))) l.bringToFront(); });
  }

  function drawFlow(fromC, toC, value, dir) {
    if (!fromC || !toC) return;
    const pts = bezierPts(fromC, toC);
    const color = dir === 'out' ? MOB_OUT : MOB_IN;
    const w = mobWeight(value), op = mobOpacity(value);
    const opts = { pane: 'mobilityPane', color, weight: w, lineJoin: 'round', lineCap: 'round', interactive: false };
    mobilityGroup.addLayer(L.polyline(pts, { ...opts, opacity: op }));
    // Arrowhead on OUTflows only (red): inflows read from colour + convergence on the
    // hub, and inflow heads would just pile up messily at the centre. Size tracks flow
    // weight (not distance, which gave huge heads), capped so short flows don't overshoot.
    if (dir === 'out') {
      const d = Math.hypot(toC.lng - fromC.lng, toC.lat - fromC.lat);
      const size = Math.min(0.015 + (w / 6) * 0.025, d * 0.4);
      mobilityGroup.addLayer(L.polyline(arrowHead(pts[pts.length - 2], pts[pts.length - 1], size), { ...opts, opacity: Math.min(1, op + 0.2) }));
    }
  }
  // Resolve a flow-partner name to a centroid, handling "Name (Province)" suffixes
  // that disambiguate duplicate zone names in the geojson (e.g. "Bili (Bas-Uele)").
  function centroidFor(name) {
    const m = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(name || '');
    if (m) return nameToCentroid.get(`${upper(m[1])}|${upper(m[2])}`) || nameToCentroid.get(upper(m[1]));
    return nameToCentroid.get(upper(name));
  }
  // Redraw arrows for the currently-selected zone(s): outflows (red) + inflows (blue).
  function drawMobility() {
    if (mobilityGroup) mobilityGroup.clearLayers();
    if (!mobilityOn || !mobility || !mobilityGroup) return;
    for (const z of mobilitySel) {
      const hubKey = upper(z);
      const hubC = nameToCentroid.get(hubKey);
      if (!hubC) continue;
      const top = (arr) => (arr || []).slice().sort((a, b) => b.value - a.value).slice(0, MOB_TOPN);
      for (const f of top(mobility.outByZone.get(hubKey))) drawFlow(hubC, centroidFor(f.other), f.value, 'out');
      for (const f of top(mobility.inByZone.get(hubKey)))  drawFlow(centroidFor(f.other), hubC, f.value, 'in');
    }
  }

  // Zoom to a zone's polygon and select it (always selects, never toggles off).
  // `province` disambiguates duplicate Noms (Bili, Lubunga) to the right polygon.
  function selectZoneByName(name, province) {
    const layer = (province && nameToLayer.get(`${upper(name)}|${upper(province)}`)) || nameToLayer.get(upper(name));
    if (!layer) return;
    map.fitBounds(layer.getBounds(), { maxZoom: 9, padding: [24, 24] });
    if (zoneClickHandler) zoneClickHandler(name, { toggle: false });
  }

  // Map-header Ct filter (mirrors the distribution panel's). Shown only on the Map tab while
  // the Positive metric is selected. Two-way synced with the distribution input via
  // onCtChange ⇄ setCtThreshold — each sets the other's value programmatically (which does
  // NOT fire an 'input' event), so there is no sync loop.
  const mapCtWrap = document.getElementById('map-ct');
  const mapCtInput = mapCtWrap?.querySelector('input');
  let onMapTab = true;
  function updateCtVisibility() {
    if (mapCtWrap) mapCtWrap.style.display = (onMapTab && metric === 'Positive') ? '' : 'none';
  }
  mapCtInput?.addEventListener('input', () => {
    const v = parseInt(mapCtInput.value, 10);
    ctThreshold = (Number.isFinite(v) && v > 0) ? v : null;
    applyCtThreshold?.();       // recolour the Positive choropleth
    onCtChange(ctThreshold);    // mirror into the distribution panel's Ct input
  });

  // Map / Prioritisation tab switch. Returning to the map re-sizes Leaflet.
  const mapBody = document.getElementById('map-body');
  const prioBody = document.getElementById('prio-body');
  const tabMap = document.getElementById('tab-map');
  const tabPrio = document.getElementById('tab-prio');
  function showTab(which) {
    const onMap = which === 'map';
    mapBody.style.display = onMap ? '' : 'none';
    prioBody.style.display = onMap ? 'none' : '';
    tabMap?.classList.toggle('active', onMap);
    tabPrio?.classList.toggle('active', !onMap);
    // Each knob strip is rebuilt/refreshed when its tab is shown, so the two never disagree
    // (they're never on screen together, so on-show sync is enough).
    if (onMap) { requestAnimationFrame(() => map.invalidateSize()); mapKnobsRefresh?.(); }
    else prioRef?.refreshKnobs?.();
    onMapTab = onMap; updateCtVisibility();   // hide the Ct input off the Map tab
  }
  tabMap?.addEventListener('click', () => showTab('map'));
  tabPrio?.addEventListener('click', () => showTab('prio'));

  return {
    /** cb(tipIds[]) when a marker is clicked. */
    onMarkerClick(cb) { clickHandler = cb; },
    /** cb() when the empty map background is clicked (deselect). */
    onBackgroundClick(cb) { bgHandler = cb; },
    /** Highlight markers whose group contains any of the selected tip ids. */
    highlight(selectedTipIds) {
      const sel = new Set(selectedTipIds);
      for (const { group, marker } of markers) {
        if (group._winHidden) { marker.setStyle(HIDDEN_STYLE); continue; }   // window-hidden stays hidden
        marker.setStyle(group.tipIds.some(id => sel.has(id)) ? HIGHLIGHT_STYLE : BASE_STYLE);
      }
    },
    clearHighlight() { for (const { group, marker } of markers) marker.setStyle(group._winHidden ? HIDDEN_STYLE : BASE_STYLE); },

    /** Outline the zone polygons for the given health-zone names (+ refresh mobility). */
    highlightZones(zoneNames) {
      selectedZones.clear();
      for (const n of (zoneNames || [])) selectedZones.add(upper(n));
      restyle();
      mobilitySel = (zoneNames || []).slice();
      drawMobility();
    },
    /** cb(zoneName) when a health-zone polygon is clicked. */
    onZoneClick(cb) { zoneClickHandler = cb; },

    /** Set the Ct filter applied to the Positive metric (null/0 = off). Also mirrors the
     *  value into the map-header Ct input (the distribution panel drives this). */
    setCtThreshold(t) {
      ctThreshold = (typeof t === 'number' && t > 0) ? t : null;
      if (mapCtInput) mapCtInput.value = ctThreshold == null ? '' : String(ctThreshold);
      applyCtThreshold?.();
    },

    /** Update per-zone to-sequence counts (upper Nom -> count) and redraw if shown. */
    setToSequence(byZone) { toSeqByZone = byZone || new Map(); applyToSeq?.(); },

    /** Filter the choropleth + markers to a time window (inclusive ms bounds), or null = all.
     *  Re-tallies the line-list rows, reclasses, and shows/resizes markers by in-window count. */
    setDateWindow(d0, d1) {
      const win = (d0 != null && d1 != null) ? { d0: +d0, d1: +d1 } : null;
      const tally = tallyZones(linelistRows, win);
      zoneCounts = tally.zoneCounts; zonePosCt = tally.zonePosCt;
      applyCounts?.();
      for (const { group, marker } of markers) {
        let n = group.tipIds.length;
        if (win) {
          n = 0;
          for (const ds of group.dates) { const tt = +new Date(ds); if (!isNaN(tt) && tt >= win.d0 && tt <= win.d1) n++; }
        }
        // _winHidden is honoured by highlight()/clearHighlight() and the marker click handler
        // (Leaflet ignores a runtime `interactive` change, so the flag gates clicks instead).
        group._winHidden = (n === 0);
        if (n === 0) marker.setStyle(HIDDEN_STYLE);
        else {
          marker.setStyle({ opacity: 1, fillOpacity: BASE_STYLE.fillOpacity });
          marker.setRadius(6 + 3 * Math.sqrt(n));
        }
      }
    },

    /** Register the prioritisation panel and build the on-map knobs (shown only while the
     *  "To sequence" metric is selected). */
    attachPrioKnobs(prio) {
      prioRef = prio;
      const ctl = L.control({ position: 'bottomleft' });
      ctl.onAdd = () => {
        // Transparent wrapper holding two separate boxes: the seed box, then the knob box.
        const d = L.DomUtil.create('div', 'prio-knobs-wrap');
        L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
        const seedBox = L.DomUtil.create('div', 'prio-seed-map', d);
        const knobBox = L.DomUtil.create('div', 'prio-knobs', d);
        const seedRefresh = buildSeedControl(seedBox, { getParams: () => prio.getParams(), onChange: (p) => prio.setParams(p) }).refresh;
        const knobsRefresh = buildKnobs(knobBox, { getParams: () => prio.getParams(), onChange: (p) => prio.setParams(p), getMaxN: () => prio.getMaxN?.() ?? 200 }).refresh;
        mapKnobsRefresh = () => { seedRefresh(); knobsRefresh(); };
        return d;
      };
      prioKnobsCtl = ctl;
      if (metric === 'toSequence') ctl.addTo(map);
    },

    /**
     * Add the health-zone layer: a multi-metric choropleth (relative risk + per-zone
     * sample counts by status) with clickable selection. A button group switches the
     * metric; "Off" hides the colour but keeps zones clickable.
     * @param {GeoJSON.FeatureCollection} geojson  features w/ { Nom, PROVINCE, relative_risk, cx, cy }
     * @param {Map<string,{Positive:number,Negative:number,Invalid:number,Unclassified:number,total:number}>} seedCounts  initial per-zone counts (upper-cased Nom)
     */
    addZoneLayer(geojson, seedCounts = new Map(), posCt = new Map(), rows = []) {
      const ZERO = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0, total: 0 };
      const countsOf = (f) => zoneCounts.get(upper(f.properties.Nom)) || ZERO;   // reads scope zoneCounts
      const intFmt = (x) => String(Math.round(x));
      zoneCounts = seedCounts; zonePosCt = posCt; linelistRows = rows;
      // Positives in a zone with Ct below the active threshold.
      const posBelow = (f) => { const a = zonePosCt.get(upper(f.properties.Nom)); if (!a) return 0; let n = 0; for (const v of a) if (v < ctThreshold) n++; return n; };

      // Metric definitions: label, colour ramp, value accessor, classing kind.
      METRICS = {
        risk:         { label: 'Relative risk',       ramp: RISK_RAMP,                kind: 'continuous', fmt: (x) => x.toFixed(2), value: (f) => f.properties.relative_risk },
        Positive:     { label: 'Positive samples',     ramp: STATUS_RAMP.Positive,     kind: 'count', fmt: intFmt, value: (f) => (ctThreshold == null ? countsOf(f).Positive : posBelow(f)) },
        Negative:     { label: 'Negative samples',     ramp: STATUS_RAMP.Negative,     kind: 'count', fmt: intFmt, value: (f) => countsOf(f).Negative },
        Invalid:      { label: 'Invalid samples',      ramp: STATUS_RAMP.Invalid,      kind: 'count', fmt: intFmt, value: (f) => countsOf(f).Invalid },
        Unclassified: { label: 'Unclassified samples', ramp: STATUS_RAMP.Unclassified, kind: 'count', fmt: intFmt, value: (f) => countsOf(f).Unclassified },
        total:        { label: 'Total samples',        ramp: RISK_RAMP,                kind: 'count', fmt: intFmt, value: (f) => countsOf(f).total },
        toSequence:   { label: 'To sequence', ramp: TOSEQ_RAMP, kind: 'count', fmt: intFmt, value: (f) => toSeqByZone.get(upper(f.properties.Nom)) || 0 },
      };
      // Class breaks for a metric (counts classed over the non-zero zones only).
      const recomputeBreaks = (cfg) => {
        const vals = geojson.features.map(cfg.value)
          .filter((v) => typeof v === 'number' && (cfg.kind === 'count' ? v > 0 : true));
        cfg.min = vals.length ? Math.min(...vals) : 0;
        cfg.max = vals.length ? Math.max(...vals) : 0;
        // Continuous metrics (relative risk) class over the value range so a skewed high
        // tail isn't collapsed into one colour; counts stay quantile-classed.
        cfg.breaks = !vals.length ? []
          : cfg.kind === 'continuous' ? equalIntervalBreaks(cfg.min, cfg.max, cfg.ramp.length)
          : quantileBreaks(vals, cfg.ramp.length);
      };
      for (const cfg of Object.values(METRICS)) recomputeBreaks(cfg);

      if (!map.getPane('riskPane')) {
        map.createPane('riskPane');
        map.getPane('riskPane').style.zIndex = 350;   // tilePane 200 < risk 350 < overlay 400 (markers)
      }
      zoneLayer = L.geoJSON(geojson, {
        pane: 'riskPane',
        style: styleFor,
        onEachFeature: (f, layer) => {
          const key = upper(f.properties.Nom);
          const pkey = `${key}|${upper(f.properties.PROVINCE)}`;
          // Inner point (pole of inaccessibility, precomputed in data:zones) — always
          // inside the polygon, unlike a bbox/area centroid. Fall back if absent.
          const c = (f.properties.cx != null && f.properties.cy != null)
            ? L.latLng(f.properties.cy, f.properties.cx)
            : layer.getBounds().getCenter();
          nameToLayer.set(key, layer);                              // by Nom (last wins for duplicates)
          nameToLayer.set(pkey, layer);                             // province-qualified
          nameToCentroid.set(key, c);
          nameToCentroid.set(pkey, c);
          layer.options.bubblingMouseEvents = false;   // don't trigger the empty-map deselect
          layer.on('click', () => zoneClickHandler && zoneClickHandler(f.properties.Nom));
        },
      }).addTo(map);

      // single shared sticky tooltip — reflects the current metric
      const tooltipFor = (f) => {
        const nom = f.properties.Nom;
        if (metric === 'risk') { const r = f.properties.relative_risk; return `${nom} (health zone) — ${typeof r === 'number' ? r.toFixed(3) : 'n/a'} (RR)`; }
        if (metric === 'toSequence') return `${nom} (health zone) — ${METRICS.toSequence.value(f) || 0} to sequence`;
        if (metric !== 'off') return `${nom} (health zone) — ${METRICS[metric].value(f) || 0} ${metric.toLowerCase()}`;
        return `${nom} (health zone)`;
      };
      zoneLayer.bindTooltip('', { sticky: true });
      // Track the DOM event of the latest move that landed on a zone polygon. Leaflet
      // fires the layer event before the map event for the same physical mouse move, so
      // a map `mousemove` whose originalEvent differs means the cursor is NOT over a zone.
      let lastZoneEvt = null;
      zoneLayer.on('mouseover mousemove', (e) => {
        lastZoneEvt = e.originalEvent;
        const f = e.layer && e.layer.feature;
        if (f) zoneLayer.setTooltipContent(tooltipFor(f));
      });
      // Close on any move that isn't over a zone. Unlike layer `mouseout`, mousemove keeps
      // firing in the gaps between packed polygons, so a dropped/coalesced boundary mouseout
      // (common with small zones + fast cursor) can't leave the tooltip stuck open.
      map.on('mousemove', (e) => { if (e.originalEvent !== lastZoneEvt) zoneLayer.closeTooltip(); });
      map.on('mouseout', () => zoneLayer.closeTooltip());

      // legend — rebuilt for the active metric (hidden when Off)
      const renderLegend = () => {
        if (!choroLegendDiv) return;
        if (metric === 'off') { choroLegendDiv.style.display = 'none'; return; }
        choroLegendDiv.style.display = '';
        const cfg = METRICS[metric];
        const lo = [cfg.min, ...cfg.breaks], hi = [...cfg.breaks, cfg.max];
        const title = (metric === 'Positive' && ctThreshold != null) ? `Positive · Ct < ${ctThreshold}` : cfg.label;
        let html = `<div class="lg-title">${title}</div>`;
        if (cfg.kind === 'count') html += `<span><i style="background:${COUNT_NODATA};border-color:rgba(0,0,0,0.12)"></i>0 (none)</span>`;
        for (let i = 0; i < cfg.ramp.length; i++) html += `<span><i style="background:${cfg.ramp[i]};border-color:rgba(0,0,0,0.12)"></i>${cfg.fmt(lo[i])}–${cfg.fmt(hi[i])}</span>`;
        choroLegendDiv.innerHTML = html;
      };
      applyToSeq = () => { recomputeBreaks(METRICS.toSequence); if (metric === 'toSequence') { restyle(); renderLegend(); } };
      // Ct threshold change → recompute the Positive metric, redraw if it's active.
      applyCtThreshold = () => {
        recomputeBreaks(METRICS.Positive);
        if (metric === 'Positive') { restyle(); renderLegend(); }
      };
      // After a windowed re-tally: reclass every count metric and redraw.
      applyCounts = () => {
        for (const cfg of Object.values(METRICS)) recomputeBreaks(cfg);
        restyle(); renderLegend();
      };
      choroLegend = L.control({ position: 'bottomright' });
      choroLegend.onAdd = () => { choroLegendDiv = L.DomUtil.create('div', 'map-legend choropleth-legend'); renderLegend(); return choroLegendDiv; };
      choroLegend.addTo(map);

      // metric button group (replaces the on/off toggle): Off + risk + per-status + total (+ toSequence when prio active)
      const SHORT = { off: 'Off', risk: 'Risk', Positive: 'Pos', Negative: 'Neg', Invalid: 'Inv', Unclassified: 'Unc', total: 'Total', toSequence: 'Seq+' };
      const FULL  = { off: 'Hide colour (zones stay clickable)', risk: 'Relative risk', Positive: 'Positive samples', Negative: 'Negative samples', Invalid: 'Invalid samples', Unclassified: 'Unclassified samples', total: 'Total samples', toSequence: 'To sequence (prioritisation)' };
      let groupDiv = null;
      const buildGroup = () => {
        if (!groupDiv) return;
        const ORDER = ['off', 'risk', 'Positive', 'Negative', 'Invalid', 'Unclassified', 'total', 'toSequence'];
        groupDiv.replaceChildren();
        for (const key of ORDER) {
          const b = L.DomUtil.create('button', key === metric ? 'active' : '', groupDiv);
          b.type = 'button'; b.textContent = SHORT[key]; b.title = FULL[key]; b.dataset.metric = key;
          b.onclick = () => {
            const wasToSeq = metric === 'toSequence';
            metric = key;
            [...groupDiv.children].forEach((c) => c.classList.toggle('active', c.dataset.metric === key));
            restyle(); renderLegend();
            updateCtVisibility();   // the Ct input rides with the Positive metric
            // Selecting "To sequence" activates prioritisation (knobs + compute); leaving it deactivates.
            if (key === 'toSequence' && !wasToSeq) setPrio(true);
            else if (key !== 'toSequence' && wasToSeq) setPrio(false);
          };
        }
      };
      const groupCtl = L.control({ position: 'topright' });
      groupCtl.onAdd = () => { groupDiv = L.DomUtil.create('div', 'choropleth-group'); L.DomEvent.disableClickPropagation(groupDiv); buildGroup(); return groupDiv; };
      groupCtl.addTo(map);

      // search-and-zoom: type a health-zone name → pick a match → zoom + select it.
      // Duplicate Noms (Bili, Lubunga) are disambiguated with their province so each
      // entry is distinct and selects its own polygon.
      const nomCounts = {};
      for (const f of geojson.features) { const n = f.properties.Nom; if (n) nomCounts[n] = (nomCounts[n] || 0) + 1; }
      const zoneEntries = geojson.features
        .filter(f => f.properties.Nom)
        .map(f => ({
          nom: f.properties.Nom,
          province: f.properties.PROVINCE,
          label: nomCounts[f.properties.Nom] > 1 ? `${f.properties.Nom} (${f.properties.PROVINCE})` : f.properties.Nom,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const searchCtl = L.control({ position: 'topleft' });
      searchCtl.onAdd = () => {
        const wrap = L.DomUtil.create('div', 'zone-search');
        wrap.innerHTML =
          '<input type="text" class="zone-search-input" placeholder="Search health zone…" autocomplete="off" spellcheck="false">' +
          '<ul class="zone-search-list"></ul>';
        const input = wrap.querySelector('input');
        const list = wrap.querySelector('ul');
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.disableScrollPropagation(wrap);

        let results = [];
        let activeIdx = -1;

        const close = () => { list.replaceChildren(); list.style.display = 'none'; results = []; activeIdx = -1; };
        const pick = (e) => { close(); input.value = ''; input.blur(); selectZoneByName(e.nom, e.province); };
        const setActive = (i) => {
          activeIdx = i;
          [...list.children].forEach((li, k) => li.classList.toggle('active', k === i));
          if (i >= 0) list.children[i]?.scrollIntoView({ block: 'nearest' });
        };

        input.addEventListener('input', () => {
          const q = input.value.trim().toLowerCase();
          if (!q) { close(); return; }
          const starts = [], contains = [];
          for (const e of zoneEntries) {
            const l = e.nom.toLowerCase();
            if (l.startsWith(q)) starts.push(e);
            else if (l.includes(q)) contains.push(e);
          }
          results = [...starts, ...contains].slice(0, 8);
          activeIdx = -1;
          list.replaceChildren(...results.map((e, i) => {
            const li = document.createElement('li');
            li.textContent = e.label;
            li.onmouseenter = () => setActive(i);   // keep mouse + keyboard in sync
            li.onclick = () => pick(e);
            return li;
          }));
          list.style.display = results.length ? 'block' : 'none';
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowDown') { if (results.length) { e.preventDefault(); setActive(Math.min(activeIdx + 1, results.length - 1)); } }
          else if (e.key === 'ArrowUp') { if (results.length) { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); } }
          else if (e.key === 'Enter') { if (results.length) { e.preventDefault(); pick(results[activeIdx >= 0 ? activeIdx : 0]); } }
          else if (e.key === 'Escape') { close(); input.blur(); }
        });
        input.addEventListener('blur', () => setTimeout(close, 150));   // let a click register first
        return wrap;
      };
      searchCtl.addTo(map);
      return zoneLayer;
    },

    /** Programmatically zoom to + select a zone by name (search-and-zoom). */
    selectZoneByName,

    /** The Prioritisation tab body element (the panel renders into it). */
    prioBody: () => document.getElementById('prio-body'),

    /**
     * Add the mobility-arrows layer. When toggled on, draws the selected zone's
     * outflows (red) and inflows (blue) as curved arrows scaled by volume.
     * @param {{outByZone:Map, inByZone:Map}} mob  parsed flow lookups (upper-cased keys)
     */
    addMobilityLayer(mob) {
      mobility = mob;
      if (!map.getPane('mobilityPane')) {
        map.createPane('mobilityPane');
        const p = map.getPane('mobilityPane');
        p.style.zIndex = 380;            // risk 350 < mobility 380 < markers 400
        p.style.pointerEvents = 'none';  // arrows never intercept clicks
      }
      mobilityGroup = L.layerGroup().addTo(map);

      mobLegend = L.control({ position: 'bottomright' });
      mobLegend.onAdd = () => {
        const div = L.DomUtil.create('div', 'map-legend mob-legend');
        div.innerHTML =
          '<div class="lg-title">Mobility (selected zone)</div>' +
          `<span><i style="background:${MOB_OUT}"></i>Outflow (export)</span>` +
          `<span><i style="background:${MOB_IN}"></i>Inflow (import)</span>` +
          '<span class="lg-note">Width ∝ volume · top 20 each way</span>';
        return div;
      };

      const mobToggle = L.control({ position: 'topright' });
      mobToggle.onAdd = () => {
        const btn = L.DomUtil.create('button', 'risk-toggle off');
        btn.type = 'button';
        btn.title = 'Toggle mobility arrows for the selected zone';
        btn.textContent = 'Mobility: off';
        L.DomEvent.disableClickPropagation(btn);
        btn.onclick = () => {
          mobilityOn = !mobilityOn;
          btn.textContent = `Mobility: ${mobilityOn ? 'on' : 'off'}`;
          btn.classList.toggle('off', !mobilityOn);
          if (mobilityOn) mobLegend.addTo(map); else mobLegend.remove();
          drawMobility();
        };
        return btn;
      };
      mobToggle.addTo(map);
    },
  };
}
