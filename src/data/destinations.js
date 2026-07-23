/**
 * Canonical country and destination taxonomy shared by the snapshot
 * validator, parser, and filter UI. Location rows store only stable keys;
 * translated labels remain centralized here.
 */

/** @typedef {'zh'|'en'} Language */
/** @typedef {{ code: string, en: string, zh: string, flag: string }} Country */
/** @typedef {{ key: string, countryCode: string, en: string, zh: string }} Destination */

/** @type {readonly Country[]} */
export const COUNTRIES = Object.freeze([
  { code: 'TH', en: 'Thailand', zh: '泰國', flag: '🇹🇭' },
  { code: 'VN', en: 'Vietnam', zh: '越南', flag: '🇻🇳' },
]);

/** @type {readonly Destination[]} */
export const DESTINATIONS = Object.freeze([
  { key: 'bangkok', countryCode: 'TH', en: 'Bangkok', zh: '曼谷' },
  { key: 'khon-kaen', countryCode: 'TH', en: 'Khon Kaen', zh: '孔敬' },
  { key: 'chiang-mai', countryCode: 'TH', en: 'Chiang Mai', zh: '清邁' },
  { key: 'khao-yai', countryCode: 'TH', en: 'Khao Yai', zh: '考艾' },
  { key: 'koh-samui', countryCode: 'TH', en: 'Koh Samui', zh: '蘇梅島' },
  { key: 'pattaya', countryCode: 'TH', en: 'Pattaya', zh: '芭達雅' },
  { key: 'ubon-ratchathani', countryCode: 'TH', en: 'Ubon Ratchathani', zh: '烏汶' },
  { key: 'ho-chi-minh-city', countryCode: 'VN', en: 'Ho Chi Minh City', zh: '胡志明市' },
]);

export const COUNTRY_CODES = Object.freeze(COUNTRIES.map(country => country.code));
export const DESTINATION_KEYS = Object.freeze(DESTINATIONS.map(destination => destination.key));

const COUNTRY_BY_CODE = new Map(COUNTRIES.map(country => [country.code, country]));
const DESTINATION_BY_KEY = new Map(
  DESTINATIONS.map(destination => [destination.key, destination])
);

/** @param {string} code @returns {Country|undefined} */
export function getCountry(code) {
  return COUNTRY_BY_CODE.get(code);
}

/** @param {string} key @returns {Destination|undefined} */
export function getDestination(key) {
  return DESTINATION_BY_KEY.get(key);
}

/** @param {string} countryCode @returns {Destination[]} */
export function destinationsForCountry(countryCode) {
  return DESTINATIONS.filter(destination => destination.countryCode === countryCode);
}

/**
 * @param {string} countryCode
 * @param {string} destinationKey
 * @returns {boolean}
 */
export function isValidDestinationPair(countryCode, destinationKey) {
  return getDestination(destinationKey)?.countryCode === countryCode;
}

/** @param {Country} country @param {Language} language @returns {string} */
export function countryLabel(country, language) {
  return language === 'zh' ? country.zh : country.en;
}

/** @param {Destination} destination @param {Language} language @returns {string} */
export function destinationLabel(destination, language) {
  return language === 'zh' ? destination.zh : destination.en;
}
