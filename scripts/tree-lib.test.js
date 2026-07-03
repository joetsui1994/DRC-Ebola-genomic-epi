import { describe, it, expect } from 'vitest';
import { readTipFields, enrichTipInner, makeCanon, parseZones } from './tree-lib.mjs';
import { resolveTip } from './tree-lib.mjs';

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

const CTX = {
  corrections: { PP_00711T3: 'Rwampara' },
  canon: (n) => ({ Mongwalu: 'Mongbwalu' }[n] || n),
  zones: new Map([
    ['Rwampara', { lat: 1.60555, lon: 30.03822 }],
    ['Bunia', { lat: 1.58722, lon: 30.22568 }],
    ['Mongbwalu', { lat: 2.0, lon: 30.0 }],
  ]),
};

describe('resolveTip', () => {
  it('applies the correction map (Lumumba -> Rwampara)', () => {
    const r = resolveTip({ accession: 'PP_00711T3', date: '2026-05-03', location: 'Lumumba' }, CTX);
    expect(r).toMatchObject({ location: 'Rwampara', health_zone: 'Rwampara', exported: false, lat: 1.60555, lon: 30.03822 });
  });
  it('strips ex- and flags export, keeping the base zone', () => {
    const r = resolveTip({ accession: 'PP_006XCJJ', date: '2026-05-14', location: 'ex-Bunia' }, CTX);
    expect(r).toMatchObject({ location: 'Bunia', health_zone: 'Bunia', exported: true, lat: 1.58722, lon: 30.22568 });
  });
  it('canonicalises the health_zone (Mongwalu -> Mongbwalu), leaving location observed', () => {
    const r = resolveTip({ accession: 'X', date: '2026-05-01', location: 'Mongwalu' }, CTX);
    expect(r).toMatchObject({ location: 'Mongwalu', health_zone: 'Mongbwalu', exported: false });
    expect(r.health_area).toBe('null');
  });
  it('passes a plain zone through untouched (no correction, no ex-, no alias)', () => {
    const r = resolveTip({ accession: 'Z', date: '2026-05-02', location: 'Bunia' }, CTX);
    expect(r).toMatchObject({ location: 'Bunia', health_zone: 'Bunia', exported: false, lat: 1.58722, lon: 30.22568 });
  });
  it('treats a correction that itself starts with ex- as an export (correction applies before ex- strip)', () => {
    const ctx = { ...CTX, corrections: { W: 'ex-Bunia' } };
    const r = resolveTip({ accession: 'W', date: '2026-05-02', location: 'Rwampara' }, ctx);
    expect(r).toMatchObject({ location: 'Bunia', health_zone: 'Bunia', exported: true });
  });
  it('throws when the zone is absent from the geojson', () => {
    expect(() => resolveTip({ accession: 'Y', date: '2026-05-01', location: 'Nowhere' }, CTX))
      .toThrow(/Nowhere/);
  });
});
