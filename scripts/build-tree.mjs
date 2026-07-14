// Enrich the source phylogenetic tree for the dashboard and regenerate its
// companion files. Reads the raw tree from data-raw/ + geojson/aliases from
// public/data/, writes the app-ready tree + tips + meta into public/data/. The
// current source is the HIPSTR n134 build (parsed via hipstr-parse.mjs — NEXUS with a
// Translate block, the standard input format). See the design spec + the 2026-07-06 HIPSTR
// spec change.
//
// Usage:
//   node scripts/build-tree.mjs                 # stamp `updated` = today
//   node scripts/build-tree.mjs --date=2026-07-06
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CORRECTIONS, makeCanon, parseZones, resolveTip,
  rootHeightFromText, computeMeta,
} from './tree-lib.mjs';
import { hipstrToInline } from './hipstr-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_TREE = 'Ituri2026.DRC_trimmed_n134_GTR_SG.HIPSTR.tree';
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
const { text, records } = hipstrToInline(rawText, { resolve });
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
