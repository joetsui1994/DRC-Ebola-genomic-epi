import { describe, it, expect } from 'vitest';
import { readTipFields, enrichTipInner, makeCanon, parseZones } from './tree-lib.mjs';
import { resolveTip } from './tree-lib.mjs';
import { enrichTreeText, rootHeightFromText, computeMeta } from './tree-lib.mjs';

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

const TREE =
  '#NEXUS\nBEGIN TREES;\n\ttree TREE1 = [&R] (' +
  'A[&height_mean=0.02,date="2026-05-10",location="ex-Bunia",accession="A"]:0.01,' +
  'B[&height_mean=0.03,date="2026-05-20",location="Mongwalu",accession="B"]:0.02' +
  ')[&posterior=0.99,height_mean=0.10,height_95%_HPD={0.04,0.12}]:0.0;\nEND;\n';

const resolve = (f) => ({
  accession: f.accession, date: f.date,
  location: f.location.replace(/^ex-/, ''),
  health_zone: f.location.replace(/^ex-/, '') === 'Mongwalu' ? 'Mongbwalu' : f.location.replace(/^ex-/, ''),
  health_area: 'null', lat: 1, lon: 2, exported: f.location.startsWith('ex-'),
});

describe('enrichTreeText', () => {
  it('enriches only tip blocks and returns one record per tip', () => {
    const { text, records } = enrichTreeText(TREE, resolve);
    expect(records.map((r) => r.accession)).toEqual(['A', 'B']);
    expect(text).toContain('exported=true');   // tip A
    expect(text).toContain('health_zone="Mongbwalu"'); // tip B
    expect(text).toContain('[&posterior=0.99,height_mean=0.10,height_95%_HPD={0.04,0.12}]'); // internal node untouched
    expect(text).not.toContain('exported=false,exported'); // internal node got no keys
  });
});

describe('rootHeightFromText', () => {
  it('returns the maximum height_mean across all nodes', () => {
    expect(rootHeightFromText(TREE)).toBeCloseTo(0.10, 10);
  });
  it('throws when there are no height_mean annotations', () => {
    expect(() => rootHeightFromText('#NEXUS\n(A:0.1,B:0.2);')).toThrow(/no height_mean/);
  });
});

describe('computeMeta', () => {
  it('computes most-recent + root dates and provenance', () => {
    const records = [{ date: '2026-05-10' }, { date: '2026-05-26' }];
    const meta = computeMeta(records, 0.10810721572739972, { sourceTree: 'src.ptree', updated: '2026-07-02' });
    expect(meta).toEqual({
      mostRecentDate: '2026-05-26',
      rootDate: '2026-04-16',
      sourceTree: 'src.ptree',
      updated: '2026-07-02',
      tipCount: 2,
    });
  });
  it('picks the true max date regardless of input order', () => {
    const meta = computeMeta(
      [{ date: '2026-05-20' }, { date: '2026-05-26' }, { date: '2026-05-10' }],
      0.05, { sourceTree: 's', updated: '2026-07-02' });
    expect(meta.mostRecentDate).toBe('2026-05-26');
    expect(meta.tipCount).toBe(3);
  });
  it('throws when no records have a date', () => {
    expect(() => computeMeta([{ date: '' }, {}], 0.05, { sourceTree: 's', updated: 'u' }))
      .toThrow(/no tip dates/);
  });
  it('throws on a non-positive root height', () => {
    expect(() => computeMeta([{ date: '2026-05-26' }], 0, { sourceTree: 's', updated: 'u' }))
      .toThrow(/bad root height/);
  });
});
