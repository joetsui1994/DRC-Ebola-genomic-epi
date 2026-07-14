import { describe, it, expect } from 'vitest';
import { parseTranslate, parseLabel } from './hipstr-parse.mjs';
import { clockRefMs, completeDate } from './hipstr-parse.mjs';
import { hipstrToInline } from './hipstr-parse.mjs';

const TRANS = `Begin trees;
	Translate
		1 '26FHV0069|PP_0075YWS.1|DRC|Ituri|Rwampara|2026-05',
		2 '26FHV0074|PP_0075YYN.1|DRC|Ituri|Mongwalu|2026-05-15'
;
tree TREE1 = [&R] (1,2);`;

describe('parseTranslate', () => {
  it('maps numbers to unquoted labels', () => {
    const m = parseTranslate(TRANS);
    expect(m.get('1')).toBe('26FHV0069|PP_0075YWS.1|DRC|Ituri|Rwampara|2026-05');
    expect(m.get('2')).toBe('26FHV0074|PP_0075YYN.1|DRC|Ituri|Mongwalu|2026-05-15');
    expect(m.size).toBe(2);
  });
});

describe('parseLabel', () => {
  it('parses a 6-field label, strips the .N accession suffix, keeps date verbatim', () => {
    expect(parseLabel('26FHV0069|PP_0075YWS.1|DRC|Ituri|Rwampara|2026-05')).toEqual({
      fieldId: '26FHV0069', accession: 'PP_0075YWS', location: 'Rwampara', date: '2026-05',
    });
  });
  it('parses a 5-field label (no province) by locating date as the last field', () => {
    expect(parseLabel('26FHV0069|PP_0075YWS|DRC|Rwampara|2026-05-20')).toEqual({
      fieldId: '26FHV0069', accession: 'PP_0075YWS', location: 'Rwampara', date: '2026-05-20',
    });
  });
  it('parses a 7-field label with two trailing dates, taking the last non-date field as location', () => {
    expect(parseLabel('26FHV0069|PP_0075YWS.1|DRC|Ituri|Rwampara|2026-05|2026-05-20')).toEqual({
      fieldId: '26FHV0069', accession: 'PP_0075YWS', location: 'Rwampara', date: '2026-05-20',
    });
  });
  it('throws on a label whose last field is not a YYYY-MM(-DD) date', () => {
    expect(() => parseLabel('a|PP_x|DRC|Bunia|notadate')).toThrow(/date/);
  });
  it('throws on a label with too few fields (drift guard)', () => {
    expect(() => parseLabel('PP_x|2026-05')).toThrow(/few fields/);
  });
});

describe('parseTranslate robustness', () => {
  it('parses unquoted labels too', () => {
    const m = parseTranslate("Translate\n\t1 26FHV|PP_A|DRC|Bunia|2026-05-01\n;\ntree x=(1);");
    expect(m.get('1')).toBe('26FHV|PP_A|DRC|Bunia|2026-05-01');
  });
  it('throws when there is no Translate block', () => {
    expect(() => parseTranslate('#NEXUS\n(1,2);')).toThrow(/Translate/i);
  });
});

describe('clockRefMs', () => {
  it('averages (date + height*year) over full-date tips', () => {
    // two tips on a perfect clock with height-0 date 2026-06-23
    const y = (d) => Date.parse(d);
    const ref = clockRefMs([
      { date: '2026-05-24', height: 30 / 365.25 },   // 30d before -> 2026-06-23
      { date: '2026-06-13', height: 10 / 365.25 },   // 10d before -> 2026-06-23
    ]);
    expect(new Date(ref).toISOString().slice(0, 10)).toBe('2026-06-23');
    expect(ref).toBeCloseTo(y('2026-06-23'), -6);
  });
  it('throws when there are no full-date tips', () => {
    expect(() => clockRefMs([])).toThrow(/no full-date tips/);
  });
});

