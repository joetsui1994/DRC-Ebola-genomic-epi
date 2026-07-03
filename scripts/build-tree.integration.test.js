import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tips = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-tips.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/ituri-meta.json'), 'utf8'));
const tree = readFileSync(join(ROOT, 'public/data/ituri-tree.ptree'), 'utf8');

describe('enriched tree artifacts', () => {
  it('has 35 fully-geocoded tips', () => {
    expect(tips).toHaveLength(35);
    for (const t of tips) {
      expect(t.health_zone).toBeTruthy();
      expect(typeof t.lat).toBe('number');
      expect(typeof t.lon).toBe('number');
      expect(typeof t.exported).toBe('boolean');
    }
  });
  it('has exactly 2 exports and no leftover Lumumba', () => {
    expect(tips.filter((t) => t.exported).map((t) => t.id).sort()).toEqual(['PP_006XCJJ', 'PP_006XXY5']);
    expect(tips.some((t) => t.location === 'Lumumba')).toBe(false);
  });
  it('corrects PP_00711T3 to Rwampara', () => {
    const t = tips.find((x) => x.id === 'PP_00711T3');
    expect(t).toMatchObject({ location: 'Rwampara', health_zone: 'Rwampara', lat: 1.60555, lon: 30.03822 });
  });
  it('meta carries dates + provenance with root before most-recent', () => {
    expect(meta).toMatchObject({ mostRecentDate: '2026-05-26', rootDate: '2026-04-16', tipCount: 35 });
    expect(meta.sourceTree).toBe('Ituri_2026-06-26_n35.EGC.ptree');
    expect(meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.rootDate < meta.mostRecentDate).toBe(true);
  });
  it('injected exactly 35 exported= annotations into the tree', () => {
    expect((tree.match(/exported=/g) || []).length).toBe(35);
  });
});
