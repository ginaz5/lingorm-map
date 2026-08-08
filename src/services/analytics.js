import { lang } from '../core/i18n.js';
import { state } from '../core/state.js';

/** @typedef {import('../data/csv-parser.js').LocationRow} LocationRow */
/** @typedef {'list_card'|'map_marker'|'popup'|'unknown'} InteractionSource */
/** @typedef {'directions'|'open_google_maps'} LocationAction */
/** @typedef {'add'|'remove'} FavoriteAction */
/** @typedef {'category'|'type'|'destination'|'favorites'} FilterType */
/** @typedef {'set'|'select'|'deselect'|'clear'|'enable'|'disable'} FilterAction */
/** @typedef {'success'|'denied'|'timeout'|'unavailable'|'unsupported'|'map_unavailable'} LocateResult */

/**
 * Queue an application event for Google Tag Manager. The queue remains useful
 * when GTM loads after the interaction and is harmless when analytics is
 * blocked by the browser.
 *
 * @param {string} eventName
 * @param {Record<string, string|number|boolean>} [parameters]
 * @returns {boolean} Whether the event was queued in a browser context.
 */
export function trackEvent(eventName, parameters = {}) {
  if (typeof window === 'undefined') return false;

  const analyticsWindow = /** @type {Window & {dataLayer?: Record<string, unknown>[]}} */ (window);
  analyticsWindow.dataLayer = analyticsWindow.dataLayer || [];
  analyticsWindow.dataLayer.push({ ...parameters, event: eventName });
  return true;
}

/** @returns {Record<string, string>} */
function interactionParameters() {
  return {
    map_provider: state.provider || 'unavailable',
    ui_language: lang,
  };
}

/**
 * @param {LocationRow} row
 * @returns {Record<string, string>}
 */
function locationParameters(row) {
  return {
    location_id: row.id,
    location_name: row.nameEn || row.nameZh,
    location_category: row.catEn || row.catZh,
    location_type: row.type || 'unspecified',
    destination: row.destinationKey || 'unspecified',
    ...interactionParameters(),
  };
}

/** @param {LocationRow} row @param {InteractionSource} source */
export function trackLocationOpen(row, source) {
  return trackEvent('location_open', {
    ...locationParameters(row),
    interaction_source: source,
  });
}

/**
 * @param {LocationRow} row
 * @param {LocationAction} action
 * @param {InteractionSource} source
 */
export function trackLocationAction(row, action, source) {
  return trackEvent('location_action', {
    ...locationParameters(row),
    action,
    interaction_source: source,
  });
}

/**
 * @param {LocationRow} row
 * @param {FavoriteAction} action
 * @param {InteractionSource} source
 */
export function trackFavoriteToggle(row, action, source) {
  return trackEvent('favorite_toggle', {
    ...locationParameters(row),
    favorite_action: action,
    interaction_source: source,
  });
}

/**
 * @param {FilterType} filterType
 * @param {string} filterValue
 * @param {number} resultCount
 * @param {FilterAction} [filterAction]
 * @param {number} [selectedCount]
 */
export function trackFilterApply(
  filterType,
  filterValue,
  resultCount,
  filterAction = 'set',
  selectedCount = filterValue === 'all' ? 0 : 1,
) {
  return trackEvent('filter_apply', {
    ...interactionParameters(),
    filter_type: filterType,
    filter_value: filterValue,
    filter_action: filterAction,
    selected_count: selectedCount,
    result_count: resultCount,
  });
}

/** @param {number} queryLength @param {number} resultCount */
export function trackSearchComplete(queryLength, resultCount) {
  return trackEvent('search_complete', {
    ...interactionParameters(),
    query_length: queryLength,
    result_count: resultCount,
    has_results: resultCount > 0,
  });
}

/** @param {LocateResult} result */
export function trackLocateResult(result) {
  return trackEvent('locate_result', {
    ...interactionParameters(),
    result,
  });
}

/** @param {'map'|'list'} tab */
export function trackTabView(tab) {
  return trackEvent('tab_view', {
    ...interactionParameters(),
    tab,
  });
}

/** @param {'zh'|'en'} fromLanguage @param {'zh'|'en'} toLanguage */
export function trackLanguageChange(fromLanguage, toLanguage) {
  return trackEvent('language_change', {
    ...interactionParameters(),
    from_language: fromLanguage,
    to_language: toLanguage,
  });
}
