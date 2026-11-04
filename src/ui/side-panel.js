// ═══════════════════════════════════════════════════
// SIDE PANEL — desktop results panel collapse
// ═══════════════════════════════════════════════════
// Above 700px #panel floats on the left of the map and can be collapsed with
// the tab on its right edge to give the map the whole window. The state is a
// data attribute on #app-body; the mobile CSS ignores it.

import { t } from '../core/i18n.js';

let collapsed = false;
/** @type {Document|null} */
let boundDocument = null;
/** @type {((collapsed: boolean) => void)|undefined} */
let onChange;
/** @type {((nextCollapsed: boolean) => void)|undefined} */
let beforeChange;

/** @returns {boolean} */
export function isPanelCollapsed() {
  return collapsed;
}

/** @param {boolean} next */
export function setPanelCollapsed(next) {
  const changed = next !== collapsed;
  const documentRoot = boundDocument;
  // Runs while the map still has its old size, e.g. to keep the view still.
  if (changed && documentRoot) beforeChange?.(next);
  collapsed = next;
  if (!documentRoot) return;
  const appBody = documentRoot.getElementById('app-body');
  if (appBody) appBody.dataset.panel = collapsed ? 'collapsed' : 'open';
  const toggle = documentRoot.getElementById('panel-toggle');
  if (toggle) {
    const key = collapsed ? 'panel_expand' : 'panel_collapse';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.dataset.i18nAria = key;
    toggle.setAttribute('aria-label', t(key));
  }
  if (changed) onChange?.(collapsed);
}

/**
 * @param {{
 *   documentRoot?: Document,
 *   beforeToggle?: (nextCollapsed: boolean) => void,
 *   onToggle?: (collapsed: boolean) => void,
 * }} [options]
 * @returns {{ setCollapsed: (next: boolean) => void }|null}
 */
export function initSidePanel({ documentRoot = document, beforeToggle, onToggle } = {}) {
  const toggle = documentRoot.getElementById('panel-toggle');
  if (!toggle) return null;
  boundDocument = documentRoot;
  beforeChange = beforeToggle;
  onChange = onToggle;
  toggle.addEventListener('click', () => setPanelCollapsed(!collapsed));
  setPanelCollapsed(collapsed);
  return { setCollapsed: setPanelCollapsed };
}
