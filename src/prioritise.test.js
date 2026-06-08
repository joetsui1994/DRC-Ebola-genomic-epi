import { describe, it, expect } from 'vitest';
import { mulberry32, assignCell, decay, resolveFloorBudget } from './prioritise.js';

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

import { prioritise } from './prioritise.js';

// helper: one bin (decay=1 with lam=Infinity), plenty available
const cell = (location, risk, available, h = 0) => ({ location, timeBin: 0, risk, available, h });
const selectedByLoc = (sel) => sel.reduce((m, p) => (m[p.location] = (m[p.location] || 0) + 1, m), {});

describe('prioritise', () => {
  const base = { origin: '2026-04-05', tNow: '2026-04-05', lam: Infinity, binWidthDays: 7, seed: 1 };

  it('Webster (delta=0.5) tracks risk ratios (4:2:1 over N=7)', () => {
    const cells = [cell('A', 4, 10), cell('B', 2, 10), cell('C', 1, 10)];
    const { selection } = prioritise({ ...base, cells, n: 7, delta: 0.5 });
    expect(selection.length).toBe(7);
    expect(selectedByLoc(selection)).toEqual({ A: 4, B: 2, C: 1 });
  });

  it('coverage: small delta covers every nonzero cell before doubling', () => {
    const cells = [cell('A', 4, 10), cell('B', 2, 10), cell('C', 1, 10)];
    const { selection } = prioritise({ ...base, cells, n: 3, delta: 0.01 });
    expect(selectedByLoc(selection)).toEqual({ A: 1, B: 1, C: 1 });
  });

  it('availability cap: a cell never contributes more than it has', () => {
    const cells = [cell('A', 10, 1), cell('B', 1, 10)];
    const { selection, cellSummary } = prioritise({ ...base, cells, n: 5, delta: 0.5 });
    expect(selectedByLoc(selection)).toEqual({ A: 1, B: 4 });
    expect(cellSummary.find(c => c.location === 'A').available).toBe(1); // reports initial available
  });

  it('history carryover: a heavily-sequenced cell is demoted', () => {
    const cells = [cell('A', 4, 10, 8), cell('B', 4, 10, 0)];  // same risk, A already deep
    const { selection } = prioritise({ ...base, cells, n: 4, delta: 0.5 });
    expect(selectedByLoc(selection).B).toBeGreaterThan(selectedByLoc(selection).A || 0);
  });

  it('recency: with finite lam, the recent bin gets more of equal-risk budget', () => {
    const cells = [
      { location: 'A', timeBin: 6, risk: 1, available: 20, h: 0 },  // recent
      { location: 'A', timeBin: 0, risk: 1, available: 20, h: 0 },  // old
    ];
    const { cellSummary } = prioritise({ origin: '2026-04-05', tNow: '2026-06-01', lam: 14, binWidthDays: 7, seed: 1, cells, n: 10, delta: 0.5 });
    const recent = cellSummary.find(c => c.timeBin === 6).selected;
    const old = cellSummary.find(c => c.timeBin === 0).selected;
    expect(recent).toBeGreaterThan(old);
  });

  it('early stop: all-zero risk selects nothing', () => {
    const { selection } = prioritise({ ...base, cells: [cell('A', 0, 10)], n: 5, delta: 0.5 });
    expect(selection.length).toBe(0);
  });

  it('N larger than pool stops early at availability', () => {
    const { selection } = prioritise({ ...base, cells: [cell('A', 1, 2)], n: 5, delta: 0.5 });
    expect(selection.length).toBe(2);
  });

  it('degenerate delta=0 (Infinity weights) does not crash and covers cells', () => {
    const cells = [cell('A', 4, 10), cell('B', 2, 10), cell('C', 1, 10)];
    const { selection } = prioritise({ ...base, cells, n: 3, delta: 0 });
    expect(selection.length).toBe(3);
    expect(selectedByLoc(selection)).toEqual({ A: 1, B: 1, C: 1 });
  });

  it('determinism: same seed + ids → identical selection', () => {
    const mk = () => [{ location: 'A', timeBin: 0, risk: 4, available: 3, h: 0, ids: ['a1', 'a2', 'a3'] },
                      { location: 'B', timeBin: 0, risk: 1, available: 3, h: 0, ids: ['b1', 'b2', 'b3'] }];
    const s1 = prioritise({ ...base, cells: mk(), n: 4, delta: 0.5 }).selection;
    const s2 = prioritise({ ...base, cells: mk(), n: 4, delta: 0.5 }).selection;
    expect(s1).toEqual(s2);
    expect(s1.every(p => p.sampleId)).toBe(true);
  });
});

describe('resolveFloorBudget', () => {
  it('null cap → full budget', () => {
    expect(resolveFloorBudget(null, 50)).toBe(50);
  });
  it('fraction in (0,1] → ceil(frac*n)', () => {
    expect(resolveFloorBudget(0.2, 50)).toBe(10);
    expect(resolveFloorBudget(0.25, 50)).toBe(13);   // ceil(12.5)
    expect(resolveFloorBudget(1, 50)).toBe(50);      // ceil(1*50)
  });
  it('cap > 1 → floor(cap), clamped to n', () => {
    expect(resolveFloorBudget(5, 50)).toBe(5);
    expect(resolveFloorBudget(2.7, 50)).toBe(2);     // float > 1 is floored
    expect(resolveFloorBudget(80, 50)).toBe(50);     // clamped to n
  });
  it('non-positive cap → 0 (no floor picks)', () => {
    expect(resolveFloorBudget(0, 50)).toBe(0);
    expect(resolveFloorBudget(-1, 50)).toBe(0);
  });
});

