import './style.css';
import { createTreePanel } from './tree-panel.js';
import { createMapPanel } from './map-panel.js';
import { createTimeseriesPanel } from './timeseries-panel.js';
import { startCoordinator } from './coordinator.js';
import { createNodeInfo } from './node-info.js';
import { makeSplitter } from './splitter.js';
import { createPrioritisationPanel } from './prioritise-panel.js';
import { tallyZones } from './zone-tally.js';

// Parse the health-zone alias crosswalk (observed_name → canonical_nom) into a
// normaliser. Health-zone names in the line-list / mobility / tree are mapped onto
// the geojson's canonical `Nom` so every source joins. Unknown names pass through.
// Columns: 0 observed_name, 1 canonical_nom, 2 source_dataset, 3 notes.
function makeCanon(text) {
  const map = new Map();
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [observed, canonical] = line.split(',');
    if (observed && canonical) map.set(observed.toUpperCase().trim(), canonical.trim());
  }
  return (name) => map.get((name || '').toUpperCase().trim()) || name;
}

// Parse the line-list CSV into the rows the distribution panel needs.
// Columns: 0 province, 1 health_zone, 2 health_area, 3 status, 4 date, 5 ct
// (ct = RadiOne Ct from the raw ct_used; present only on Positive rows where available).
function parseLinelist(text, canon) {
  const lines = text.trim().split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    out.push({ health_zone: canon(c[1]), health_area: c[2], status: c[3], date: c[4], ct: c[5] });
  }
  return out;
}

// Parse the FlowMinder origin→destination matrix into per-zone flow lookups
// (keyed upper-case): outByZone[origin] = movement leaving, inByZone[dest] = arriving.
// Origin/dest names are normalised to canonical so they join the geojson centroids.
function parseMobilityMatrix(text, canon) {
  const lines = text.trim().split(/\r?\n/);
  const dests = lines[0].split(',').slice(1).map(canon);   // header: nom, dest1, dest2, …
  const outByZone = new Map(), inByZone = new Map();
  const add = (m, key, other, value) => {
    const k = key.toUpperCase().trim();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ other, value });
  };
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const origin = canon(cells[0]);
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

const [tips, meta, linelistText, aliasText] = await Promise.all([
  fetch(`${BASE}data/ituri-tips.json`).then(r => r.json()),
  fetch(`${BASE}data/ituri-meta.json`).then(r => r.json()),
  fetch(`${BASE}data/linelist_data.csv`).then(r => r.text()),
  fetch(`${BASE}data/aliases.csv`).then(r => r.text()).catch(() => ''),   // crosswalk (optional)
]);

const canon = makeCanon(aliasText);
const linelist = parseLinelist(linelistText, canon);
// Expose the raw line-list rows (public-mode candidates) to the prioritisation engine.
window.__PRIO_LINELIST__ = linelist;

// Per-zone status counts + positive-Ct lists for the choropleth (full dataset; the brush
// re-tallies a window via map.setDateWindow).
const { zoneCounts, zonePosCt } = tallyZones(linelist);

// Sequence (tree-tip) dates for the sample-distribution availability track — zone
// canonicalised so they filter with the same selection as the bars.
const realv = (v) => (v && v !== 'null') ? v : '';
const seqTips = tips.filter(t => t.date).map(t => ({
  date: t.date,
  health_zone: realv(t.health_zone) ? canon(t.health_zone) : '',
  health_area: realv(t.health_area),
}));

// Markers are built from the tips themselves (grouped by health_area → zone).
// The map's Ct input mirrors into the distribution panel (late-bound: ts is created below).
let tsPanel = null;
const map = createMapPanel('map-body', tips, { onCtChange: (t) => tsPanel?.setCtThreshold(t) });

// Health-zone risk choropleth + mobility arrows (standalone layers, under the
// markers). Mobility loads after the risk layer because it reuses the zone
// centroids built there.
fetch(`${BASE}data/health-zones.geojson`)
  .then(r => r.json())
  .then(zones => {
    map.addZoneLayer(zones, zoneCounts, zonePosCt);
    const risk = new Map(zones.features.map((f) => [(f.properties.Nom || '').toUpperCase().trim(), f.properties.relative_risk]));
    const prio = createPrioritisationPanel(map.prioBody(), {
      risk, canon, tips: seqTips,
      onChange: ({ active, cellSummary, origin, binWidthDays }) => {
        if (active && cellSummary) {
          const byZone = new Map();
          for (const c of cellSummary) byZone.set(c.location, (byZone.get(c.location) || 0) + c.selected);
          map.setToSequence(byZone);
          ts.setAllocation(cellSummary, { binWidthDays, origin });
        }
        if (!active) { map.setToSequence(new Map()); ts.setAllocation(null); }
      },
    });
    map.attachPrioKnobs?.(prio);   // on-map knobs panel
    return fetch(`${BASE}data/flowminder__inflow__static.matrix.csv`)
      .then(r => r.text())
      .then(text => map.addMobilityLayer(parseMobilityMatrix(text, canon)));
  })
  .catch(err => console.warn('risk/mobility layer not loaded:', err));
let treePanel = null;
const ts  = createTimeseriesPanel('timeseries-body', linelist, { minDate: meta.rootDate, maxDate: meta.mostRecentDate }, { onCtChange: (t) => map.setCtThreshold(t), tips: seqTips, onExtentChange: (f) => treePanel?.setWidthFraction(f) });
tsPanel = ts;   // late-bind for the map → distribution Ct sync
const tree = await createTreePanel('tree-body');
treePanel = tree;

// Floating node-info card pinned to the tree panel.
const nodeInfo = createNodeInfo('tree-body', { mostRecentDate: meta.mostRecentDate, canon });

startCoordinator(tree, map, ts, meta, tips, canon, nodeInfo);

// Header "last updated" = latest commit touching public/data, injected at build
// time by Vite (see vite.config.js). Refreshes automatically on each deploy.
const luEl = document.getElementById('last-updated');
if (luEl) {
  luEl.textContent = new Date(__LAST_UPDATED__).toLocaleString('en-GB', {
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
