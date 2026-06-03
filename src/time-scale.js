// Pure date↔x scaling and phylogeny-node → calendar-date conversion.
// No DOM access; unit-tested in time-scale.test.js.

export const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/**
 * Build a linear scale from a calendar-date domain to a horizontal pixel range.
 * The pixel range is [padLeft, width - padRight], matching a plot area that has
 * the given left/right padding inside a panel of the given width.
 * @param {{minDate:string|Date, maxDate:string|Date, width:number, padLeft:number, padRight:number}} opts
 */
export function createTimeScale({ minDate, maxDate, width, padLeft, padRight }) {
  const t0 = ms(minDate);
  const t1 = ms(maxDate);
  const x0 = padLeft;
  const x1 = width - padRight;
  const span = t1 - t0 || 1;
  return {
    dateToX(date) { return x0 + ((ms(date) - t0) / span) * (x1 - x0); },
    xToDate(x)    { return new Date(t0 + ((x - x0) / (x1 - x0)) * span); },
    get range()   { return [x0, x1]; },
    get domain()  { return [new Date(t0), new Date(t1)]; },
  };
}

/**
 * Convert a PearTree node descriptor to a calendar Date, or null if unresolvable.
 * - Tip:           uses annotations.date (ISO string).
 * - Internal node: mostRecentDate − annotations.height_mean (years).
 * @param {object|null} descriptor  a PearTree node descriptor (from onNodeSelect)
 * @param {string|Date} mostRecentDate
 * @returns {Date|null}
 */
export function nodeToDate(descriptor, mostRecentDate) {
  if (!descriptor || !descriptor.annotations) return null;
  const a = descriptor.annotations;
  if (descriptor.isTip && a.date) return new Date(a.date);
  const h = parseFloat(a.height_mean);
  if (Number.isFinite(h)) return new Date(ms(mostRecentDate) - h * MS_PER_YEAR);
  return a.date ? new Date(a.date) : null;
}

/**
 * Linear date↔pixel scale defined by two anchor points (date→x). Used to lock a
 * chart's x-axis to an external pixel mapping (e.g. PearTree's view transform).
 * @param {{date0:string|Date, x0:number, date1:string|Date, x1:number}} a
 * @returns {{dateToX:(d:string|Date)=>number, xToDate:(x:number)=>Date}}
 */
export function scaleFromAnchors({ date0, x0, date1, x1 }) {
  const t0 = ms(date0);
  const t1 = ms(date1);
  const span = t1 - t0 || 1;
  const px = x1 - x0;
  return {
    dateToX(d) { return x0 + ((ms(d) - t0) / span) * px; },
    xToDate(x) { return new Date(t0 + ((x - x0) / px) * span); },
  };
}
