// src/sample-toggle.js
// Wiring for the header "Sample collected only" toggle (DHIS source). Kept free of
// DOM APIs so it can be unit-tested in plain node: it takes a minimal `toggle`
// object ({ checked }) and consumer callbacks rather than reaching into the document.
import { filterSampleCollected } from './linelist-filter.js';

/**
 * Build a function returning the current filtered *view* of the full line-list.
 * The filter is active only for the DHIS source with the toggle checked; every
 * other case returns all rows (the Lab file has no sample_collected mark).
 * @param {Array} fullLinelist  all parsed rows
 * @param {{ isDhis: boolean, toggle: { checked: boolean }|null }} opts
 * @returns {() => Array}
 */
export function makeViewRows(fullLinelist, { isDhis, toggle }) {
  return () => filterSampleCollected(fullLinelist, isDhis && !!(toggle && toggle.checked));
}

/**
 * Push a filtered rows array to every line-list consumer (map choropleth,
 * time-series panel, prioritisation engine). Order matters: the panels update
 * before the prio global so a throw there can't leave the global ahead of them.
 * @param {Array} rows
 * @param {{ map, ts, setPrioRows: (rows) => void, getPrio: () => ({refresh?:Function}|null) }} consumers
 * @returns {Array} the pushed rows
 */
export function applySampleView(rows, { map, ts, setPrioRows, getPrio }) {
  map.setLinelist(rows);
  ts.setRows(rows);
  setPrioRows(rows);
  getPrio?.()?.refresh?.();
  return rows;
}
