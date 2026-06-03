// A draggable divider that splits two sibling flex panes *proportionally*.
// Dragging sets each pane's flex-grow to its pixel size, so the panes keep their
// ratio as the container (window) resizes — both respond to the divider AND to
// browser-size changes.
//
// Uses Pointer Events with setPointerCapture so the drag keeps receiving moves
// even when the pointer passes over the tree canvas or the Leaflet map (which
// otherwise capture mouse events and freeze a plain window-listener drag).

/**
 * @param {HTMLElement} gutterEl  the divider element between the two panes
 * @param {HTMLElement} beforeEl  pane before the gutter (left / top)
 * @param {HTMLElement} afterEl   pane after the gutter (right / bottom)
 * @param {'x'|'y'} axis          'x' → widths, 'y' → heights
 * @param {{minBefore?:number,minAfter?:number}} [opts]  per-pane min size in px
 */
export function makeSplitter(gutterEl, beforeEl, afterEl, axis, opts = {}) {
  const isX = axis === 'x';
  const minBefore = opts.minBefore ?? 120;   // px, smallest the before pane may become
  const minAfter  = opts.minAfter  ?? 120;   // px, smallest the after pane may become

  const onMove = (e) => {
    const c = beforeEl.parentElement.getBoundingClientRect();
    const g = gutterEl.getBoundingClientRect();
    const total = (isX ? c.width : c.height) - (isX ? g.width : g.height);
    const pointer = (isX ? e.clientX - c.left : e.clientY - c.top);
    const before = Math.max(minBefore, Math.min(total - minAfter, pointer));
    beforeEl.style.flex = `${before} 1 0`;
    afterEl.style.flex  = `${total - before} 1 0`;
  };

  const onUp = (e) => {
    try { gutterEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    gutterEl.classList.remove('dragging');
    document.body.style.cursor = '';
    gutterEl.removeEventListener('pointermove', onMove);
    gutterEl.removeEventListener('pointerup', onUp);
    gutterEl.removeEventListener('pointercancel', onUp);
  };

  gutterEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    gutterEl.setPointerCapture(e.pointerId);
    gutterEl.classList.add('dragging');
    document.body.style.cursor = isX ? 'col-resize' : 'row-resize';
    gutterEl.addEventListener('pointermove', onMove);
    gutterEl.addEventListener('pointerup', onUp);
    gutterEl.addEventListener('pointercancel', onUp);
  });
}
