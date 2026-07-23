// ═══════════════════════════════════════════════════
// SLUG / ID HELPER
// ═══════════════════════════════════════════════════
/** @typedef {'Published'|'Paused'|'Inactive'} LocationStatus */
/**
 * @typedef {Object} LocationRow
 * @property {string} id
 * @property {string} nameEn
 * @property {string} nameZh
 * @property {string} alt
 * @property {string} catEn
 * @property {string} catZh
 * @property {string} notesEn
 * @property {string} notesZh
 * @property {string} icon
 * @property {string} lat
 * @property {string} lng
 * @property {string} maps
 * @property {LocationStatus} status
 * @property {string} src
 * @property {string} approx
 * @property {string} sourceUrl
 * @property {string} countryCode
 * @property {string} destinationKey
 */
/** @typedef {{en: string, zh: string}} CategoryAlias */
/** @typedef {(row: string[], key: string) => string} ReadCell */

/**
 * @param {unknown} s
 * @returns {string}
 */
export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ═══════════════════════════════════════════════════
// CATEGORY ALIASES — normalise legacy / variant category names during CSV parsing
// ═══════════════════════════════════════════════════
/** @type {Record<string, CategoryAlias>} */
export const CATEGORY_ALIASES = {
  "Hotel": {en:"Hotel", zh:"飯店"},
  "酒店": {en:"Hotel", zh:"飯店"},
  "飯店": {en:"Hotel", zh:"飯店"},
  "Bar": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "酒吧": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "Bar / Club": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "酒吧 / 俱樂部": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "酒吧/俱樂部": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "Bar / Rooftop Club": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "酒吧 / 天台俱樂部": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "酒吧/天台俱樂部": {en:"Bar / Rooftop Club", zh:"酒吧/天台俱樂部"},
  "Cafe / Juice Bar":  {en:"Beverages", zh:"飲料"},
  "Cafe / Beverage":   {en:"Beverages", zh:"飲料"},
  "Beverages":         {en:"Beverages", zh:"飲料"},
  "咖啡廳 / 果汁":      {en:"Beverages", zh:"飲料"},
  "咖啡廳/果汁":        {en:"Beverages", zh:"飲料"},
  "咖啡廳 / 飲品":      {en:"Beverages", zh:"飲料"},
  "咖啡廳/飲品":        {en:"Beverages", zh:"飲料"},
};

/**
 * @param {LocationRow} row
 * @returns {LocationRow}
 */
export function normalizeCategoryRow(row) {
  const alias = CATEGORY_ALIASES[row.catEn] || CATEGORY_ALIASES[row.catZh];
  if (alias) return { ...row, catEn: alias.en, catZh: alias.zh };
  return row;
}

/**
 * @param {LocationRow[]} rows
 * @returns {LocationRow[]}
 */
export function normalizeCategoryRows(rows) {
  return rows.map(normalizeCategoryRow);
}

// ═══════════════════════════════════════════════════
// CSV PARSER
// ═══════════════════════════════════════════════════

// Tokenize RFC 4180-ish CSV text into a 2D array of strings
/**
 * @param {string} text
 * @returns {string[][]}
 */
