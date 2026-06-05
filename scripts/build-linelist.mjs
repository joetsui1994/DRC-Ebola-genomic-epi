// Build the de-identified line-list (public/data/linelist_data.csv) from the raw
// BD_LABO enriched export. The raw file carries age/sex/date_of_death and is
// gitignored — only this derived file is published.
//
//   province,health_zone,health_area,status,date,ct
//
//   status ← derived_status (Positif→Positive, Négatif→Negative, Invalide→Invalid,
//            Unclassified kept; blank → dropped by the app)
//   date   ← derived_date (DD/MM/YYYY → ISO; invalid/blank → empty = "undated")
//   ct     ← ct_used, only on Positive rows (where available)
//
// Run: npm run data:linelist
import fs from 'fs';
import path from 'path';

const DATA = 'public/data';
const OUT = path.join(DATA, 'linelist_data.csv');

// Newest raw export matching *BD_LABO*enriched*.csv (date-prefixed → name sort works).
const src = fs.readdirSync(DATA).filter(f => /BD_LABO.*enriched.*\.csv$/i.test(f)).sort().pop();
if (!src) { console.error('No *BD_LABO*enriched*.csv found in ' + DATA); process.exit(1); }
const SRC = path.join(DATA, src);

const STATUS = { 'Positif': 'Positive', 'Négatif': 'Negative', 'Invalide': 'Invalid', 'Unclassified': 'Unclassified' };

function iso(raw) {
  const s = (raw || '').trim().replace(/\/+/g, '/');           // tolerate "23/05//2026"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return '';
  const out = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(out);
  return (!isNaN(d) && d.toISOString().slice(0, 10) === out) ? out : '';   // reject e.g. 31/06
}

// 0-based column indices in the raw export.
const C = { province: 7, health_zone: 8, health_area: 9, derived_status: 26, ct_used: 28, derived_date: 29 };

const lines = fs.readFileSync(SRC, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
const out = ['province,health_zone,health_area,status,date,ct'];
let dropped = 0, undated = 0, ct = 0;
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');                               // export verified comma-free in fields
  const status = STATUS[(c[C.derived_status] || '').trim()] || '';
  const date = iso(c[C.derived_date]);
  const ctVal = (status === 'Positive' && (c[C.ct_used] || '').trim()) ? (c[C.ct_used] || '').trim() : '';
  if (!status) dropped++;
  if (!date) undated++;
  if (ctVal) ct++;
  out.push([c[C.province] || '', c[C.health_zone] || '', c[C.health_area] || '', status, date, ctVal].join(','));
}
// Retain the previous line-list's non-Ituri (Nord-Kivu) rows, harmonised to the new
// columns. Legacy header: province,health_zone,health_area,status,ct_val,
// symptom_onset_date,fallback_date,fallback_date_source. date←fallback_date; ct is left
// blank for these rows (legacy ct_val values are unreliable).
const LEGACY = path.join(DATA, 'linelist_data.legacy.csv');
let keptNK = 0;
if (fs.existsSync(LEGACY)) {
  const lg = fs.readFileSync(LEGACY, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  for (let i = 1; i < lg.length; i++) {
    const c = lg[i].split(',');
    if (!/kivu/i.test(c[0] || '')) continue;                  // Nord-Kivu only
    out.push([c[0] || '', c[1] || '', c[2] || '', c[3] || '', c[6] || '', ''].join(','));
    keptNK++;
  }
}

fs.writeFileSync(OUT, out.join('\n') + '\n');
console.log(`source: ${src}\nwrote ${out.length - 1} rows → ${OUT}`);
console.log(`(blank-status dropped by app: ${dropped} · undated: ${undated} · ct filled: ${ct} · Nord-Kivu retained: ${keptNK})`);
