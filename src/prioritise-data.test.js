// src/prioritise-data.test.js
import { describe, it, expect } from 'vitest';
import { buildCells, parseUpload, validateUpload, summarizeUpload } from './prioritise-data.js';
import { prioritise } from './prioritise.js';

const risk = new Map([['BUNIA', 0.9], ['KATWA', 0.5]]);   // upper Nom -> relative_risk
const canon = (z) => (z || '').trim();                    // identity for the test

describe('buildCells', () => {
  it('keeps eligible positives (ct < threshold, valid zone/date) and bins them', () => {
    const rows = [
      { health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' }, // bin 0
      { health_zone: 'Bunia', status: 'Positive', ct: '30', date: '2026-04-12' }, // bin 1
      { health_zone: 'Bunia', status: 'Negative', ct: '20', date: '2026-04-05' }, // dropped: not positive
      { health_zone: 'Bunia', status: 'Positive', ct: '33', date: '2026-04-05' }, // dropped: ct >= 31
      { health_zone: 'Nowhere', status: 'Positive', ct: '20', date: '2026-04-05' }, // dropped: zone not in risk
      { health_zone: 'Katwa', status: 'Positive', ct: '', date: '2026-04-05' },    // dropped: no ct
    ];
    const { cells, diagnostics } = buildCells({ candidateRows: rows, risk, canon, ctThreshold: 31, binWidthDays: 7 });
    const bunia0 = cells.find((c) => c.location === 'BUNIA' && c.timeBin === 0);
    expect(bunia0.available).toBe(1);
    expect(bunia0.risk).toBe(0.9);
    expect(cells.find((c) => c.location === 'BUNIA' && c.timeBin === 1).available).toBe(1);
    expect(diagnostics.kept).toBe(2);
    expect(diagnostics.dropped).toBe(4);
  });

  it('subtractHistory=true sets available = eligible - sequenced, h = sequenced', () => {
    const candidateRows = [
      { health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' },
      { health_zone: 'Bunia', status: 'Positive', ct: '25', date: '2026-04-05' },
      { health_zone: 'Bunia', status: 'Positive', ct: '26', date: '2026-04-05' },
    ];
    const sequencedRows = [{ health_zone: 'Bunia', date: '2026-04-05' }]; // 1 tip in bin 0
    const { cells } = buildCells({ candidateRows, sequencedRows, risk, canon, ctThreshold: 31, binWidthDays: 7, subtractHistory: true });
    const c = cells.find((x) => x.location === 'BUNIA' && x.timeBin === 0);
    expect(c.available).toBe(2);  // 3 eligible - 1 sequenced
    expect(c.h).toBe(1);
  });

  it('withIds attaches a sample-id pool per cell', () => {
    const candidateRows = [
      { sample_id: 'X1', health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' },
      { sample_id: 'X2', health_zone: 'Bunia', status: 'Positive', ct: '25', date: '2026-04-05' },
    ];
    const { cells } = buildCells({ candidateRows, risk, canon, ctThreshold: 31, binWidthDays: 7, withIds: true });
    expect(cells[0].ids.map((o) => o.sampleId).sort()).toEqual(['X1', 'X2']);
    expect(cells[0].available).toBe(2);
  });
});

describe('buildCells inProgressRows', () => {
  const candidateRows = [
    { sample_id: 'X1', health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' }, // bin 0
    { sample_id: 'X2', health_zone: 'Bunia', status: 'Positive', ct: '25', date: '2026-04-05' }, // bin 0
    { sample_id: 'X3', health_zone: 'Bunia', status: 'Positive', ct: '26', date: '2026-04-05' }, // bin 0
  ];

  it('in-process rows raise h/H_k and reduce availability, like sequenced history', () => {
    const inProgressRows = [{ health_zone: 'Bunia', date: '2026-04-05' }];   // bin 0
    const { cells, locHistory, cellHistory, inProgressHistory } = buildCells({
      candidateRows, inProgressRows, risk, canon, ctThreshold: 31, binWidthDays: 7, subtractHistory: true,
    });
    const c = cells.find((x) => x.location === 'BUNIA' && x.timeBin === 0);
    expect(c.h).toBe(1);                 // h reflects the in-process sample
    expect(c.available).toBe(2);         // 3 candidates - 1 (subtractHistory)
    expect(locHistory.get('BUNIA')).toBe(1);
    // tracked SEPARATELY from phylogeny history
    expect(inProgressHistory.get('BUNIA|0')).toBe(1);
    expect(cellHistory.get('BUNIA|0') || 0).toBe(0);   // cellHistory stays phylogeny-only
  });

  it('in-process and sequenced both contribute to h but stay in separate maps', () => {
    const inProgressRows = [{ health_zone: 'Bunia', date: '2026-04-05' }];
    const sequencedRows = [{ health_zone: 'Bunia', date: '2026-04-05' }];
    const { cells, cellHistory, inProgressHistory, locHistory } = buildCells({
      candidateRows, inProgressRows, sequencedRows, risk, canon, ctThreshold: 31, binWidthDays: 7, subtractHistory: true,
    });
    const c = cells.find((x) => x.location === 'BUNIA' && x.timeBin === 0);
    expect(c.h).toBe(2);                 // 1 sequenced + 1 in-process
    expect(c.available).toBe(1);         // 3 - 2
    expect(cellHistory.get('BUNIA|0')).toBe(1);        // phylogeny only
    expect(inProgressHistory.get('BUNIA|0')).toBe(1);  // in-process only
    expect(locHistory.get('BUNIA')).toBe(2);
  });

  it('end-to-end: an in-process sample is never re-selected', () => {
    const inProgressRows = [{ health_zone: 'Bunia', date: '2026-04-05' }];
    const { cells, origin, tNow } = buildCells({
      candidateRows, inProgressRows, risk, canon, ctThreshold: 31, binWidthDays: 7, subtractHistory: true, withIds: true,
    });
    const { selection } = prioritise({ cells, n: 5, delta: 0.5, tilt: 0, binWidthDays: 7, origin, tNow, seed: 1 });
    expect(selection.length).toBe(2);    // only 2 of the 3 candidates remain selectable
  });
});

describe('parseUpload', () => {
  it('parses header + rows, flags sequenced, tolerates DD/MM/YYYY', () => {
    const csv = 'sample_id,health_zone,status,ct,date,sequenced\n'
      + 'A1,Bunia,Positive,24,2026-04-05,\n'
      + 'A2,Katwa,Positive,22,06/04/2026,1\n';
    const { rows } = parseUpload(csv);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ sample_id: 'A1', health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05', sequenced: false });
    expect(rows[1]).toMatchObject({ sample_id: 'A2', date: '2026-04-06', sequenced: true });
  });

  it('carries row_id and parses being_sequenced when present', () => {
    const csv = 'row_id,sample_id,health_zone,status,ct,date,being_sequenced\n'
      + '7,A1,Bunia,Positive,24,2026-04-05,TRUE\n'
      + '8,A2,Bunia,Positive,25,2026-04-05,\n';
    const { rows } = parseUpload(csv);
    expect(rows[0]).toMatchObject({ row_id: '7', being_sequenced: true });
    expect(rows[1]).toMatchObject({ row_id: '8', being_sequenced: false });
  });

  it('normalises status case-insensitively to the app categories', () => {
    const csv = 'sample_id,health_zone,status,ct,date\n'
      + 'A1,Bunia,positive,24,2026-04-05\n'
      + 'A2,Bunia,NEGATIVE,,2026-04-05\n'
      + 'A3,Bunia,Not yet run,,2026-04-05\n';
    const { rows } = parseUpload(csv);
    expect(rows.map((r) => r.status)).toEqual(['Positive', 'Negative', 'Unclassified']);
  });
});

describe('validateUpload', () => {
  it('passes a well-formed upload', () => {
    const parsed = parseUpload('sample_id,health_zone,status,date,ct\nA1,Bunia,Positive,2026-04-05,24\n');
    expect(validateUpload(parsed).ok).toBe(true);
  });

  it('reports missing required columns', () => {
    const parsed = parseUpload('sample_id,status,ct\nA1,Positive,24\n');   // no health_zone, no date
    const v = validateUpload(parsed);
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/health_zone/);
    expect(v.error).toMatch(/date/);
  });

  it('rejects an empty file', () => {
    expect(validateUpload(parseUpload('')).ok).toBe(false);
  });

  it('rejects a header with no data rows', () => {
    const v = validateUpload(parseUpload('sample_id,health_zone,status,date,ct\n'));
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/no data/i);
  });
});

describe('summarizeUpload', () => {
  const canon = (z) => (z === 'Bigville' ? 'Bunia' : z);   // alias Bigville → Bunia (known)

  it('tallies status, undated, no-Ct, and unknown zones (canon-aware, de-duped)', () => {
    const { rows } = parseUpload(
      'sample_id,health_zone,status,ct,date\n'
      + 'A1,Bunia,Positive,24,2026-04-05\n'
      + 'A2,Katwa,Negative,,2026-04-05\n'        // no Ct
      + 'A3,Nowhere,Positive,20,\n'              // unknown zone + undated
      + 'A4,Bunia,Positive,NA,2026-04-05\n'      // no Ct
      + 'A5,Foo,Unclassified,,2026-04-05\n'      // unknown zone + no Ct
      + 'A6,Nowhere,Positive,21,2026-04-05\n'    // unknown zone (dup)
      + 'A7,Bigville,Positive,22,2026-04-05\n');  // canon → Bunia (known)
    const s = summarizeUpload(rows, risk, canon);
    expect(s.total).toBe(7);
    expect(s.byStatus).toEqual({ Positive: 5, Negative: 1, Unclassified: 1 });
    expect(s.undated).toBe(1);
    expect(s.noCt).toBe(3);
    expect(s.unknownZones).toEqual(['Nowhere', 'Foo']);   // distinct, original casing, encounter order
  });

  it('handles empty input', () => {
    const s = summarizeUpload([], risk, canon);
    expect(s).toEqual({ total: 0, byStatus: {}, undated: 0, noCt: 0, unknownZones: [] });
  });
});

describe('upload end-to-end', () => {
  it('upload path: parse → buildCells(withIds) → prioritise yields IDs', () => {
    const csv = 'sample_id,health_zone,status,ct,date\n'
      + 'A1,Bunia,Positive,22,2026-04-05\nA2,Bunia,Positive,23,2026-04-05\nB1,Katwa,Positive,24,2026-04-05\n';
    const { rows } = parseUpload(csv);
    const { cells, origin, tNow } = buildCells({
      candidateRows: rows, risk, canon, ctThreshold: 31, binWidthDays: 7, withIds: true,
    });
    const { selection } = prioritise({ cells, n: 2, delta: 0.5, tilt: 0, binWidthDays: 7, origin, tNow, seed: 1 });
    expect(selection.length).toBe(2);
    expect(selection.every((s) => /^(A1|A2|B1)$/.test(s.sampleId))).toBe(true);
  });
});

describe('buildCells locHistory', () => {
  it('counts all prior history per location, including locations with no candidates this batch', () => {
    const candidateRows = [
      { health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-12' }, // bin 1, candidate
    ];
    const sequencedRows = [
      { health_zone: 'Bunia', date: '2026-04-05' },   // bin 0 — no candidate in this bin
      { health_zone: 'Katwa', date: '2026-04-05' },   // Katwa has NO candidates at all this batch
    ];
    const { cells, locHistory } = buildCells({
      candidateRows, sequencedRows, risk, canon, ctThreshold: 31, binWidthDays: 7, subtractHistory: true,
    });
    // Katwa is absent from cells (no candidates) but its history is still counted:
    expect(cells.find((c) => c.location === 'KATWA')).toBeUndefined();
    expect(locHistory.get('KATWA')).toBe(1);
    // Bunia's bin-0 history counts toward its location total even though the candidate is in bin 1:
    expect(locHistory.get('BUNIA')).toBe(1);
  });

  it('locHistory is empty when there is no history', () => {
    const { locHistory } = buildCells({
      candidateRows: [{ health_zone: 'Bunia', status: 'Positive', ct: '24', date: '2026-04-05' }],
      risk, canon, ctThreshold: 31, binWidthDays: 7,
    });
    expect(locHistory.size).toBe(0);
  });
});
