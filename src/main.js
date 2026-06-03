import './style.css';
import { createTreePanel } from './tree-panel.js';
import { createMapPanel } from './map-panel.js';
import { createTimeseriesPanel } from './timeseries-panel.js';
import { startCoordinator } from './coordinator.js';
import { makeSplitter } from './splitter.js';

// Parse the line-list CSV into the rows the distribution panel needs.
// Columns: 0 province, 1 health_zone, 2 health_area, 3 status,
//          4 symptom_onset_date, 5 fallback_date, 6 fallback_date_source.
function parseLinelist(text) {
  const lines = text.trim().split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    out.push({ health_zone: c[1], health_area: c[2], status: c[3], date: c[5] });
  }
  return out;
}

// Parse the FlowMinder origin→destination matrix into per-zone flow lookups
// (keyed upper-case): outByZone[origin] = movement leaving, inByZone[dest] = arriving.
function parseMobilityMatrix(text) {
  const lines = text.trim().split(/\r?\n/);
  const dests = lines[0].split(',').slice(1);          // header: nom, dest1, dest2, …
  const outByZone = new Map(), inByZone = new Map();
  const add = (m, key, other, value) => {
    const k = key.toUpperCase().trim();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ other, value });
  };
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const origin = cells[0];
    for (let j = 1; j < cells.length; j++) {
      const v = +cells[j];
      if (!(v > 0)) continue;
      add(outByZone, origin, dests[j - 1], v);          // origin → dest  (out of origin)
      add(inByZone, dests[j - 1], origin, v);           // origin → dest  (in to dest)
    }
  }
  return { outByZone, inByZone };
}

// Prefix runtime asset URLs with the Vite base so they resolve under the Pages
// subpath (BASE_URL is '/' in dev, '/DRC-Ebola-genomic-epi/' in the build).
const BASE = import.meta.env.BASE_URL;

const [tips, meta, linelist] = await Promise.all([
  fetch(`${BASE}data/ituri-tips.json`).then(r => r.json()),
  fetch(`${BASE}data/ituri-meta.json`).then(r => r.json()),
  fetch(`${BASE}data/linelist_data.csv`).then(r => r.text()).then(parseLinelist),
]);

// Markers are built from the tips themselves (grouped by health_area → zone).
const map = createMapPanel('map-body', tips);

// Health-zone risk choropleth + mobility arrows (standalone layers, under the
// markers). Mobility loads after the risk layer because it reuses the zone
// centroids built there.
fetch(`${BASE}data/health-zones.geojson`)
  .then(r => r.json())
  .then(zones => {
    map.addRiskLayer(zones);
    return fetch(`${BASE}data/flowminder__inflow__static.matrix.csv`)
      .then(r => r.text())
      .then(text => map.addMobilityLayer(parseMobilityMatrix(text)));
  })
  .catch(err => console.warn('risk/mobility layer not loaded:', err));
const ts  = createTimeseriesPanel('timeseries-body', linelist, { minDate: meta.rootDate, maxDate: meta.mostRecentDate });
const tree = await createTreePanel('tree-body');

startCoordinator(tree, map, ts, meta, tips);

// Header "last updated" timestamp.
// TODO: wire to the real data-refresh time (e.g. a field in a data file, an API
// response header, or a build-time value). For now it uses a placeholder date.
const LAST_UPDATED = '2026-05-28T00:00:00Z';
const luEl = document.getElementById('last-updated');
if (luEl) {
  luEl.textContent = new Date(LAST_UPDATED).toLocaleString('en-GB', {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

// Draggable dividers (proportional, so panes scale with the window too):
// vertical gutter splits left-column vs map; horizontal gutter splits tree vs
// time-series within the left column.
makeSplitter(document.getElementById('gutter-v'), document.getElementById('left'), document.getElementById('map'), 'x');
// Tree (before) keeps ≥260px so the phylogeny stays usable; the distribution
// panel (after) keeps ≥170px — these bound how far the divider drags either way.
makeSplitter(document.getElementById('gutter-h'), document.getElementById('tree'), document.getElementById('timeseries'), 'y', { minBefore: 260, minAfter: 170 });
