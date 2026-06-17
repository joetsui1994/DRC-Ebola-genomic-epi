// src/prioritise-data.js
// Pure: build engine cells from line-list rows + risk + history; parse an upload CSV.
import { assignCell } from './prioritise.js';

const up = (s) => (s || '').toUpperCase().trim();

// DD/MM/YYYY -> ISO; pass through ISO; '' otherwise.
function normDate(d) {
  const s = (d || '').trim();
  if (!s) return '';
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isNaN(+new Date(iso)) ? '' : iso; }
  return isNaN(+new Date(s)) ? '' : s;
}

/**
 * @returns { cells, origin, tNow, locHistory, diagnostics }
 *   cells: [{ location, timeBin, risk, available, h, ids? }]  (location = upper canonical Nom)
 *   locHistory: Map<location, number> — total pre-batch sequenced count per location (H_k)
 *   cellHistory: Map<`location|timeBin`, number> — pre-batch sequenced (phylogeny) count per cell
 *   diagnostics: { kept, dropped, byReason: {notPositive, ctIneligible, badDate, unknownZone} }
 */
export function buildCells({
  candidateRows, sequencedRows = [], inProgressRows = [], risk, canon, ctThreshold, binWidthDays,
  subtractHistory = false, withIds = false, origin = null, tNow = null,
}) {
  const reason = { notPositive: 0, ctIneligible: 0, badDate: 0, unknownZone: 0 };
  const eligible = [];
  for (const r of candidateRows) {
    if (r.status !== 'Positive') { reason.notPositive++; continue; }
    const ct = parseFloat(r.ct);
    if (!Number.isFinite(ct) || ct >= ctThreshold) { reason.ctIneligible++; continue; }
    const date = normDate(r.date);
    if (!date) { reason.badDate++; continue; }
    const loc = up(canon(r.health_zone));
    if (!risk.has(loc)) { reason.unknownZone++; continue; }
    eligible.push({ ...r, date, loc });
  }

  // Normalise the two history sources (phylogeny tips + in-process-of-being-sequenced).
  const normHist = (rows) => {
    const out = [];
    for (const r of rows) {
      const date = normDate(r.date);
      const loc = up(canon(r.health_zone));
      if (date && risk.has(loc)) out.push({ date, loc });
    }
    return out;
  };
  const seq = normHist(sequencedRows);
  const inProg = normHist(inProgressRows);

  const allDates = [...eligible.map((r) => r.date), ...seq.map((r) => r.date), ...inProg.map((r) => r.date)].sort();
  const o = origin || allDates[0] || '2026-01-01';
  const t = tNow || allDates[allDates.length - 1] || o;

  // Per-cell history, tracked separately so the heatmap can show phylogeny sequences
  // and in-process samples as distinct boxes, even though both feed h.
  const tallyCells = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const key = `${r.loc}|${assignCell(r.date, o, binWidthDays)}`;
      m.set(key, (m.get(key) || 0) + 1);
    }
    return m;
  };
  const cellHistory = tallyCells(seq);          // phylogeny only (maroon band)
  const inProgressHistory = tallyCells(inProg); // in-process only (amber band)
  // Combined h(k,t) — both down-weight the cell and reduce availability.
  const hMap = new Map();
  for (const m of [cellHistory, inProgressHistory]) for (const [key, v] of m) hMap.set(key, (hMap.get(key) || 0) + v);

  // Location-level pre-batch history total (H_k) — counts ALL history (phylogeny + in-process),
  // independent of whether the location has candidates this batch (cells drop available<=0 cells).
  const locHistory = new Map();
  for (const r of [...seq, ...inProg]) {
    locHistory.set(r.loc, (locHistory.get(r.loc) || 0) + 1);
  }

  // candidate pool per cell
  const pool = new Map();   // key -> { location, timeBin, count, ids }
  for (const r of eligible) {
    const tb = assignCell(r.date, o, binWidthDays);
    const key = `${r.loc}|${tb}`;
    let p = pool.get(key);
    if (!p) { p = { location: r.loc, timeBin: tb, count: 0, ids: withIds ? [] : null }; pool.set(key, p); }
    p.count++;
    if (withIds) p.ids.push({ sampleId: r.sample_id, rowId: r.row_id || '' });
  }

  const cells = [];
  for (const [key, p] of pool) {
    const h = hMap.get(key) || 0;
    const available = subtractHistory ? Math.max(0, p.count - h) : p.count;
    if (available <= 0) continue;
    cells.push({
      location: p.location, timeBin: p.timeBin, risk: risk.get(p.location),
      available, h, ids: withIds ? p.ids : undefined,
    });
  }

  return { cells, origin: o, tNow: t, locHistory, cellHistory, inProgressHistory, diagnostics: { kept: eligible.length, dropped: candidateRows.length - eligible.length, byReason: reason } };
}

