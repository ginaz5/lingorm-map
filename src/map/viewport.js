// ═══════════════════════════════════════════════════
// MAP VIEWPORT — keep places inside the uncovered map area
// ═══════════════════════════════════════════════════
// The map is full-bleed under floating UI: the search bar and chips on top,
// the bottom sheet on mobile, the side panel on desktop. These helpers turn
// that UI into insets so centering and bound fitting aim at the visible part
// of the map. Insets come from the panel's target state (sheet snap, panel
// collapse), not its animated position, so a pan started mid-transition still
// lands in the right place.

import { state } from '../core/state.js';
import { isMobileLayout } from '../ui/layout.js';
import { getSheetVisibleHeight } from '../ui/bottom-sheet.js';
import { isPanelCollapsed } from '../ui/side-panel.js';

/** @typedef {{ top: number, right: number, bottom: number, left: number }} Insets */
/** @typedef {{ lat: number, lng: number }} LatLng */

/** Below this much uncovered map, ignore the covering UI instead of squeezing. */
const MIN_VISIBLE_HEIGHT_PX = 96;
const MIN_VISIBLE_WIDTH_PX = 160;

/** @returns {Insets} */
function zeroInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/** @param {number} value @param {number} max */
function clampInset(value, max) {
  return Number.isFinite(value) ? Math.min(Math.max(0, Math.round(value)), max) : 0;
}

/**
 * Measure how much of the map each floating control covers.
 * @returns {Insets}
 */
export function getMapInsets() {
  if (typeof document === 'undefined') return zeroInsets();
  const mapElement = document.getElementById('map');
  const width = mapElement?.clientWidth ?? 0;
  const height = mapElement?.clientHeight ?? 0;
  if (!mapElement || !width || !height) return zeroInsets();

  const insets = zeroInsets();
  const rect = typeof mapElement.getBoundingClientRect === 'function'
    ? mapElement.getBoundingClientRect()
    : { top: 0, left: 0, bottom: height };
  const top = document.getElementById('map-top');
  if (top && typeof top.getBoundingClientRect === 'function') {
    insets.top = clampInset(top.getBoundingClientRect().bottom - rect.top, height);
  }
  if (isMobileLayout()) {
    // The map ends at the peek sheet (styles.css), so only the part of the
    // sheet above that line covers it.
    const sheetTop = window.innerHeight - getSheetVisibleHeight();
    insets.bottom = clampInset(rect.bottom - sheetTop, height);
  } else if (!isPanelCollapsed()) {
    // The open panel normally sits beside the map; this guards overlap only.
    const panel = document.getElementById('panel');
    const panelRight = (panel?.offsetLeft ?? 0) + (panel?.offsetWidth ?? 0);
    insets.left = clampInset(panelRight - rect.left, width);
  }

  if (height - insets.top - insets.bottom < MIN_VISIBLE_HEIGHT_PX) {
    insets.bottom = Math.max(0, height - insets.top - MIN_VISIBLE_HEIGHT_PX);
  }
  if (width - insets.left - insets.right < MIN_VISIBLE_WIDTH_PX) insets.left = 0;
  return insets;
}

/**
 * Screen offset, from the map centre, of the centre of the uncovered area.
 * @param {Insets} insets
 * @returns {{ x: number, y: number }}
 */
export function visibleCenterOffset(insets) {
  return { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
}

/**
 * Fit padding that keeps results clear of the covering UI.
 * @param {number} base
 * @param {Insets} insets
 * @returns {Insets}
 */
export function fitPadding(base, insets) {
  return {
    top: base + insets.top,
    right: base + insets.right,
    bottom: base + insets.bottom,
    left: base + insets.left,
  };
}

/**
 * Centre the active provider on `point` so it lands in the middle of the
 * uncovered map area. Keeps the current zoom when `zoom` is omitted.
 * @param {LatLng} point
 * @param {{ zoom?: number }} [options]
 * @returns {boolean} whether a map was moved
 */
export function centerMapOn(point, { zoom } = {}) {
  const map = state.map;
  if (!map) return false;
  const offset = visibleCenterOffset(getMapInsets());
  const shifted = Math.abs(offset.x) >= 1 || Math.abs(offset.y) >= 1;

  if (state.provider === 'google') {
    map.setCenter(point);
    if (zoom !== undefined) map.setZoom(zoom);
    // panBy(dx, dy) moves the view, so content (the point) moves by -dx, -dy.
    if (shifted) map.panBy(0 - offset.x, 0 - offset.y);
    return true;
  }
  if (state.provider === 'here') {
    map.setCenter(point);
    if (zoom !== undefined) map.setZoom(zoom);
    const mapElement = typeof document === 'undefined' ? null : document.getElementById('map');
    if (shifted && mapElement) {
      const target = map.screenToGeo(
        mapElement.clientWidth / 2 - offset.x,
        mapElement.clientHeight / 2 - offset.y,
      );
      if (target) map.setCenter(target, true);
    }
    return true;
  }
  return false;
}

/**
 * Shift the map centre by a horizontal screen offset without animation.
 * Used to keep the map still while the desktop side panel resizes the map
 * container: call it before the resize, with the old container size.
 * @param {number} dx px; positive moves the view east
 * @returns {boolean} whether a map was moved
 */
export function shiftCenterByPixels(dx) {
  const map = state.map;
  const mapElement = typeof document === 'undefined' ? null : document.getElementById('map');
  const width = mapElement?.clientWidth ?? 0;
  if (!map || !dx || !width) return false;
  if (state.provider === 'google') {
    const bounds = map.getBounds?.();
    const center = map.getCenter?.();
    if (!bounds || !center) return false;
    // Longitude is linear in screen x under Web Mercator.
    let span = bounds.getNorthEast().lng() - bounds.getSouthWest().lng();
    if (span < 0) span += 360;
    map.setCenter({ lat: center.lat(), lng: center.lng() + dx * span / width });
    return true;
  }
  if (state.provider === 'here') {
    const target = map.screenToGeo(width / 2 + dx, (mapElement?.clientHeight ?? 0) / 2);
    if (!target) return false;
    map.setCenter(target);
    return true;
  }
  return false;
}

/** Tell the active provider its container changed size (HERE needs this). */
export function resizeMap() {
  if (!state.map) return;
  if (state.provider === 'google') google.maps.event.trigger(state.map, 'resize');
  else if (state.provider === 'here') state.map.getViewPort().resize();
}

/** @type {{ point: LatLng, zoom?: number }|null} */
let pendingFocus = null;

/**
 * Centre on a place now, or as soon as a provider finishes initializing
 * (shared `?place=` links usually open before the map script loads).
 * @param {LatLng} point
 * @param {{ zoom?: number }} [options]
 */
export function focusWhenReady(point, options = {}) {
  if (centerMapOn(point, options)) {
    pendingFocus = null;
    return;
  }
  pendingFocus = { point, ...options };
}

/** Drop a pending focus, e.g. when the selection is cleared first. */
export function cancelPendingFocus() {
  pendingFocus = null;
}

/** Run a deferred focus; called by each provider after it builds markers. */
export function flushPendingFocus() {
  if (!pendingFocus || !state.map) return false;
  const { point, zoom } = pendingFocus;
  pendingFocus = null;
  return centerMapOn(point, zoom === undefined ? {} : { zoom });
}
