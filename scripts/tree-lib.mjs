// Pure functions for enriching a phylogenetic NEXUS tree (canonicalisation, geo
// resolution, meta). Shared enrichment core, format-agnostic — the HIPSTR n139
// front-end lives in hipstr-parse.mjs; the EGC inline front-end (enrichTreeText/
// readTipFields/enrichTipInner) is retained here too. No file IO — all inputs are
// strings/objects so every unit is testable. See the design spec:
// docs/superpowers/specs/2026-07-02-tree-enrichment-pipeline-design.md

// Accessions mislabelled in the raw EGC tree, corrected before any processing.
export const CORRECTIONS = { PP_00711T3: 'Rwampara' };

// Read the three fields we need from a tip annotation block (text between [& and ]).
export function readTipFields(inner) {
  const g = (re) => (inner.match(re) || [, ''])[1];
  return {
    accession: g(/accession="([^"]*)"/),
    date: g(/date="([^"]*)"/),
    location: g(/location="([^"]*)"/),
  };
}

// Rewrite location to the resolved value and append the enrichment keys. Everything
// else in the block is left byte-for-byte intact (numbers are never reformatted).
export function enrichTipInner(inner, rec) {
  // Function replacer so a '$' in the value can't be read as a replacement token.
  const rewritten = inner.replace(/location="[^"]*"/, () => `location="${rec.location}"`);
  return rewritten +
    `,health_zone="${rec.health_zone}"` +
    `,health_area="${rec.health_area}"` +
    `,lat=${rec.lat},lon=${rec.lon}` +
    `,exported=${rec.exported}`;
}

// Alias crosswalk (observed -> canonical Nom), identical semantics to main.js's
// makeCanon and update-relative-risk.mjs so build-time and runtime agree.
// Columns: 0 observed_name, 1 canonical_nom.
export function makeCanon(aliasText) {
  const map = new Map();
  for (const line of aliasText.trim().split(/\r?\n/).slice(1)) {
    const [observed, canonical] = line.split(',');
    if (observed && canonical) map.set(observed.toUpperCase().trim(), canonical.trim());
  }
  return (name) => map.get((name || '').toUpperCase().trim()) || name;
}

// health-zones.geojson carries pole-of-inaccessibility coords per feature:
// cx = longitude, cy = latitude. Build Nom -> {lat, lon}.
export function parseZones(geojsonText) {
  const gj = JSON.parse(geojsonText);
  const map = new Map();
  for (const f of gj.features) {
    const p = f.properties || {};
    if (p.Nom != null && p.cx != null && p.cy != null) {
      map.set(p.Nom, { lat: p.cy, lon: p.cx });
    }
  }
  return map;
}

// Resolve one tip's enriched fields. Order matters: correction -> ex- strip ->
// canonicalise -> geo lookup. Throws (never emits null coords) if the zone is unknown.
export function resolveTip(fields, { corrections, canon, zones }) {
  const corrected = corrections[fields.accession] ?? fields.location;
  const exported = corrected.startsWith('ex-');
  const location = exported ? corrected.slice(3) : corrected;
  const health_zone = canon(location);
  const coord = zones.get(health_zone);
  if (!coord) {
    throw new Error(`No geojson zone for "${health_zone}" (tip ${fields.accession}, location "${location}")`);
  }
  return {
    accession: fields.accession,
    date: fields.date,
    location,
    health_zone,
    health_area: 'null',   // literal string for the NEXUS tree; build-tree.mjs converts to JSON null for tips.json
    lat: coord.lat,
    lon: coord.lon,
    exported,
  };
}

// Replace every tip block (identified by containing accession=) with its enriched
// form; internal-node blocks and the topology pass through unchanged. Returns the
// new text and the resolved records (for ituri-tips.json), in tree order.
export function enrichTreeText(text, resolve) {
  const records = [];
  const newText = text.replace(/\[&([^\]]*)\]/g, (whole, inner) => {
    if (!/accession="/.test(inner)) return whole;   // internal node — leave intact
    const rec = resolve(readTipFields(inner));
    records.push(rec);
    return `[&${enrichTipInner(inner, rec)}]`;
  });
  return { text: newText, records };
}

// BEAST node height = years before the most-recent tip, so the root is the max.
export function rootHeightFromText(text) {
  const hs = [...text.matchAll(/height_mean=([0-9.eE+-]+)/g)].map((m) => Number(m[1]));
  if (!hs.length) throw new Error('no height_mean annotations found');
  return Math.max(...hs);
}

const DAY_MS = 86400000;
const YEAR_DAYS = 365.25;

export function computeMeta(records, rootHeightYears, { sourceTree, updated }) {
  const dates = records.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) throw new Error('no tip dates');
  if (!(rootHeightYears > 0)) throw new Error(`bad root height: ${rootHeightYears}`);
  const mostRecentDate = dates[dates.length - 1];
  const rootMs = Date.parse(mostRecentDate) - rootHeightYears * YEAR_DAYS * DAY_MS;
  const rootDate = new Date(rootMs).toISOString().slice(0, 10);
  return { mostRecentDate, rootDate, sourceTree, updated, tipCount: records.length };
}