// Normalise a status to the app's four categories, case-insensitively, so an upload
// with lowercase (e.g. DHIS-style "positive") isn't silently dropped. Unknown → passthrough.
const STATUS_CANON = { positive: 'Positive', negative: 'Negative', invalid: 'Invalid', unclassified: 'Unclassified',
  'not yet run': 'Unclassified', undetermined: 'Invalid' };
function normStatus(s) {
  const t = (s || '').trim();
  return STATUS_CANON[t.toLowerCase()] || t;
}

const truthy = (v) => /^(1|true|yes|y)$/i.test((v || '').trim());

/** Required upload columns (header, lower-cased). ct is conditionally required (positives). */
export const REQUIRED_UPLOAD_COLS = ['sample_id', 'health_zone', 'status', 'date'];

/** Parse an uploaded CSV (naive split; header case-insensitive) into rows + header. */
export function parseUpload(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (!lines.length || lines[0] === '') return { rows: [], header: [] };
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iId = idx('sample_id'), iZone = idx('health_zone'), iStatus = idx('status'),
        iCt = idx('ct'), iDate = idx('date'), iArea = idx('health_area'), iSeq = idx('sequenced'),
        iRid = idx('row_id'), iBseq = idx('being_sequenced');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    rows.push({
      row_id: iRid >= 0 ? (c[iRid] || '').trim() : '',
      sample_id: iId >= 0 ? (c[iId] || '').trim() : '',
      health_zone: iZone >= 0 ? (c[iZone] || '').trim() : '',
      health_area: iArea >= 0 ? (c[iArea] || '').trim() : '',
      status: iStatus >= 0 ? normStatus(c[iStatus]) : '',
      ct: iCt >= 0 ? (c[iCt] || '').trim() : '',
      date: normDate(iDate >= 0 ? c[iDate] : ''),
      sequenced: iSeq >= 0 ? truthy(c[iSeq]) : false,
      being_sequenced: iBseq >= 0 ? truthy(c[iBseq]) : false,
    });
  }
  return { rows, header };
}

/**
 * QA an uploaded line list before it is used. Checks for required columns and at
 * least one data row.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateUpload({ rows, header }) {
  if (!header || !header.length) return { ok: false, error: 'The file is empty or has no header row.' };
  const missing = REQUIRED_UPLOAD_COLS.filter((c) => !header.includes(c));
  if (missing.length) return { ok: false, error: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.` };
  if (!rows.length) return { ok: false, error: 'The file has a header but no data rows.' };
  return { ok: true };
}

/**
 * A soft report on a parsed upload (for user feedback): per-status counts, how many
 * rows are undated or have no numeric Ct, and the distinct health zones that don't
 * match the map (using the same canon + risk rule buildCells applies, so it matches
 * what the engine drops). Original zone casing is preserved, in encounter order.
 */
export function summarizeUpload(rows, risk, canon) {
  const byStatus = {};
  let undated = 0, noCt = 0;
  const unknownZones = [];
  const seenUnknown = new Set();
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    if (!r.date) undated++;
    if (!Number.isFinite(parseFloat(r.ct))) noCt++;
    const loc = up(canon(r.health_zone));
    if (!risk.has(loc) && !seenUnknown.has(loc)) { seenUnknown.add(loc); unknownZones.push(r.health_zone); }
  }
  return { total: rows.length, byStatus, undated, noCt, unknownZones };
}
