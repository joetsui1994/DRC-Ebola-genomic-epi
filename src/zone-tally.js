// src/zone-tally.js
// Tally line-list rows into per-zone status counts + positive-Ct lists, optionally
// restricted to a time window. Pure (no DOM); shared by the initial render and the
// brush's windowed recompute. Rows carry a canonical health_zone (parseLinelist applies it).
const ZONE_STATUS = ['Positive', 'Negative', 'Invalid', 'Unclassified'];
const up = (s) => (s || '').toUpperCase().trim();

/**
 * @param {{health_zone:string,status:string,date:string,ct:string}[]} rows
 * @param {{d0:number,d1:number}|null} window  inclusive ms bounds, or null for all rows
 * @returns {{ zoneCounts: Map<string,object>, zonePosCt: Map<string,number[]> }}  keyed by UPPER Nom
 */
export function tallyZones(rows, window = null) {
  const zoneCounts = new Map();
  const zonePosCt = new Map();
  for (const r of rows) {
    if (window) {
      const t = +new Date(r.date);
      if (isNaN(t) || t < window.d0 || t > window.d1) continue;   // undated / out-of-window dropped
    }
    const z = up(r.health_zone);
    if (!z) continue;
    if (ZONE_STATUS.includes(r.status)) {
      let o = zoneCounts.get(z);
      if (!o) { o = { Positive: 0, Negative: 0, Invalid: 0, Unclassified: 0, total: 0 }; zoneCounts.set(z, o); }
      o[r.status]++; o.total++;
    }
    if (r.status === 'Positive') {
      const v = parseFloat(r.ct);
      if (Number.isFinite(v)) {
        if (!zonePosCt.has(z)) zonePosCt.set(z, []);
        zonePosCt.get(z).push(v);
      }
    }
  }
  return { zoneCounts, zonePosCt };
}
