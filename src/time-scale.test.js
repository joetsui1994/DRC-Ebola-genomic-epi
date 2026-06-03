import { describe, it, expect } from 'vitest';
import { createTimeScale, nodeToDate, MS_PER_YEAR } from './time-scale.js';

describe('createTimeScale', () => {
  const s = createTimeScale({
    minDate: '2026-03-19', maxDate: '2026-05-20',
    width: 420, padLeft: 20, padRight: 20,
  });

  it('maps minDate to the left padding and maxDate to width - right padding', () => {
    expect(s.dateToX('2026-03-19')).toBeCloseTo(20, 6);
    expect(s.dateToX('2026-05-20')).toBeCloseTo(400, 6);
  });

  it('maps the midpoint date to the plot-area centre', () => {
    const mid = new Date((new Date('2026-03-19').getTime() + new Date('2026-05-20').getTime()) / 2);
    expect(s.dateToX(mid)).toBeCloseTo(210, 6);
  });

  it('xToDate is the inverse of dateToX', () => {
    const d = new Date('2026-04-15');
    expect(s.xToDate(s.dateToX(d)).getTime()).toBeCloseTo(d.getTime(), -2);
  });
});

describe('nodeToDate', () => {
  const mostRecent = '2026-05-20';

  it('uses the date annotation for a tip', () => {
    const d = nodeToDate({ isTip: true, annotations: { date: '2026-05-06', height_mean: 0.04 } }, mostRecent);
    expect(d.getTime()).toBe(new Date('2026-05-06').getTime());
  });

  it('uses mostRecentDate - height_mean (years) for an internal node', () => {
    const h = 0.1694922804893305;
    const d = nodeToDate({ isTip: false, annotations: { height_mean: h } }, mostRecent);
    const expected = new Date(new Date(mostRecent).getTime() - h * MS_PER_YEAR).getTime();
    expect(d.getTime()).toBeCloseTo(expected, -2);
  });

  it('returns null when no date can be resolved', () => {
    expect(nodeToDate({ isTip: false, annotations: {} }, mostRecent)).toBeNull();
    expect(nodeToDate(null, mostRecent)).toBeNull();
  });
});

import { scaleFromAnchors } from './time-scale.js';

describe('scaleFromAnchors', () => {
  const s = scaleFromAnchors({ date0: '2026-03-19', x0: 40, date1: '2026-05-20', x1: 300 });

  it('maps the anchor dates to the anchor pixels', () => {
    expect(s.dateToX('2026-03-19')).toBeCloseTo(40, 6);
    expect(s.dateToX('2026-05-20')).toBeCloseTo(300, 6);
  });

  it('maps the midpoint date to the pixel midpoint', () => {
    const mid = new Date((new Date('2026-03-19').getTime() + new Date('2026-05-20').getTime()) / 2);
    expect(s.dateToX(mid)).toBeCloseTo(170, 6);
  });

  it('xToDate inverts dateToX', () => {
    const d = new Date('2026-04-15');
    expect(s.xToDate(s.dateToX(d)).getTime()).toBeCloseTo(d.getTime(), -2);
  });
});
