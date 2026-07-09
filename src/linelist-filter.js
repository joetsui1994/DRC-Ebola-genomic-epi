// src/linelist-filter.js
// Filter for the header "Sample collected only" toggle (DHIS source). When
// `sampleOnly` is true, keep only rows with a collected sample; otherwise return
// the array unchanged. Rows parsed from a file without a `sample_collected`
// column default to true in parseLinelist, so a source lacking the column is
// unaffected by the filter.
export function filterSampleCollected(rows, sampleOnly) {
  return sampleOnly ? rows.filter((r) => r.sample_collected) : rows;
}
