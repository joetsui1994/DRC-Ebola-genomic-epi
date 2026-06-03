// Embeds PearTree via the global bundle (window.PearTreeEmbed) and exposes a
// small, app-facing interface. Locks the tree to fit-to-window with explicit
// paddings so its time axis aligns with the time-series panel.

const TREE_URL = '/data/Ituri_2026-05-28_HKY_EGC_rate1.9E-3.HIPSTR.enriched.ptree';

export const TREE_PAD_LEFT = 20;
export const TREE_PAD_RIGHT = 20;

/**
 * @param {string} containerId  id of the element to embed into
 * @returns {Promise<{selectByLocation, clear, onSelect}>}
 */
export async function createTreePanel(containerId) {
  if (!window.PearTreeEmbed) {
    throw new Error('PearTreeEmbed not found — is public/peartree.bundle.min.js loaded?');
  }
  const tree = await window.PearTreeEmbed.embed({
    container: containerId,
    treeUrl: TREE_URL,
    filename: 'Ituri.ptree',
    // Fill the container's height (which is set by the flex/absolute layout)
    // instead of the embed default of 600px, so the tree follows vertical resizes.
    height: '100%',
    // Light chrome; we retint the --pt-* interface variables in style.css.
    ui: {
      theme: 'light',
      // Keep-list of toolbar sections (omitted groups are hidden):
      //  · 'annotations' — Manage palettes / Manage filters / Curate annotations
      //  · 'hideShow'    — collapse/expand subtree + collapse/hide a subclade
      //  · 'colour'      — colour picker / colour selected nodes / highlight clade
      //  · 'order'       — order branches ascending/descending
      //  · 'rotate'      — rotate node / subtree
      //  · 'reroot'      — invert selection / selection mode / reroot / midpoint / temporal root
      //  · 'navigation'  — back/forward history / drill / climb / home
      // The search bar (separate "filter" section) is retained.
      toolbarSections: [
        'fileOps', 'nodeInfo', 'zoom', 'filter', 'panels',
      ],
    },
    settings: {
      // Visual theme: PearTree's built-in "O'Toole" palette (drives branch/tip/
      // node/axis colours and background).
      theme: "O'Toole",
      tipLabelShow: 'off',
      // Time axis calibrated to the tip `date` annotations (ISO strings), shown
      // as calendar dates rather than raw branch-length/height numbers.
      axisShow: 'time',
      axisDateAnnotation: 'date',
      axisDateFormat: 'MMM yyyy',
      axisMajorInterval: 'months',     // one major tick per month
      axisMajorLabelFormat: 'full',    // label it "Mar 2026" etc. (not a bare "04")
      axisMinorInterval: 'weeks',      // weekly minor ticks…
      axisMinorLabelFormat: 'off',     // …unlabelled, just for granularity
      // Distinct selection highlight — yellow to match the map's selected marker,
      // with a thicker opaque border and a bigger grow so it stands out from the
      // mauve tip / teal node colours. (These selection keys take as embed
      // init-settings; applySettings does NOT support them.)
      selectedTipFillColor: '#f2c84b',
      selectedTipStrokeColor: '#9a7a16',
      selectedTipStrokeWidth: '2',
      selectedTipStrokeOpacity: '1',
      selectedTipFillOpacity: '0.65',
      selectedTipGrowthFactor: '1.9',
      selectedTipMinSize: '6',
      selectedNodeFillColor: '#f2c84b',
      selectedNodeStrokeColor: '#9a7a16',
      selectedNodeStrokeWidth: '2',
      selectedNodeStrokeOpacity: '1',
      selectedNodeFillOpacity: '0.65',
      selectedNodeGrowthFactor: '1.9',
      selectedNodeMinSize: '6',
      // Alignment-critical geometry (keep regardless of theme).
      paddingLeft: String(TREE_PAD_LEFT),
      paddingRight: String(TREE_PAD_RIGHT),
      rootStubLength: '0',
      rootStemPct: '0',
    },
  });

  // Marker sizes: applyTheme("O'Toole") leaves these unset, so set them after the
  // theme. `nodeSize` = internal-node markers, `tipSize` = tip markers (the
  // "Node shapes" / "Tip shapes" sliders). applySettings supports both and runs
  // last. Re-apply on each tree load.
  const SHAPE_SIZES = { nodeSize: '3', tipSize: '4' };
  tree.applySettings(SHAPE_SIZES);

  // Fit the whole tree once loaded (static-alignment baseline; PearTree observes
  // its own container so it refits on resize).
  tree.onTreeLoad(() => { tree.fitToWindow(); tree.applySettings(SHAPE_SIZES); });

  return {
    /**
     * Select tips by their accession (== leaf name). PearTree's setSelection
     * keys on internal node ids (not names), so we select via the `accession`
     * annotation instead — additively, one per tip.
     */
    selectByNames(names) {
      (names || []).forEach((nm, i) => tree.selectByAnnotation('accession', nm, { additive: i > 0 }));
    },
    /** Clear the selection. */
    clear() { tree.setSelection([]); },
    /** Subscribe to selection changes: cb({ target, selected, mrca }). */
    onSelect(cb) { return tree.onNodeSelect(cb); },
    /** Subscribe to view-transform changes: cb({ offsetX, scaleX, maxX }). */
    onViewChange(cb) { return tree.onViewChange(cb); },
    /** Snapshot the current view transform, or null. */
    getViewTransform() { return tree.getViewTransform(); },
  };
}
