import { describe, it, expect } from 'vitest';
import { parseTranslate, parseLabel } from './hipstr-parse.mjs';
import { clockRefMs, completeDate } from './hipstr-parse.mjs';

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
});
