// ═══════════════════════════════════════════════════
// LAYOUT — shared breakpoint for the map-first layout
// ═══════════════════════════════════════════════════
// Below 701px the results panel is a draggable bottom sheet; above it the
// panel floats on the left of a full-bleed map. CSS uses the same breakpoint.

export const MOBILE_MAX_WIDTH = 700;
export const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}px)`;

/** @returns {boolean} */
export function isMobileLayout() {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_MAX_WIDTH;
}
