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
 *   diagnostics: { kept, dropped, byReason: {notPositive, ctIneligible, badDate, unknownZone} }
 */
export function buildCells({
  candidateRows, sequencedRows = [], risk, canon, ctThreshold, binWidthDays,
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

  const seq = [];
  for (const r of sequencedRows) {
    const date = normDate(r.date);
    const loc = up(canon(r.health_zone));
    if (date && risk.has(loc)) seq.push({ date, loc });
  }

  const allDates = [...eligible.map((r) => r.date), ...seq.map((r) => r.date)].sort();
  const o = origin || allDates[0] || '2026-01-01';
  const t = tNow || allDates[allDates.length - 1] || o;

  // h per cell from history
  const hMap = new Map();
  for (const r of seq) {
    const key = `${r.loc}|${assignCell(r.date, o, binWidthDays)}`;
    hMap.set(key, (hMap.get(key) || 0) + 1);
  }

  // location-level pre-batch history total (H_k) — counts ALL history, independent of
  // whether the location has candidates this batch (cells drop available<=0 cells).
  const locHistory = new Map();
  for (const r of seq) {
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
    if (withIds) p.ids.push(r.sample_id);
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

  return { cells, origin: o, tNow: t, locHistory, diagnostics: { kept: eligible.length, dropped: candidateRows.length - eligible.length, byReason: reason } };
}

/** Parse an uploaded CSV (naive split; header case-insensitive) into rows. */
export function parseUpload(text) {
  const lines = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  if (!lines.length) return { rows: [], header: [] };
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const iId = idx('sample_id'), iZone = idx('health_zone'), iStatus = idx('status'),
        iCt = idx('ct'), iDate = idx('date'), iArea = idx('health_area'), iSeq = idx('sequenced');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    rows.push({
      sample_id: iId >= 0 ? (c[iId] || '').trim() : '',
      health_zone: iZone >= 0 ? (c[iZone] || '').trim() : '',
      health_area: iArea >= 0 ? (c[iArea] || '').trim() : '',
      status: iStatus >= 0 ? (c[iStatus] || '').trim() : '',
      ct: iCt >= 0 ? (c[iCt] || '').trim() : '',
      date: normDate(iDate >= 0 ? c[iDate] : ''),
      sequenced: iSeq >= 0 ? /^(1|true|yes|y)$/i.test((c[iSeq] || '').trim()) : false,
    });
  }
  return { rows, header };
}