describe('completeDate', () => {
  const ref = Date.parse('2026-06-23');
  it('passes a full YYYY-MM-DD date through unchanged', () => {
    expect(completeDate('2026-05-15', 0.1, ref)).toBe('2026-05-15');
  });
  it('completes a YYYY-MM date from the tree height (rounded to the nearest day)', () => {
    // height 30/365.25 yr before 2026-06-23 -> 2026-05-24
    expect(completeDate('2026-05', 30 / 365.25, ref)).toBe('2026-05-24');
  });
  it('rounds a fractional-day height to the nearest day', () => {
    // 30.4 d before 2026-06-23 -> 2026-05-23 ~14:24 -> rounds up to 2026-05-24
    expect(completeDate('2026-05', 30.4 / 365.25, ref)).toBe('2026-05-24');
    // 30.6 d before -> 2026-05-23 ~09:36 -> rounds down to 2026-05-23
    expect(completeDate('2026-05', 30.6 / 365.25, ref)).toBe('2026-05-23');
  });
});

const FILE = `#NEXUS
Begin taxa;
	Dimensions ntax=2;
	Taxlabels
		'X|PP_A.1|DRC|Ituri|Bunia|2026-06-13'
		'Y|PP_B.1|DRC|Ituri|Mongwalu|2026-06'
;
End;
Begin trees;
	Translate
		1 'X|PP_A.1|DRC|Ituri|Bunia|2026-06-13',
		2 'Y|PP_B.1|DRC|Ituri|Mongwalu|2026-06'
;
tree TREE1 = [&R] (1[&height_mean=0.02739726027,foo=1]:0.05,2[&height_mean=0.05479452055,foo=2]:0.05)[&posterior=1.0,height_mean=0.1,height_95%_HPD={0.08,0.12}]:0.0;
End;`;

// resolve stub: canon Mongwalu->Mongbwalu, geo fixed
const resolve = (f) => ({
  accession: f.accession, date: f.date, location: f.location,
  health_zone: f.location === 'Mongwalu' ? 'Mongbwalu' : f.location,
  health_area: 'null', lat: 1.5, lon: 30.2, exported: false,
});

describe('hipstrToInline', () => {
  const { text, records } = hipstrToInline(FILE, { resolve });
  it('returns one record per tip, in tree order, with base accessions', () => {
    expect(records.map((r) => r.accession)).toEqual(['PP_A', 'PP_B']);
  });
  it('injects inline tip annotations named by accession', () => {
    expect(text).toContain('PP_A[&date="2026-06-13"');
    expect(text).toContain('health_zone="Mongbwalu"');
    expect(text).toContain('accession="PP_B"');
  });
  it('completes the truncated tip date from its height (ref fit from the full tip)', () => {
    // full tip PP_A: height 0.0274 yr ≈ 10 d, so height-0 ref = 2026-06-13 + 10 d =
    // 2026-06-23. PP_B height 0.0548 yr ≈ 20 d -> 2026-06-23 − 20 d = 2026-06-03.
    expect(records.find((r) => r.accession === 'PP_B').date).toBe('2026-06-03');
  });
  it('preserves the internal node and original tip stats, drops taxa/translate', () => {
    expect(text).toContain('height_95%_HPD={0.08,0.12}');   // internal node intact
    expect(text).toContain('foo=1');                         // original tip stats kept
    expect(text).not.toMatch(/Translate|Taxlabels/);         // blocks dropped
    expect(text.startsWith('#NEXUS')).toBe(true);
  });
  it('throws on a tip whose stats lack height_mean', () => {
    const bad = FILE.replace('height_mean=0.02739726027,', '');
    expect(() => hipstrToInline(bad, { resolve })).toThrow(/height_mean/);
  });
  it('throws when there is no tree statement', () => {
    const noTree = '#NEXUS\nBegin trees;\n\tTranslate\n\t\t1 A|PP_x|DRC|B|2026-05-01\n;\nEnd;';
    expect(() => hipstrToInline(noTree, { resolve })).toThrow(/tree TREE1/);
  });
});
