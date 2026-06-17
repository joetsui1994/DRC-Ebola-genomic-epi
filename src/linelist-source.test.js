import { describe, it, expect } from 'vitest';
import { LINELIST_SOURCES, resolveLinelistSource } from './linelist-source.js';

const sp = (qs) => new URLSearchParams(qs);

describe('resolveLinelistSource', () => {
  it('defaults to lab when the param is absent', () => {
    const r = resolveLinelistSource(sp(''));
    expect(r.key).toBe('lab');
    expect(r.file).toBe('linelist_data.csv');
    expect(r.label).toBe('Lab');
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

  it('falls back to lab for an unknown value', () => {
    expect(resolveLinelistSource(sp('linelist=bogus')).key).toBe('lab');
  });

  it('exposes both sources for building the selector', () => {
    expect(Object.keys(LINELIST_SOURCES)).toEqual(['lab', 'dhis']);
  });
});
