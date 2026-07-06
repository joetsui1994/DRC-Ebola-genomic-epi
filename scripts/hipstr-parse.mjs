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
// location is the field immediately before it; accession is field 1 with any
// `.N` version suffix stripped. Robust to 5- or 6-field labels.
export function parseLabel(label) {
  const p = label.split('|');
  if (p.length < 4) throw new Error(`too few fields in label: "${label}"`);
  const date = p[p.length - 1].trim();
  if (!DATE_RE.test(date)) throw new Error(`label date not YYYY-MM(-DD): "${label}"`);
  const location = p[p.length - 2].trim();
  const accession = (p[1] || '').trim().replace(/\.\d+$/, '');
  const fieldId = (p[0] || '').trim();
  if (!accession || !location) throw new Error(`incomplete label: "${label}"`);
  return { fieldId, accession, location, date };
}
