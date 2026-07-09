import { describe, it, expect, vi } from 'vitest';
import { makeViewRows, applySampleView } from './sample-toggle.js';

const rows = [
  { sample_id: 'a', sample_collected: true },
  { sample_id: 'b', sample_collected: false },
  { sample_id: 'c', sample_collected: true },
];
const ids = (rs) => rs.map((r) => r.sample_id);

describe('makeViewRows', () => {
  it('filters to collected rows for DHIS when the toggle is checked', () => {
    const view = makeViewRows(rows, { isDhis: true, toggle: { checked: true } });
    expect(ids(view())).toEqual(['a', 'c']);
  });

  it('returns all rows for DHIS when the toggle is unchecked', () => {
    const view = makeViewRows(rows, { isDhis: true, toggle: { checked: false } });
    expect(view()).toBe(rows);
  });

  it('returns all rows for a non-DHIS source regardless of toggle', () => {
    const view = makeViewRows(rows, { isDhis: false, toggle: { checked: true } });
    expect(view()).toBe(rows);
  });

  it('re-reads the toggle each call (live state)', () => {
    const toggle = { checked: true };
    const view = makeViewRows(rows, { isDhis: true, toggle });
    expect(ids(view())).toEqual(['a', 'c']);
    toggle.checked = false;
    expect(view()).toBe(rows);
  });
});

describe('applySampleView', () => {
  it('pushes the rows to the map, time-series, and prio consumers and refreshes prio', () => {
    const map = { setLinelist: vi.fn() };
    const ts = { setRows: vi.fn() };
    const setPrioRows = vi.fn();
    const prio = { refresh: vi.fn() };
    const filtered = rows.filter((r) => r.sample_collected);

    const returned = applySampleView(filtered, { map, ts, setPrioRows, getPrio: () => prio });

    expect(map.setLinelist).toHaveBeenCalledWith(filtered);
    expect(ts.setRows).toHaveBeenCalledWith(filtered);
    expect(setPrioRows).toHaveBeenCalledWith(filtered);
    expect(prio.refresh).toHaveBeenCalledTimes(1);
    expect(returned).toBe(filtered);
  });

  it('tolerates a not-yet-created prio panel (getPrio returns null)', () => {
    const map = { setLinelist: vi.fn() };
    const ts = { setRows: vi.fn() };
    const setPrioRows = vi.fn();
    expect(() => applySampleView(rows, { map, ts, setPrioRows, getPrio: () => null })).not.toThrow();
    expect(map.setLinelist).toHaveBeenCalledWith(rows);
  });
});
