// Pure functions for enriching the n35 EGC NEXUS tree. No file IO — all inputs are
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
