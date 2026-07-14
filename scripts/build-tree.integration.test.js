import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tips = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-tips.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-meta.json'), 'utf8'));
const tree = readFileSync(join(ROOT, 'public/data/ituri-tree.ptree'), 'utf8');

const MS_PER_YEAR = 365.25 * 86400000;

describe('enriched n134 tree artifacts', () => {
  it('has 134 fully-geocoded tips with full dates', () => {
    expect(tips).toHaveLength(134);
    for (const t of tips) {
      expect(t.health_zone).toBeTruthy();
      expect(typeof t.lat).toBe('number');
      expect(typeof t.lon).toBe('number');
      expect(typeof t.exported).toBe('boolean');
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);   // no leftover YYYY-MM
    }
  });
  it('has no exports and resolves Sota to Nyakunde', () => {
    expect(tips.filter((t) => t.exported)).toHaveLength(0);
    const sota = tips.find((t) => t.location === 'Sota');
    expect(sota.health_zone).toBe('Nyakunde');
  });
  it('meta carries dates + provenance with root before most-recent', () => {
    expect(meta).toMatchObject({ mostRecentDate: '2026-06-23', rootDate: '2026-03-14', tipCount: 134 });
    expect(meta.sourceTree).toBe('Ituri2026.DRC_trimmed_n134_GTR_SG.HIPSTR.tree');
    expect(meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.rootDate < meta.mostRecentDate).toBe(true);
  });
  it('is clock-consistent: tip date vs height implied-reference spread < 2 days', () => {
    // reconstruct each tip's height from the tree and check date + height agree
    const h = new Map();
    for (const m of tree.matchAll(/accession="([^"]+)"[^\]]*height_mean=([0-9.eE+-]+)/g)) {
      h.set(m[1], Number(m[2]));
    }
    const refs = tips.filter((t) => h.has(t.id))
      .map((t) => Date.parse(t.date) + h.get(t.id) * MS_PER_YEAR);
    const spreadDays = (Math.max(...refs) - Math.min(...refs)) / 86400000;
    expect(spreadDays).toBeLessThan(2);
  });
  it('injected exactly 134 accession annotations into the tree', () => {
    expect((tree.match(/accession="/g) || []).length).toBe(134);
  });
});
