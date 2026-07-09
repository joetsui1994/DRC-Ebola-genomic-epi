// Parse a BEAST NEXUS tree with NAMED, inline-annotated tips (no Translate block) —
// e.g. the Skygrid .ptree — into the app's inline .ptree. Tips look like
//   NAME[&...,date="2026-05-06",Label="26FHV058|PP_006Y8ME.2|DRC|Ituri|Katwa|2026-05-06",...]
// Internal nodes are `)[&...]` (no name) and are left untouched. Reuses the HIPSTR
// helpers for pipe-label parsing, height, and clock date-completion. Pure — no IO.
import { completeDate, clockRefMs } from './hipstr-parse.mjs';

// A named leaf token: a `(` or `,` delimiter, the tip name, then its [&...] stats block.
// Internal nodes (`)[&...]`) start with `)` and carry no name, so they never match.
const TIP_TOKEN = /([(,])([A-Za-z0-9_.\-]+)\[&([^\]]*)\]/g;

const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

// Pipe-delimited label: `labId|accession|country|province|zone|date[|date]`. Unlike the HIPSTR
// labels, some Skygrid tips carry TWO trailing date fields (e.g. `...|Aru|2026-05|2026-05-26`),
// so the zone is the last field that is NOT a date, and the date is the last field.
function parseSkygridLabel(label) {
  const p = label.split('|').map((s) => s.trim());
  if (p.length < 4) throw new Error(`too few fields in label: "${label}"`);
  const date = p[p.length - 1];
  if (!DATE_RE.test(date)) throw new Error(`label date not YYYY-MM(-DD): "${label}"`);
  const accession = (p[1] || '').replace(/\.\d+$/, '');
  let li = p.length - 2;
  while (li > 1 && DATE_RE.test(p[li])) li--;   // skip any extra trailing date field(s)
  const location = p[li];
  if (!accession || !location || DATE_RE.test(location)) throw new Error(`incomplete label: "${label}"`);
  return { accession, location, date };
}

function heightOf(stats) {
  const m = stats.match(/height_mean=([0-9.eE+-]+)/);
  const h = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(h)) throw new Error(`tip missing/invalid height_mean: [&${stats.slice(0, 60)}]`);
  return h;
}

function labelOf(stats) {
  const m = stats.match(/Label="([^"]*)"/);
  if (!m) throw new Error(`tip missing Label: [&${stats.slice(0, 60)}]`);
  return m[1];
}

export function skygridToInline(text, { resolve }) {
  const at = text.indexOf('tree TREE1');
  if (at < 0) throw new Error("no 'tree TREE1' statement found");
  const treeStr = text.slice(at);

  // Pass 1: parse each tip's label + height; fit the clock from the full-date tips so any
  // YYYY-MM tips can be completed to the tree-implied day.
  const parsed = [];
  for (const m of treeStr.matchAll(TIP_TOKEN)) {
    const stats = m[3];
    parsed.push({ fields: parseSkygridLabel(labelOf(stats)), height: heightOf(stats) });
  }
  if (!parsed.length) throw new Error('no named tips matched');
  const fullTips = parsed
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.fields.date))
    .map((t) => ({ date: t.fields.date, height: t.height }));
  const refMs = clockRefMs(fullTips);

  // Pass 2: rewrite tip tokens to the app's accession-keyed enriched form; collect records.
  const records = [];
  const newTree = treeStr.replace(TIP_TOKEN, (whole, delim, name, stats) => {
    const fields = parseSkygridLabel(labelOf(stats));
    const date = completeDate(fields.date, heightOf(stats), refMs);
    const rec = resolve({ accession: fields.accession, date, location: fields.location });
    records.push(rec);
    const ann =
      `date="${date}",accession="${rec.accession}",location="${rec.location}"` +
      `,health_zone="${rec.health_zone}",health_area="${rec.health_area}"` +
      `,lat=${rec.lat},lon=${rec.lon},exported=${rec.exported},${stats}`;
    return `${delim}${rec.accession}[&${ann}]`;
  });

  const end = newTree.indexOf(';');
  if (end < 0) throw new Error('tree statement has no terminating ;');
  const treeLine = newTree.slice(0, end + 1);
  return { text: `#NEXUS\nBEGIN TREES;\n\t${treeLine}\nEND;\n`, records };
}
