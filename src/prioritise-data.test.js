// src/prioritise-data.test.js
import { describe, it, expect } from 'vitest';
import { buildCells, parseUpload } from './prioritise-data.js';
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
    expect(cells[0].ids.sort()).toEqual(['X1', 'X2']);
    expect(cells[0].available).toBe(2);
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
});

describe('upload end-to-end', () => {
  it('upload path: parse → buildCells(withIds) → prioritise yields IDs', () => {
    const csv = 'sample_id,health_zone,status,ct,date\n'
      + 'A1,Bunia,Positive,22,2026-04-05\nA2,Bunia,Positive,23,2026-04-05\nB1,Katwa,Positive,24,2026-04-05\n';
    const { rows } = parseUpload(csv);
    const { cells, origin, tNow } = buildCells({
      candidateRows: rows, risk, canon, ctThreshold: 31, binWidthDays: 7, withIds: true,
    });
    const { selection } = prioritise({ cells, n: 2, delta: 0.5, lam: Infinity, binWidthDays: 7, origin, tNow, seed: 1 });
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
