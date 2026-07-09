// src/linelist-source.js
// Which line-list file the app loads, selectable via the `?linelist=` URL param.
// Two named versions; defaults to "dhis" (the current primary source) for absent/unknown values.
export const LINELIST_SOURCES = {
  lab:      { file: 'linelist_data.csv',          label: 'Lab' },
  dhis: { file: 'linelist_data.dhis.csv', label: 'DHIS' },
};

/**
 * Resolve the active line-list source from a URLSearchParams-like object.
 * @param {URLSearchParams} search
 * @returns {{ key: string, file: string, label: string }}
 */
export function resolveLinelistSource(search, sources = LINELIST_SOURCES, fallback = 'dhis') {
  const key = search && search.get ? search.get('linelist') : null;
  const chosen = (key && sources[key]) ? key : fallback;
  return { key: chosen, ...sources[chosen] };
}
