import { describe, it, expect } from 'vitest';
import { readTipFields, enrichTipInner } from './tree-lib.mjs';

const TIP = 'height_mean=0.05,height_median=0.05,date="2026-05-03",location="Lumumba",accession="PP_00711T3"';

describe('readTipFields', () => {
  it('extracts accession, date, location', () => {
    expect(readTipFields(TIP)).toEqual({
      accession: 'PP_00711T3', date: '2026-05-03', location: 'Lumumba',
    });
  });
});

describe('enrichTipInner', () => {
  it('rewrites location and appends the new keys, leaving other keys intact', () => {
    const rec = {
      location: 'Rwampara', health_zone: 'Rwampara', health_area: 'null',
      lat: 1.60555, lon: 30.03822, exported: false,
    };
    const out = enrichTipInner(TIP, rec);
    expect(out).toBe(
      'height_mean=0.05,height_median=0.05,date="2026-05-03",location="Rwampara",accession="PP_00711T3"' +
      ',health_zone="Rwampara",health_area="null",lat=1.60555,lon=30.03822,exported=false'
    );
  });
});
