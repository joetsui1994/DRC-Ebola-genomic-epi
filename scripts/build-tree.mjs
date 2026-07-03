// Enrich the n35 EGC time tree for the dashboard and regenerate its companion
// files. Reads raw tree from data-raw/ + geojson/aliases from public/data/, writes
// the app-ready tree + tips + meta into public/data/. See the design spec.
//
// Usage:
//   node scripts/build-tree.mjs                 # stamp `updated` = today
//   node scripts/build-tree.mjs --date=2026-07-03
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CORRECTIONS, makeCanon, parseZones, resolveTip,
  enrichTreeText, rootHeightFromText, computeMeta,
} from './tree-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_TREE = 'Ituri_2026-06-26_n35.EGC.ptree';
const RAW = join(ROOT, 'data-raw', SOURCE_TREE);
const GEOJSON = join(ROOT, 'public/data/health-zones.geojson');
const ALIASES = join(ROOT, 'public/data/aliases.csv');
const OUT_TREE = join(ROOT, 'public/data/ituri-tree.ptree');
const OUT_TIPS = join(ROOT, 'public/data/ituri-tips.json');
const OUT_META = join(ROOT, 'public/data/ituri-meta.json');

const dateArg = process.argv.find((a) => a.startsWith('--date='));
const updated = dateArg ? dateArg.slice(7) : new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
  throw new Error(`--date must be YYYY-MM-DD (got "${updated}")`);
}

const canon = makeCanon(readFileSync(ALIASES, 'utf8'));
const zones = parseZones(readFileSync(GEOJSON, 'utf8'));
const rawText = readFileSync(RAW, 'utf8');

const resolve = (fields) => resolveTip(fields, { corrections: CORRECTIONS, canon, zones });
const { text, records } = enrichTreeText(rawText, resolve);
const meta = computeMeta(records, rootHeightFromText(rawText), { sourceTree: SOURCE_TREE, updated });

const tips = records.map((r) => ({
  id: r.accession, date: r.date, location: r.location,
  health_zone: r.health_zone, health_area: r.health_area === 'null' ? null : r.health_area,
  lat: r.lat, lon: r.lon, exported: r.exported,
}));

writeFileSync(OUT_TREE, text);
writeFileSync(OUT_TIPS, JSON.stringify(tips, null, 2) + '\n');
writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');

console.log(`Tips enriched: ${records.length}`);
console.log(`Exported tips: ${records.filter((r) => r.exported).length}`);
console.log(`Zones used: ${[...new Set(records.map((r) => r.health_zone))].sort().join(', ')}`);
console.log(`Meta: mostRecent=${meta.mostRecentDate} root=${meta.rootDate} updated=${meta.updated}`);
console.log(`\n✓ Wrote ${OUT_TREE}\n✓ Wrote ${OUT_TIPS}\n✓ Wrote ${OUT_META}`);
