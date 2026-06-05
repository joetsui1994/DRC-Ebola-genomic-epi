import { describe, it, expect } from 'vitest';
import { mulberry32, assignCell, decay } from './prioritise.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed and in [0,1)', () => {
    const a = mulberry32(1), b = mulberry32(1);
    const xs = [a(), a(), a()], ys = [b(), b(), b()];
    expect(xs).toEqual(ys);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toEqual(mulberry32(2)());
  });
});

describe('assignCell', () => {
  const origin = '2026-04-05';
  it('bins day-offsets by width (floor)', () => {
    expect(assignCell('2026-04-05', origin, 7)).toBe(0);
    expect(assignCell('2026-04-11', origin, 7)).toBe(0);   // day 6
    expect(assignCell('2026-04-12', origin, 7)).toBe(1);   // day 7
    expect(assignCell('2026-04-26', origin, 7)).toBe(3);   // day 21
  });
});

describe('decay', () => {
  const origin = '2026-04-05';
  it('returns 1 when lam is null or infinite', () => {
    expect(decay(0, origin, 7, '2026-06-01', null)).toBe(1);
    expect(decay(0, origin, 7, '2026-06-01', Infinity)).toBe(1);
  });
  it('decays older bins more (monotone in age)', () => {
    const tNow = '2026-06-01';
    const recent = decay(7, origin, 7, tNow, 14);   // newer bin
    const old = decay(0, origin, 7, tNow, 14);       // older bin
    expect(recent).toBeGreaterThan(old);
    expect(recent).toBeLessThanOrEqual(1);
    expect(old).toBeGreaterThan(0);
  });
  it('exp(-age/lam) at the bin midpoint; age floored at 0', () => {
    // bin 0 midpoint = origin + 3.5 days; tNow = origin + 3.5 days => age 0 => 1
    expect(decay(0, origin, 7, '2026-04-08T12:00:00', 14)).toBeCloseTo(1, 6);
  });
});
