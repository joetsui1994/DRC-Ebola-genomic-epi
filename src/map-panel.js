import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Leaflet map. Markers are built from the tips themselves: tips are grouped by
// health_area when present, else by health_zone, and placed at the tips' lat/lon
// (area centroid, or zone centroid for area-less tips). Clicking a marker emits
// that group's tip ids. A standalone risk choropleth sits underneath, and the
// selected tips' zone polygons can be outlined.

const BASE_STYLE      = { color: '#33567a', fillColor: '#5b86b3', fillOpacity: 0.85, weight: 1.5 }; // muted blue
const HIGHLIGHT_STYLE = { color: '#9a7a16', fillColor: '#f2c84b', fillOpacity: 0.95, weight: 2 };   // yellow (selected)

const RISK_RAMP   = ['#f6e3df', '#e8b3a6', '#d08163', '#aa4a32', '#7c1d1d'];
const RISK_NODATA = '#e8e6e1';
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
export function createMapPanel(containerId, tips) {
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
    if (!g) { g = { key, level: area ? 'area' : 'zone', lat: t.lat, lon: t.lon, tipIds: [] }; groups.set(key, g); }
    g.tipIds.push(t.id);
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
  for (const { group, marker } of markers) marker.on('click', () => clickHandler && clickHandler(group.tipIds));
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
  let zoneLayer = null, riskLegend = null, colorFor = null, riskOn = true;
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
    const fill = riskOn
      ? { fillColor: colorFor(f.properties.relative_risk), fillOpacity: 0.6 }
      : { fillColor: '#000000', fillOpacity: 0 };
    const stroke = sel ? ZONE_STROKE_SEL : (riskOn ? ZONE_STROKE_ON : ZONE_STROKE_OFF);
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
    const size = Math.max(0.02, Math.hypot(toC.lng - fromC.lng, toC.lat - fromC.lat) * 0.07);
    mobilityGroup.addLayer(L.polyline(arrowHead(pts[pts.length - 2], pts[pts.length - 1], size), { ...opts, opacity: Math.min(1, op + 0.2) }));
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

  return {
    /** cb(tipIds[]) when a marker is clicked. */
    onMarkerClick(cb) { clickHandler = cb; },
    /** cb() when the empty map background is clicked (deselect). */
    onBackgroundClick(cb) { bgHandler = cb; },
    /** Highlight markers whose group contains any of the selected tip ids. */
    highlight(selectedTipIds) {
      const sel = new Set(selectedTipIds);
      for (const { group, marker } of markers) {
        marker.setStyle(group.tipIds.some(id => sel.has(id)) ? HIGHLIGHT_STYLE : BASE_STYLE);
      }
    },
    clearHighlight() { for (const { marker } of markers) marker.setStyle(BASE_STYLE); },

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

    /**
     * Add the health-zone layer (risk choropleth + clickable selection), rendered
     * under the markers. Polygons stay clickable whether or not the risk colour is on.
     * @param {GeoJSON.FeatureCollection} geojson  features w/ { Nom, relative_risk }
     */
    addRiskLayer(geojson) {
      const vals = geojson.features.map(f => f.properties.relative_risk).filter(v => typeof v === 'number');
      if (!vals.length) return null;
      const breaks = quantileBreaks(vals, RISK_RAMP.length);
      const max = Math.max(...vals);
      colorFor = (v) => (typeof v === 'number') ? RISK_RAMP[classIndex(v, breaks)] : RISK_NODATA;

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
          const c = layer.getBounds().getCenter();                  // bbox centre → arrow endpoint
          nameToLayer.set(key, layer);                              // by Nom (last wins for duplicates)
          nameToLayer.set(pkey, layer);                             // province-qualified
          nameToCentroid.set(key, c);
          nameToCentroid.set(pkey, c);
          layer.options.bubblingMouseEvents = false;   // don't trigger the empty-map deselect
          layer.on('click', () => zoneClickHandler && zoneClickHandler(f.properties.Nom));
        },
      }).addTo(map);

      // single shared sticky tooltip (avoids stuck tooltips over dense zones)
      zoneLayer.bindTooltip('', { sticky: true });
      zoneLayer.on('mouseover mousemove', (e) => {
        const f = e.layer && e.layer.feature;
        if (!f) return;
        const r = f.properties.relative_risk;
        zoneLayer.setTooltipContent(`${f.properties.Nom} (health zone) — ${typeof r === 'number' ? r.toFixed(3) : 'n/a'} (RR)`);
      });
      map.on('mouseout', () => zoneLayer.closeTooltip());

      const lo = [0, ...breaks], hi = [...breaks, max];
      riskLegend = L.control({ position: 'bottomright' });
      riskLegend.onAdd = () => {
        const div = L.DomUtil.create('div', 'map-legend risk-legend');
        let html = '<div class="lg-title">Relative risk</div>';
        for (let i = 0; i < RISK_RAMP.length; i++) {
          html += `<span><i style="background:${RISK_RAMP[i]};border-color:rgba(0,0,0,0.12)"></i>${lo[i].toFixed(2)}–${hi[i].toFixed(2)}</span>`;
        }
        div.innerHTML = html;
        return div;
      };
      riskLegend.addTo(map);

      // toggle the risk colour (zones stay clickable; only the fill + legend change)
      const toggleCtl = L.control({ position: 'topright' });
      toggleCtl.onAdd = () => {
        const btn = L.DomUtil.create('button', 'risk-toggle');
        btn.type = 'button';
        btn.title = 'Toggle relative-risk colour';
        btn.textContent = 'Relative risk: on';
        L.DomEvent.disableClickPropagation(btn);
        btn.onclick = () => {
          riskOn = !riskOn;
          restyle();
          if (riskOn) riskLegend.addTo(map); else riskLegend.remove();
          btn.textContent = `Relative risk: ${riskOn ? 'on' : 'off'}`;
          btn.classList.toggle('off', !riskOn);
        };
        return btn;
      };
      toggleCtl.addTo(map);

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