export function tokenizeCSV(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (inQ) {
      if (ch === '"' && nx === '"') { field += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r' && nx === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
      else if (ch === '\n' || ch === '\r') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Lookup tables used when parsing the published/legacy sheet format
/** @type {Record<string, string>} */
export const ICON_BY_CAT = {
  "Restaurant":"🍽","Cafe":"☕","Cafe / Beverage":"🧋","Cafe / Juice Bar":"🥤",
  "Hotel":"🏨","Bar":"🍸","Bar / Club":"🍸","Bar / Rooftop Club":"🏖️","Spa":"♨️",
  "Shopping":"🛍","Activity":"🎯","Filming Location":"🎬",
  "Nature / Day-trip":"🌿","Street Food":"🍜","Neighbourhood":"🏘️"
};

/** @type {Record<string, string>} */
export const ZH_BY_CAT = {
  "Restaurant":"餐廳","Cafe":"咖啡廳","Cafe / Beverage":"飲料","Cafe / Juice Bar":"飲料","Beverages":"飲料",
  "Hotel":"飯店","Bar":"酒吧/天台俱樂部","Bar / Club":"酒吧/天台俱樂部","Bar / Rooftop Club":"酒吧/天台俱樂部","Spa":"Spa",
  "Shopping":"購物","Activity":"活動","Filming Location":"拍攝場地",
  "Nature / Day-trip":"自然 / 一日遊","Street Food":"街頭小吃","Neighbourhood":"街區"
};

export const LEGACY_LOCATION_STATUSES = Object.freeze([
  "Draft",
  "Needs Review",
  "Verifying",
  "Verified",
  "Could Not Find",
  "Closed",
]);

export const LOCATION_STATUSES = Object.freeze([
  "Published",
  "Paused",
  "Inactive",
]);

/**
 * @param {string} s
 * @returns {LocationStatus}
 */
export function normalizeStatus(s) {
  const raw = s.trim().toLowerCase();
  /** @type {Record<string, LocationStatus>} */
  const statuses = {
    "draft": "Paused",
    "needs review": "Paused",
    "verifying": "Paused",
    "verified": "Paused",
    "could not find": "Inactive",
    "closed": "Inactive",
    "published": "Published",
    "paused": "Paused",
    "inactive": "Inactive",
    "not found": "Inactive",
    "not verified": "Paused",
  };
  return statuses[raw] || "Paused";
}

/**
 * @param {string} url
 * @returns {string}
 */
export function sourceLabel(url) {
  if (!url) return "";
  const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1] || "";
  if (/kkday/i.test(host)) return "KKday";
  if (/trip\.com/i.test(host)) return "Trip.com";
  if (/threads/i.test(host)) return "Threads";
  if (/instagram/i.test(host)) return "Instagram";
  if (/youtube|youtu\.be/i.test(host)) return "YouTube";
  return "Source";
}

/**
 * @param {string} tags
 * @returns {string}
 */
export function normalizeSourceTags(tags) {
  return tags.split(',').map(s => s.trim())
    .filter(s => s && !/^https?:\/\//i.test(s))
    .join(' + ');
}

/**
 * @param {string} name
 * @param {string} maps
 * @returns {string}
 */
export function mapsQuery(name, maps) {
  if (maps && !/open in maps/i.test(maps) && !/^📍/.test(maps)) return maps;
  return name ? `${name} Bangkok` : "";
}

// Sheet format: "Location Name", "Category", "Verification Status", … columns
/**
 * @param {string[][]} rows
 * @param {Record<string, number>} idx
 * @param {ReadCell} read
 * @returns {LocationRow[] | null}
 */
export function parsePublishedFormat(rows, idx, read) {
  const required = ["Location Name","Thai / Alt Name","Category",
                    "Notes","Source URL","Verification Status"];
  if (!required.every(k => idx[k] !== undefined)) return null;
  return rows.slice(1)
    .filter(r => r.join('').trim() && !/^source note$/i.test(read(r, "Category")))
    .map(r => {
      const name      = read(r, "Location Name");
      const nameZh    = read(r, "Location Name ZH") || name;
      const cat       = (CATEGORY_ALIASES[read(r, "Category")] || {en: read(r, "Category")}).en;
      const notes     = read(r, "Notes");
      const notesZh   = read(r, "Notes ZH") || notes;
      const sourceUrl = read(r, "Source URL");
      const tags      = normalizeSourceTags(read(r, "Source Tags"));
      const maps      = read(r, "Google Maps URL") || read(r, "Google Maps Link");
      return {
        // Prefer an explicit Slug column when present (Notion export, plan
        // §6.3/§13 Phase 2) so a Notion page rename doesn't change the
        // location's id — that would silently break localStorage favorites
        // and any shared #fav URL (plan §4 debt #5, §14 acceptance #2).
        // Falls back to slugify(name) for the legacy sheet format, which
        // has no Slug column and never will.
        id:       read(r, "Slug") || slugify(name),
        nameEn:   name,
        nameZh,
        alt:      read(r, "Thai / Alt Name"),
        catEn:    cat,
        catZh:    ZH_BY_CAT[cat] || cat,
        notesEn:  notes,
        notesZh,
        icon:     read(r, "Icon") || ICON_BY_CAT[cat] || "📍",
        lat:      read(r, "Lat"),
        lng:      read(r, "Lng"),
        maps:     mapsQuery(name, maps),
        status:   normalizeStatus(read(r, "Verification Status")),
        src:      tags || sourceLabel(sourceUrl),
        // Optional only for the legacy Google Sheet rollback format. The
        // current Notion schema retired this property, so its absence means
        // exact/unspecified rather than approximate.
        approx:   read(r, "Coordinates Approx"),
        sourceUrl,
        countryCode: read(r, "Country Code"),
        destinationKey: read(r, "Destination Key"),
      };
    });
}

/**
 * @param {string} text
 * @returns {LocationRow[] | null}
 */
export function parseCSV(text) {
  const rows = tokenizeCSV(text);
  if (rows.length < 2) return null;
  const headers = rows[0].map(h => h.replace(/^﻿/, '').trim());
  /** @type {Record<string, number>} */
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  /** @type {ReadCell} */
  const read = (r, k) => (idx[k] !== undefined ? r[idx[k]] || '' : '').trim();
  const parsed = parsePublishedFormat(rows, idx, read);
  return parsed ? normalizeCategoryRows(parsed) : null;
}
