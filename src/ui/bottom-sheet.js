// ═══════════════════════════════════════════════════
// BOTTOM SHEET — the mobile results / place panel
// ═══════════════════════════════════════════════════
// Below 701px #panel is a sheet over the full-bleed map with three snap
// points, like a maps app: peek (header only), half and full (just under the
// floating search bar). The sheet is moved with a transform; heights live in
// CSS custom properties so the locate button and snackbar can follow it.
//
// Gestures:
// - the grip, result header and place header always drag the sheet (pointer
//   events, `touch-action: none` in CSS);
// - the scrollable content drags the sheet unless the sheet is full, or when
//   it is full and already scrolled to the top and the finger pulls down
//   (touch events, so the first move can still be cancelled).
// Above 700px every handler is inert and the panel is a normal side panel.

import { t } from '../core/i18n.js';
import { MOBILE_QUERY } from './layout.js';

/** @typedef {'peek'|'half'|'full'} SheetSnap */
/** @typedef {'drag'|'handle'|'program'} SheetChangeSource */
/** @typedef {Record<SheetSnap, number>} SheetHeights */

/** @type {readonly SheetSnap[]} */
export const SHEET_SNAPS = Object.freeze(['peek', 'half', 'full']);
export const SHEET_PEEK_PX = 112;
const HALF_RATIO = 0.45;
const DRAG_SLOP_PX = 8;
const FLING_PX_PER_MS = 0.45;
const DRAG_ZONE_SELECTOR = '#sheet-grip, #result-meta, #place-detail-bar';

/**
 * Visible sheet height for each snap point.
 * @param {number} viewportHeight
 * @param {number} topReserve px kept clear above the full sheet (search + chips)
 * @returns {SheetHeights}
 */
export function sheetSnapHeights(viewportHeight, topReserve) {
  const full = Math.max(SHEET_PEEK_PX, Math.round(viewportHeight - topReserve));
  const half = Math.min(full, Math.max(SHEET_PEEK_PX, Math.round(viewportHeight * HALF_RATIO)));
  const peek = Math.min(half, SHEET_PEEK_PX);
  return { peek, half, full };
}

/**
 * Pick the snap a released drag settles on. A fling moves to the next snap in
 * its direction; a slow release picks the nearest snap.
 * @param {number} visible visible height at release, px
 * @param {number} velocity px/ms; positive means the sheet was growing
 * @param {SheetHeights} heights
 * @returns {SheetSnap}
 */
