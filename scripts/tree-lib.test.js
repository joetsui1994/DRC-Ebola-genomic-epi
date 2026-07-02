import { describe, it, expect } from 'vitest';
import { readTipFields, enrichTipInner, makeCanon, parseZones } from './tree-lib.mjs';

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

describe('makeCanon', () => {
  const canon = makeCanon(
    'observed_name,canonical_nom,source_dataset,notes\n' +
    'Mongwalu,Mongbwalu,egc_tree,typo\n' +
    'Nyankunnde,Nyakunde,egc_tree,typo\n'
  );
  it('maps observed names to canonical, case-insensitively', () => {
    expect(canon('Mongwalu')).toBe('Mongbwalu');
    expect(canon('NYANKUNNDE')).toBe('Nyakunde');
  });
  it('passes unknown names through unchanged', () => {
    expect(canon('Bunia')).toBe('Bunia');
  });
});

describe('parseZones', () => {
  it('maps Nom -> {lat:cy, lon:cx}', () => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [
      { properties: { Nom: 'Bunia', cx: 30.22568, cy: 1.58722 } },
    ]});
    const z = parseZones(gj);
    expect(z.get('Bunia')).toEqual({ lat: 1.58722, lon: 30.22568 });
  });
});
