// Parse the HIPSTR/TreeAnnotator FigTree NEXUS format (taxa + Translate + numbered
// tips) into the inline-annotated single-line .ptree the app consumes. Pure — no IO.
// See docs/superpowers/specs/2026-07-06-hipstr-parser-spec-change.md

export const MS_PER_YEAR = 365.25 * 86400000;
const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

// Translate block: `<number> '<label>',` (or unquoted), terminated by a lone `;`.
export function parseTranslate(text) {
  const start = text.search(/translate/i);
  if (start < 0) throw new Error('no Translate block');
  const block = text.slice(start, text.indexOf(';', start));
  const map = new Map();
  for (const m of block.matchAll(/^\s*(\d+)\s+'?([^',\n]+?)'?\s*,?\s*$/gm)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

// Pipe-delimited label. The date is the LAST field (YYYY-MM or YYYY-MM-DD); the
// location is the last field that is NOT a date (some labels carry TWO trailing
// date fields, e.g. `...|Rwampara|2026-05|2026-05-20`); accession is field 1 with
// any `.N` version suffix stripped. Robust to 5-, 6-, and 7-field labels.
export function parseLabel(label) {
  const p = label.split('|');
  if (p.length < 4) throw new Error(`too few fields in label: "${label}"`);
  const date = p[p.length - 1].trim();
  if (!DATE_RE.test(date)) throw new Error(`label date not YYYY-MM(-DD): "${label}"`);
  let li = p.length - 2;
  while (li > 1 && DATE_RE.test(p[li].trim())) li--;   // skip any extra trailing date field(s)
  const location = p[li].trim();
  const accession = (p[1] || '').trim().replace(/\.\d+$/, '');
  const fieldId = (p[0] || '').trim();
  if (!accession || !location || DATE_RE.test(location)) throw new Error(`incomplete label: "${label}"`);
  return { fieldId, accession, location, date };
}

const DAY_MS = 86400000;

// Height-0 calendar date (in ms) fit from the full-date tips: mean of
// date + height*year. On a clock-consistent tree every full tip agrees.
export function clockRefMs(fullTips) {
  if (!fullTips.length) throw new Error('no full-date tips to fit the clock');
  const sum = fullTips.reduce((a, t) => a + Date.parse(t.date) + t.height * MS_PER_YEAR, 0);
  return sum / fullTips.length;
}

// Full dates pass through; a YYYY-MM date is completed to the tree-implied day
// (ref - height), rounded to the nearest whole day so it matches where PearTree
// draws the tip.
export function completeDate(rawDate, height, refMs) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return rawDate;
  const ms = refMs - height * MS_PER_YEAR;
  const rounded = Math.round(ms / DAY_MS) * DAY_MS;
  return new Date(rounded).toISOString().slice(0, 10);
}

// A numbered tip token: a `(` or `,` delimiter, the leaf number, then its [&...]
// stats block. Internal nodes are `)[&...]` (no number) and are never matched.
const TIP_TOKEN = /([(,])(\d+)\[&([^\]]*)\]/g;
function heightOf(stats) {
  const m = stats.match(/height_mean=([0-9.eE+-]+)/);
  const h = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(h)) throw new Error(`tip missing/invalid height_mean: [&${stats.slice(0, 60)}]`);
  return h;
}

export function hipstrToInline(text, { resolve }) {
  const trans = parseTranslate(text);
  const at = text.indexOf('tree TREE1');
  if (at < 0) throw new Error("no 'tree TREE1' statement found");
  const treeStr = text.slice(at);

  // Pass 1: collect each tip's parsed label + height; fit the clock from full-date tips.
  const byNum = new Map();
  const fullTips = [];
  for (const m of treeStr.matchAll(TIP_TOKEN)) {
    const num = m[2];
    if (!trans.has(num)) continue;
    const fields = parseLabel(trans.get(num));
    const height = heightOf(m[3]);
    byNum.set(num, { fields, height });
    if (/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) fullTips.push({ date: fields.date, height });
  }
  const refMs = clockRefMs(fullTips);

  // Pass 2: rewrite tip tokens; collect records in tree order.
  const records = [];
  const newTree = treeStr.replace(TIP_TOKEN, (whole, delim, num, stats) => {
    if (!trans.has(num)) return whole;
    const { fields, height } = byNum.get(num);
    const date = completeDate(fields.date, height, refMs);
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
  const treeLine = newTree.slice(0, end + 1);   // up to the tree terminator
  return { text: `#NEXUS\nBEGIN TREES;\n\t${treeLine}\nEND;\n`, records };
}