export function resolveSheetSnap(visible, velocity, heights) {
  if (velocity >= FLING_PX_PER_MS) {
    return SHEET_SNAPS.find(snap => heights[snap] > visible + 1) ?? 'full';
  }
  if (velocity <= -FLING_PX_PER_MS) {
    return [...SHEET_SNAPS].reverse().find(snap => heights[snap] < visible - 1) ?? 'peek';
  }
  let nearest = SHEET_SNAPS[0];
  for (const snap of SHEET_SNAPS) {
    if (Math.abs(heights[snap] - visible) < Math.abs(heights[nearest] - visible)) nearest = snap;
  }
  return nearest;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * @typedef {Object} SheetController
 * @property {(snap: SheetSnap, source?: SheetChangeSource) => void} setSnap
 * @property {() => SheetSnap} getSnap
 * @property {() => number} getVisibleHeight
 * @property {() => boolean} isActive
 * @property {() => void} measure
 */

/** @type {SheetController|null} */
let controller = null;

/**
 * Move the sheet to a snap point. A no-op until the sheet is initialized or
 * above the mobile breakpoint, so shared callers need no layout checks.
 * @param {SheetSnap} snap
 * @param {SheetChangeSource} [source]
 */
export function setSheetSnap(snap, source = 'program') {
  controller?.setSnap(snap, source);
}

/** @returns {SheetSnap} */
export function getSheetSnap() {
  return controller?.getSnap() ?? 'half';
}

/**
 * Visible sheet height at its target snap (not mid-animation), or 0 when the
 * sheet is inactive (desktop or not initialized).
 * @returns {number}
 */
export function getSheetVisibleHeight() {
  return controller?.isActive() ? controller.getVisibleHeight() : 0;
}

/**
 * @param {{
 *   documentRoot?: Document,
 *   initialSnap?: SheetSnap,
 *   onSnapChange?: (snap: SheetSnap, source: SheetChangeSource) => void,
 * }} [options]
 * @returns {SheetController|null}
 */
export function initBottomSheet({ documentRoot = document, initialSnap = 'half', onSnapChange } = {}) {
  const panelElement = documentRoot.getElementById('panel');
  const handleElement = documentRoot.getElementById('sheet-handle');
  const view = documentRoot.defaultView;
  if (!panelElement || !handleElement || !view) return null;
  const panel = panelElement;
  const handle = handleElement;
  const win = view;
  const root = documentRoot.documentElement;
  const appBody = documentRoot.getElementById('app-body');
  const mapTop = documentRoot.getElementById('map-top');
  const mediaQuery = win.matchMedia?.(MOBILE_QUERY) ?? null;

  /** @type {SheetSnap} */
  let snap = initialSnap;
  /** @type {SheetHeights} */
  let heights = sheetSnapHeights(win.innerHeight, 120);
  let active = !!mediaQuery?.matches;
  let suppressHandleClick = false;
  /**
   * @type {null | {
   *   startY: number, startX: number, startVisible: number, lastY: number,
   *   lastT: number, velocity: number, visible: number, dragging: boolean,
   *   decided: boolean, content: boolean, scroller: HTMLElement|null,
   *   pointerId: number|null,
   * }}
   */
  let drag = null;

  function measure() {
    active = !!mediaQuery?.matches;
    const reserve = mapTop ? mapTop.getBoundingClientRect().bottom + 8 : 120;
    heights = sheetSnapHeights(win.innerHeight, reserve);
    panel.style.setProperty('--sheet-h', `${heights.full}px`);
    applyVisible(heights[snap], true);
  }

  /** @param {number} visible @param {boolean} animate */
  function applyVisible(visible, animate) {
    panel.classList.toggle('is-dragging', !animate);
    root.classList.toggle('sheet-dragging', !animate);
    panel.style.setProperty('--sheet-y', `${Math.max(0, Math.round(heights.full - visible))}px`);
    root.style.setProperty('--sheet-visible', active ? `${Math.round(visible)}px` : '0px');
  }

  function syncAttributes() {
    panel.dataset.sheet = snap;
    if (appBody) appBody.dataset.sheet = snap;
    const expanded = snap === 'full';
    const key = expanded ? 'sheet_collapse' : 'sheet_expand';
    handle.setAttribute('aria-expanded', String(expanded));
    handle.dataset.i18nAria = key;
    handle.setAttribute('aria-label', t(key));
  }

  /** @param {SheetSnap} next @param {SheetChangeSource} [source] */
  function setSnap(next, source = 'program') {
    const changed = next !== snap;
    snap = next;
    syncAttributes();
    applyVisible(heights[snap], true);
    if (changed && active) onSnapChange?.(snap, source);
  }

  /** @returns {HTMLElement|null} */
  function activeScroller() {
    const id = panel.dataset.view === 'place' ? 'place-detail-body' : 'loc-list';
    return documentRoot.getElementById(id);
  }

  /** @param {number} x @param {number} y @param {number} time @param {boolean} content */
  function begin(x, y, time, content) {
    drag = {
      startY: y, startX: x, startVisible: heights[snap], lastY: y, lastT: time,
      velocity: 0, visible: heights[snap], dragging: false, decided: !content,
      content, scroller: content ? activeScroller() : null, pointerId: null,
    };
  }

  /** @param {number} y @param {number} time @returns {boolean} whether the sheet moved */
  function move(y, time) {
    if (!drag) return false;
    const rise = drag.startY - y;
    if (!drag.dragging) {
      if (Math.abs(rise) < DRAG_SLOP_PX) return false;
      drag.dragging = true;
    }
    const dt = time - drag.lastT;
    if (dt > 0) drag.velocity = 0.7 * ((drag.lastY - y) / dt) + 0.3 * drag.velocity;
    drag.lastY = y;
    drag.lastT = time;
    drag.visible = clamp(drag.startVisible + rise, heights.peek, heights.full);
    applyVisible(drag.visible, false);
    return true;
  }

  function end() {
    if (!drag) return;
    const finished = drag;
    drag = null;
    if (!finished.dragging) return;
    suppressHandleClick = true;
    setTimeout(() => { suppressHandleClick = false; }, 0);
    setSnap(resolveSheetSnap(finished.visible, finished.velocity, heights), 'drag');
  }

  /** @param {EventTarget|null} target */
  function inDragZone(target) {
    const element = /** @type {Element|null} */ (target);
    return typeof element?.closest === 'function' && !!element.closest(DRAG_ZONE_SELECTOR);
  }

  // Header zones: pointer events cover touch, pen and mouse alike.
  panel.addEventListener('pointerdown', event => {
    if (!active || !event.isPrimary || !inDragZone(event.target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    begin(event.clientX, event.clientY, event.timeStamp, false);
    if (drag) drag.pointerId = event.pointerId;
  });
  panel.addEventListener('pointermove', event => {
    if (!drag || drag.content || drag.pointerId !== event.pointerId) return;
    if (move(event.clientY, event.timeStamp) && !panel.hasPointerCapture?.(event.pointerId)) {
      panel.setPointerCapture?.(event.pointerId);
    }
  });
  panel.addEventListener('pointerup', event => {
    if (drag && !drag.content && drag.pointerId === event.pointerId) end();
  });
  panel.addEventListener('pointercancel', event => {
    if (drag && !drag.content && drag.pointerId === event.pointerId) end();
  });

  // Scrollable content: touch events so a sheet drag can cancel scrolling.
  panel.addEventListener('touchstart', event => {
    if (!active || event.touches.length !== 1 || inDragZone(event.target)) return;
    const touch = event.touches[0];
    begin(touch.clientX, touch.clientY, event.timeStamp, true);
  }, { passive: true });
  panel.addEventListener('touchmove', event => {
    if (!drag || !drag.content) return;
    const touch = event.touches[0];
    if (!touch) return;
    if (!drag.decided) {
      const rise = drag.startY - touch.clientY;
      const sideways = touch.clientX - drag.startX;
      if (Math.max(Math.abs(rise), Math.abs(sideways)) < DRAG_SLOP_PX) return;
      drag.decided = true;
      const atTop = (drag.scroller?.scrollTop ?? 0) <= 0;
      const takeOver = Math.abs(rise) > Math.abs(sideways) &&
        (snap !== 'full' || (rise < 0 && atTop));
      if (!takeOver) {
        drag = null;
        return;
      }
    }
    if (move(touch.clientY, event.timeStamp) && event.cancelable) event.preventDefault();
  }, { passive: false });
  panel.addEventListener('touchend', () => { if (drag?.content) end(); });
  panel.addEventListener('touchcancel', () => { if (drag?.content) end(); });

  handle.addEventListener('click', () => {
    if (suppressHandleClick || !active) return;
    setSnap(snap === 'full' ? 'half' : 'full', 'handle');
  });

  win.addEventListener('resize', measure);
  mediaQuery?.addEventListener?.('change', measure);

  controller = {
    setSnap,
    getSnap: () => snap,
    getVisibleHeight: () => heights[snap],
    isActive: () => active,
    measure,
  };
  syncAttributes();
  measure();
  return controller;
}
