import { describe, it, expect } from 'vitest';
import { LINELIST_SOURCES, resolveLinelistSource } from './linelist-source.js';

const sp = (qs) => new URLSearchParams(qs);

describe('resolveLinelistSource', () => {
  it('defaults to dhis when the param is absent', () => {
    const r = resolveLinelistSource(sp(''));
    expect(r.key).toBe('dhis');
    expect(r.file).toBe('linelist_data.dhis.csv');
    expect(r.label).toBe('DHIS');
  });

  it('resolves an explicit lab param', () => {
    expect(resolveLinelistSource(sp('linelist=lab')).key).toBe('lab');
  });

  it('resolves the dhis param to its file + label', () => {
    const r = resolveLinelistSource(sp('linelist=dhis'));
    expect(r.key).toBe('dhis');
    expect(r.file).toBe('linelist_data.dhis.csv');
    expect(r.label).toBe('DHIS');
  });

  it('falls back to dhis for an unknown value', () => {
    expect(resolveLinelistSource(sp('linelist=bogus')).key).toBe('dhis');
  });

  it('exposes both sources for building the selector', () => {
    expect(Object.keys(LINELIST_SOURCES)).toEqual(['lab', 'dhis']);
  });
});
