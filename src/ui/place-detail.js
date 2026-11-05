// ═══════════════════════════════════════════════════
// PLACE DETAIL — the selected location, shown inside #panel
// ═══════════════════════════════════════════════════
// Selecting a marker or a list card swaps the panel from the results list to
// a detail view (name, collection, actions, notes, exchange rates, sources).
// This replaces the provider InfoWindow / InfoBubble popups, so Google and
// HERE share one place UI and only map panning stays provider-specific.

import { state } from '../core/state.js';
import { buildPlaceDetailContent } from './render.js';
import { setSheetSnap } from './bottom-sheet.js';
import { setPanelCollapsed } from './side-panel.js';
import { isMobileLayout } from './layout.js';

let savedListScroll = 0;

/** @param {string} id @returns {HTMLElement|null} */
function byId(id) {
  return typeof document === 'undefined' ? null : document.getElementById(id);
}

/** @returns {boolean} */
export function isPlaceDetailOpen() {
  const detail = byId('place-detail');
  return !!detail && detail.hidden === false;
}

/** @param {boolean} showPlace */
function setView(showPlace) {
  const panel = byId('panel');
  const results = byId('panel-results');
  const detail = byId('place-detail');
  if (panel) panel.dataset.view = showPlace ? 'place' : 'results';
  if (results) results.hidden = showPlace;
  if (detail) detail.hidden = !showPlace;
}

/**
 * Render location `i` into the panel and reveal it: half-height sheet on
 * mobile, expanded side panel on desktop. Call before panning the map so the
 * map insets already reflect the final panel size.
 * @param {number} i
 * @returns {boolean} whether the detail view exists and was rendered
 */
export function openPlaceDetail(i) {
  const body = byId('place-detail-body');
  if (!body || !state.data[i]) return false;
  const list = byId('loc-list');
  if (!isPlaceDetailOpen() && list) savedListScroll = list.scrollTop;
  body.innerHTML = buildPlaceDetailContent(i);
  body.scrollTop = 0;
  setView(true);
  if (isMobileLayout()) {
    // Always snap (idempotent): also settles a gesture still in progress.
    setSheetSnap('half');
  } else {
    setPanelCollapsed(false);
  }
  return true;
}

/**
 * Return the panel to the results list at its previous scroll position.
 * Does not clear the selection; map.clearActiveLocation owns that.
 */
export function closePlaceDetail() {
  if (!isPlaceDetailOpen()) return;
  setView(false);
  const body = byId('place-detail-body');
  if (body) body.innerHTML = '';
  const list = byId('loc-list');
  if (list) list.scrollTop = savedListScroll;
}

/** Forget the saved list position, e.g. when the list is reset to its top. */
export function resetSavedListScroll() {
  savedListScroll = 0;
}

/**
 * Re-render the open detail, e.g. after a language or exchange-rate change.
 * @returns {boolean} whether an open detail was updated
 */
export function refreshPlaceDetail() {
  if (state.activeIdx < 0 || !isPlaceDetailOpen()) return false;
  const body = byId('place-detail-body');
  if (!body || !state.data[state.activeIdx]) return false;
  const scrollTop = body.scrollTop;
  body.innerHTML = buildPlaceDetailContent(state.activeIdx);
  body.scrollTop = scrollTop;
  return true;
}

/**
 * Wire the back button.
 * @param {{ onClose: () => void }} options
 */
export function initPlaceDetail({ onClose }) {
  byId('place-detail-back')?.addEventListener('click', onClose);
}
