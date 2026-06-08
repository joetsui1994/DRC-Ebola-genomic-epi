import { describe, it, expect } from 'vitest';
import { ctPass, extentFraction } from './timeseries-panel.js';

const T0 = +new Date('2026-04-05');   // tree root
const T1 = +new Date('2026-05-20');   // tree most-recent
const row = (date, status = 'Positive', ct = '24') => ({ date, status, ct });

describe('ctPass', () => {
  it('passes non-positives regardless of Ct', () => {
    expect(ctPass(row('2026-05-01', 'Negative', ''), 30)).toBe(true);
  });
  it('passes positives when the filter is off (ct null)', () => {
    expect(ctPass(row('2026-05-01', 'Positive', '40'), null)).toBe(true);
  });
  it('filters positives at/above the threshold or without a numeric Ct', () => {
    expect(ctPass(row('2026-05-01', 'Positive', '33'), 30)).toBe(false);
    expect(ctPass(row('2026-05-01', 'Positive', ''), 30)).toBe(false);
    expect(ctPass(row('2026-05-01', 'Positive', '24'), 30)).toBe(true);
  });
});

describe('extentFraction', () => {
  it('off → effMax=t1, f=1', () => {
    const r = [row('2026-06-03')];
    expect(extentFraction(r, T0, T1, false, null)).toEqual({ effMax: T1, f: 1 });
  });
  it('on with a later row → extends and shrinks proportionally', () => {
    const { effMax, f } = extentFraction([row('2026-06-03')], T0, T1, true, null);
    expect(effMax).toBe(+new Date('2026-06-03'));
    expect(f).toBeCloseTo((T1 - T0) / (+new Date('2026-06-03') - T0), 4);  // ~0.763
  });
  it('on but no row past t1 → f=1', () => {
    expect(extentFraction([row('2026-05-10')], T0, T1, true, null).f).toBe(1);
  });
  it('a beyond-tree positive hidden by the Ct filter does NOT extend', () => {
    expect(extentFraction([row('2026-06-03', 'Positive', '35')], T0, T1, true, 30).effMax).toBe(T1);
  });
  it('the same point extends when the filter is off / below threshold', () => {
    expect(extentFraction([row('2026-06-03', 'Positive', '35')], T0, T1, true, null).effMax)
      .toBe(+new Date('2026-06-03'));
  });
  it('a beyond-tree non-positive still extends (it is plotted)', () => {
    expect(extentFraction([row('2026-06-03', 'Negative', '')], T0, T1, true, 30).effMax)
      .toBe(+new Date('2026-06-03'));
  });
  it('ignores rows with a status not in STATUS', () => {
    expect(extentFraction([row('2026-06-03', 'Suspected', '')], T0, T1, true, null).effMax).toBe(T1);
  });
  it('clamps f to the floor for a far outlier', () => {
    const { f } = extentFraction([row('2027-01-01')], T0, T1, true, null);
    expect(f).toBe(0.4);
  });
});

import { brushWindow } from './timeseries-panel.js';

describe('brushWindow', () => {
  const scale = { xToDate: (x) => new Date(+new Date('2026-04-05') + x * 86400000) };  // 1px = 1 day
  it('returns null for a click (drag below the px threshold)', () => {
    expect(brushWindow(100, 102, scale, 3)).toBeNull();
  });
  it('orders the window regardless of drag direction', () => {
    const a = brushWindow(10, 40, scale, 3);
    const b = brushWindow(40, 10, scale, 3);
    expect(a).toEqual(b);
    expect(a.d0).toBe(+scale.xToDate(10));
    expect(a.d1).toBe(+scale.xToDate(40));
  });
});
