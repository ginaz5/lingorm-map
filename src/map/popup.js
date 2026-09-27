import { state } from '../core/state.js';

/** @type {() => void} */
let cancelPendingCenter = () => {};

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth <= 700;
}

export function cancelPopupCenter() {
  cancelPendingCenter();
  cancelPendingCenter = () => {};
}

/**
 * HERE adds a bubble unpositioned (body at the map's top-left) and applies its
 * transform on a later render frame, sometimes two frames later. An unpositioned
 * rect can look "stable", so only trust a rect whose centre is on the anchor.
 * @param {any} map
 * @param {{ lat: number, lng: number }} position The bubble's geographic anchor.
 * @param {DOMRect} rect
 * @param {DOMRect} viewport
 */
function isHereBubblePositioned(map, position, rect, viewport) {
  const anchor = map.geoToScreen(position);
  return !!anchor && Math.abs(rect.left + rect.width / 2 - (viewport.left + anchor.x)) <= 2;
}

/**
 * Measure the provider's rendered card, including its padding and close button.
 * Panning by its offset keeps the bubble attached to its geographic anchor.
 * @param {'google'|'here'} provider
 * @param {any} popup
 * @param {{ lat: number, lng: number }} [position] HERE bubble anchor (InfoBubble has no getter).
 */
function centerPopupOnMobile(provider, popup, position) {
  cancelPopupCenter();
  if (!isMobile() || typeof requestAnimationFrame === 'undefined') return;
  const map = state.map;
  const mapElement = document.getElementById('map');
  if (!map || !mapElement) return;

  let cancelled = false;
  let frame = 0;
  let attempts = 0;
  /** @type {DOMRect | null} */
  let previousRect = null;
  /** @type {{ remove: () => void }[]} */
  const listeners = [];
  const cancel = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    listeners.forEach(listener => listener.remove());
  };
  cancelPendingCenter = cancel;

  const measure = () => {
    if (cancelled) return;
    if (!isMobile() || state.map !== map || state.provider !== provider ||
        (provider === 'google' ? state.infoWindow !== popup : state.infoBubble !== popup)) {
      cancel();
      return;
    }
    const viewport = mapElement.getBoundingClientRect();
    // The user may have switched back to the list before the SDK rendered.
    if (!viewport.width || !viewport.height) {
      cancel();
      return;
    }
    const card = provider === 'google'
      ? mapElement.querySelector('.gm-style-iw-c')
      : popup.getElement()?.querySelector('.H_ib_body');
    const rect = card?.getBoundingClientRect();
    attempts++;
    const positioned = !!rect &&
      (provider !== 'here' || (!!position && isHereBubblePositioned(map, position, rect, viewport)));
    // Wait for attachment, SDK positioning, and a stable layout (open animation).
    if (!rect?.width || !rect.height || !positioned || !previousRect ||
        Math.abs(rect.left - previousRect.left) > 0.5 ||
        Math.abs(rect.top - previousRect.top) > 0.5 ||
        Math.abs(rect.width - previousRect.width) > 0.5 ||
        Math.abs(rect.height - previousRect.height) > 0.5) {
      previousRect = positioned && rect ? rect : null;
      if (attempts < 60) frame = requestAnimationFrame(measure);
      else cancel();
      return;
    }

    const dx = rect.left + rect.width / 2 - (viewport.left + viewport.width / 2);
    const dy = rect.top + rect.height / 2 - (viewport.top + viewport.height / 2);
    cancel();
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (provider === 'google') {
      map.panBy(dx, dy);
    } else {
      const center = map.screenToGeo(viewport.width / 2 + dx, viewport.height / 2 + dy);
      if (center) map.setCenter(center, true);
    }
  };

  if (provider === 'google') {
    // Register before setContent/open so even a synchronously rendered popup works.
    listeners.push(popup.addListener('domready', () => {
      cancelAnimationFrame(frame);
      previousRect = null;
      frame = requestAnimationFrame(measure);
    }));
    listeners.push(popup.addListener('close', cancel));
  } else {
    frame = requestAnimationFrame(measure);
  }
}

/** Open the selected location from either a marker or a list card.
 * @param {number} i
 * @param {string} html
 */
export function openLocationPopup(i, html) {
  cancelPopupCenter();
  if (state.provider === 'google' && state.infoWindow && state.markers[i]) {
    const popup = state.infoWindow;
    // Reopen even the same marker so domready runs again after a manual map pan.
    // Close before installing listeners: an SDK close must not cancel the new request.
    popup.close();
    // Mobile positioning owns the pan; avoid racing the SDK's visibility-only pan.
    popup.setOptions({ disableAutoPan: isMobile() });
    centerPopupOnMobile('google', popup);
    popup.setContent(html);
    popup.open({ anchor: state.markers[i], map: state.map });
  } else if (state.provider === 'here' && state.hereUi) {
    if (state.infoBubble) state.hereUi.removeBubble(state.infoBubble);
    const row = state.data[i];
    const position = { lat: parseFloat(row.lat), lng: parseFloat(row.lng) };
    state.infoBubble = new H.ui.InfoBubble(position, { content: html });
    state.hereUi.addBubble(state.infoBubble);
    centerPopupOnMobile('here', state.infoBubble, position);
  }
}
