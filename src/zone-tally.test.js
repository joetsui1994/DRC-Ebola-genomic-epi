import { describe, it, expect } from 'vitest';
import { tallyZones } from './zone-tally.js';

const D = (s) => +new Date(s);
const rows = [
  { health_zone: 'Bunia', status: 'Positive', date: '2026-05-01', ct: '24' },
  { health_zone: 'Bunia', status: 'Positive', date: '2026-06-01', ct: '30' },
  { health_zone: 'Bunia', status: 'Negative', date: '2026-05-01', ct: '' },
  { health_zone: 'Katwa', status: 'Positive', date: '2026-05-01', ct: '' },   // no Ct → not in posCt
  { health_zone: 'Bunia', status: 'Positive', date: '',           ct: '22' }, // undated
  { health_zone: '',      status: 'Positive', date: '2026-05-01', ct: '20' }, // no zone → dropped
  { health_zone: 'Bunia', status: 'Suspected', date: '2026-05-01', ct: '' },  // non-status → counts skip
];

describe('tallyZones', () => {
  it('full tally: counts by status + positive Ct lists, keyed by UPPER Nom', () => {
    const { zoneCounts, zonePosCt } = tallyZones(rows, null);
    expect(zoneCounts.get('BUNIA')).toEqual({ Positive: 3, Negative: 1, Invalid: 0, Unclassified: 0, total: 4 });
    expect(zoneCounts.get('KATWA')).toEqual({ Positive: 1, Negative: 0, Invalid: 0, Unclassified: 0, total: 1 });
    expect(zonePosCt.get('BUNIA').sort((a,b)=>a-b)).toEqual([22, 24, 30]); // 3 positives w/ numeric Ct
    expect(zonePosCt.has('KATWA')).toBe(false);                            // Katwa positive had no Ct
  });
  it('window excludes out-of-window AND undated rows (inclusive bounds)', () => {
    const { zoneCounts, zonePosCt } = tallyZones(rows, { d0: D('2026-05-01'), d1: D('2026-05-31') });
    expect(zoneCounts.get('BUNIA')).toEqual({ Positive: 1, Negative: 1, Invalid: 0, Unclassified: 0, total: 2 });
    expect(zonePosCt.get('BUNIA')).toEqual([24]);                          // 30 (Jun) + 22 (undated) excluded
  });
  it('empty window yields empty maps', () => {
    const { zoneCounts } = tallyZones(rows, { d0: D('2027-01-01'), d1: D('2027-02-01') });
    expect(zoneCounts.size).toBe(0);
  });
});
