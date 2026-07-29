import { LOCATION_TYPES } from './csv-parser.js';

/** @typedef {'zh'|'en'} Language */
/** @typedef {{ en: string, zh: string }} LocationTypeLabel */

/** @type {Readonly<Record<string, LocationTypeLabel>>} */
export const LOCATION_TYPE_LABELS = Object.freeze({
  LingOrm: Object.freeze({ en: 'LingOrm', zh: 'LingOrm' }),
  'JKR Picks': Object.freeze({ en: 'JKR Picks', zh: 'JKR 推薦' }),
  'JKR Fan Projects': Object.freeze({ en: 'JKR Fan Projects', zh: 'JKR 應援' }),
  'Admin Picks': Object.freeze({ en: 'Admin Picks', zh: '留友看' }),
});

/**
 * Keep the stored Type value stable while localizing only its visible label.
 * @param {string} type
 * @param {Language} language
 * @returns {string}
 */
export function locationTypeLabel(type, language) {
  return LOCATION_TYPE_LABELS[type]?.[language] ?? type;
}

export { LOCATION_TYPES };
