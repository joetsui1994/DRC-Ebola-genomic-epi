// Update `relative_risk` in public/data/health-zones.geojson IN PLACE from a health-zone
// metadata CSV (columns: ref_dhis2, name, relative_risk), joining by zone NAME.
//
// The geojson carries no DHIS2 code, so the join is by name (geojson `Nom` ↔ CSV `name`).
// Name variants are reconciled through the shared crosswalk public/data/aliases.csv
// (observed_name → canonical_nom), the same file main.js uses at runtime — so future risk
// refreshes only need new alias rows there, not code changes.
//
// Only the `relative_risk` token of each matched feature line is rewritten; geometry, cx/cy,
// and file formatting are left byte-for-byte intact (keeps the geojson diff to the risk values).
//
// Usage:
//   node scripts/update-relative-risk.mjs [csv]            # dry run (report only)
//   node scripts/update-relative-risk.mjs [csv] --write    # apply
// Defaults csv to public/data/health_zone_metadata.csv.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GEOJSON = join(ROOT, 'public/data/health-zones.geojson');
const ALIASES = join(ROOT, 'public/data/aliases.csv');
const DEFAULT_CSV = join(ROOT, 'public/data/health_zone_metadata.csv');

const args = process.argv.slice(2);
const write = args.includes('--write');
const csvPath = args.find((a) => !a.startsWith('--')) || DEFAULT_CSV;

// Minimal CSV parse — these files have no quoted/embedded commas.
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const o = {};
    header.forEach((h, i) => (o[h] = (cells[i] ?? '').trim()));
    return o;
  });
}
const norm = (s) => (s || '').toUpperCase().trim();

// Crosswalk: observed (external) name → canonical geojson Nom.
const aliasMap = new Map();
for (const r of parseCsv(readFileSync(ALIASES, 'utf8'))) {
  if (r.observed_name && r.canonical_nom) aliasMap.set(norm(r.observed_name), r.canonical_nom.trim());
}
const canon = (name) => aliasMap.get(norm(name)) || name;

// New risk keyed by canonical Nom. Same-named zones (Bili, Lubunga) collapse to one key;
// their CSV rows carry identical values, so that's lossless.
const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const riskByNom = new Map();
for (const r of rows) {
  if (!r.name) continue; // skip blank-name placeholder rows
  const value = r.relative_risk === '' ? 'null' : String(Number(r.relative_risk));
  riskByNom.set(norm(canon(r.name)), value);
}

// Rewrite the geojson line-by-line, touching only the relative_risk token of matched features.
const lines = readFileSync(GEOJSON, 'utf8').split('\n');
const geoNoms = new Map(); // norm → original Nom
const updated = new Set();
const out = lines.map((line) => {
  const m = line.match(/"Nom":"((?:[^"\\]|\\.)*)"/);
  if (!m || !line.includes('"relative_risk"')) return line; // not a feature line
  const nom = m[1];
  geoNoms.set(norm(nom), nom);
  const value = riskByNom.get(norm(nom));
  if (value === undefined) return line; // no CSV row for this zone → leave unchanged
  updated.add(norm(nom));
  return line.replace(/"relative_risk":(?:null|-?[0-9.eE+]+)/, `"relative_risk":${value}`);
});

// Report.
const named = rows.filter((r) => r.name);
const unmatchedCsv = named.filter((r) => !geoNoms.has(norm(canon(r.name)))).map((r) => r.name);
const notUpdated = [...geoNoms].filter(([k]) => !updated.has(k)).map(([, nom]) => nom);
console.log(`CSV rows: ${rows.length} (named ${named.length})`);
console.log(`Geojson zones updated: ${updated.size} / ${geoNoms.size}`);
console.log(`Unmatched CSV names (after aliases): ${unmatchedCsv.length}`, unmatchedCsv);
console.log(`Geojson zones left unchanged: ${notUpdated.length}`, notUpdated);
if (write) {
  writeFileSync(GEOJSON, out.join('\n'));
  console.log(`\n✓ Wrote ${GEOJSON}`);
} else {
  console.log('\n(dry run — re-run with --write to apply)');
}