describe('coverage floor', () => {
  const floorBase = { origin: '2026-04-05', tNow: '2026-04-05', lam: Infinity, binWidthDays: 7, seed: 1 };
  // A: high risk, already covered (H=3); B,C: low risk, never sequenced (uncovered).
  const mkCells = () => [
    { location: 'A', timeBin: 0, risk: 10, available: 10, h: 0 },
    { location: 'B', timeBin: 0, risk: 1, available: 10, h: 0 },
    { location: 'C', timeBin: 0, risk: 1, available: 10, h: 0 },
  ];
  const locHistory = new Map([['A', 3]]);   // only A has prior history

  it('proportional mode (default) ignores the floor and is unchanged', () => {
    const { selection } = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'proportional' });
    expect(selectedByLoc(selection).A).toBe(5);
  });

  it('both mode floors every uncovered location before the proportional loop', () => {
    const { selection } = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'both', floorSize: 1 });
    const byLoc = selectedByLoc(selection);
    expect(byLoc.B).toBeGreaterThanOrEqual(1);
    expect(byLoc.C).toBeGreaterThanOrEqual(1);
    const floorPicks = selection.filter((s) => s.layer === 'floor');
    expect(floorPicks.length).toBe(2);
    expect(floorPicks.map((s) => s.rank)).toEqual([1, 2]);
    expect(new Set(floorPicks.map((s) => s.location))).toEqual(new Set(['B', 'C']));
    expect(selection.filter((s) => s.layer === 'proportional').length).toBe(3);
  });

  it('floorSize takes multiple per uncovered location, capped at availability', () => {
    const cells = [
      { location: 'A', timeBin: 0, risk: 10, available: 10, h: 0 },
      { location: 'B', timeBin: 0, risk: 1, available: 1, h: 0 },
      { location: 'C', timeBin: 0, risk: 1, available: 10, h: 0 },
    ];
    const { selection } = prioritise({ ...floorBase, cells, locHistory, n: 10, delta: 0.5, mode: 'floor', floorSize: 3 });
    const byLoc = selectedByLoc(selection);
    expect(byLoc.B).toBe(1);
    expect(byLoc.C).toBe(3);
    expect(byLoc.A).toBeUndefined();
  });

  it('floor mode leaves leftover budget unused', () => {
    const { selection } = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 50, delta: 0.5, mode: 'floor', floorSize: 1 });
    expect(selection.length).toBe(2);
    expect(selection.every((s) => s.layer === 'floor')).toBe(true);
  });

  it('floorBudgetCap bounds the floor picks (carry-over)', () => {
    const cells = [
      { location: 'B', timeBin: 0, risk: 1, available: 10, h: 0 },
      { location: 'C', timeBin: 0, risk: 1, available: 10, h: 0 },
      { location: 'D', timeBin: 0, risk: 1, available: 10, h: 0 },
    ];
    const { selection } = prioritise({ ...floorBase, cells, locHistory: new Map(), n: 10, delta: 0.5, mode: 'floor', floorSize: 1, floorBudgetCap: 0.2 });
    expect(selection.filter((s) => s.layer === 'floor').length).toBe(2);
  });

  it('a floored location is demoted in the subsequent proportional loop', () => {
    const cells = [
      { location: 'A', timeBin: 0, risk: 5, available: 10, h: 0 },
      { location: 'B', timeBin: 0, risk: 5, available: 10, h: 0 },
    ];
    const { cellSummary } = prioritise({ ...floorBase, cells, locHistory: new Map(), n: 6, delta: 0.5, mode: 'both', floorSize: 1 });
    const a = cellSummary.find((c) => c.location === 'A');
    const b = cellSummary.find((c) => c.location === 'B');
    expect(a.floorSelected).toBe(1);
    expect(b.floorSelected).toBe(1);
    expect(a.propSelected).toBe(b.propSelected);   // equal risk + equal floor → even proportional split
    expect(a.selected + b.selected).toBe(6);
  });

  it('floor mode with null locHistory treats every location as uncovered', () => {
    const { selection } = prioritise({ ...floorBase, cells: mkCells(), locHistory: null, n: 3, delta: 0.5, mode: 'floor', floorSize: 1 });
    expect(selection.length).toBe(3);   // A, B, C each floored once
    expect(new Set(selection.map((s) => s.location))).toEqual(new Set(['A', 'B', 'C']));
    expect(selection.every((s) => s.layer === 'floor')).toBe(true);
  });

  it('determinism: same seed → identical selection with floor on', () => {
    const s1 = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'both' }).selection;
    const s2 = prioritise({ ...floorBase, cells: mkCells(), locHistory, n: 5, delta: 0.5, mode: 'both' }).selection;
    expect(s1).toEqual(s2);
  });
});
