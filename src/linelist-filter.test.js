import { describe, it, expect } from 'vitest';
import { filterSampleCollected } from './linelist-filter.js';

const rows = [
  { sample_id: 'a', sample_collected: true },
  { sample_id: 'b', sample_collected: false },
  { sample_id: 'c', sample_collected: true },
];

describe('filterSampleCollected', () => {
  it('keeps only collected rows when sampleOnly is true', () => {
    expect(filterSampleCollected(rows, true).map((r) => r.sample_id)).toEqual(['a', 'c']);
  });

  it('returns all rows unchanged when sampleOnly is false', () => {
    expect(filterSampleCollected(rows, false)).toBe(rows);
  });

  it('passes everything through when all rows are collected (column absent → true)', () => {
    const allTrue = [{ sample_collected: true }, { sample_collected: true }];
    expect(filterSampleCollected(allTrue, true)).toHaveLength(2);
  });
});
