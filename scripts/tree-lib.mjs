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
  const rewritten = inner.replace(/location="[^"]*"/, `location="${rec.location}"`);
  return rewritten +
    `,health_zone="${rec.health_zone}"` +
    `,health_area="${rec.health_area}"` +
    `,lat=${rec.lat},lon=${rec.lon}` +
    `,exported=${rec.exported}`;
}
