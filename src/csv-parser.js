// ═══════════════════════════════════════════════════
// SLUG / ID HELPER
// ═══════════════════════════════════════════════════
export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ═══════════════════════════════════════════════════
// CATEGORY ALIASES — normalise legacy / variant category names during CSV parsing
// ═══════════════════════════════════════════════════
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

export function normalizeCategoryRow(row) {
  const alias = CATEGORY_ALIASES[row.catEn] || CATEGORY_ALIASES[row.catZh];
  if (alias) return { ...row, catEn: alias.en, catZh: alias.zh };
  return row;
}

export function normalizeCategoryRows(rows) {
  return rows.map(normalizeCategoryRow);
}

// ═══════════════════════════════════════════════════
// CSV PARSER
// ═══════════════════════════════════════════════════

// Tokenize RFC 4180-ish CSV text into a 2D array of strings
export function tokenizeCSV(text) {
  const rows = []; let row = []; let field = ''; let inQ = false;
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
export const ICON_BY_CAT = {
  "Restaurant":"🍽","Cafe":"☕","Cafe / Beverage":"🧋","Cafe / Juice Bar":"🥤",
  "Hotel":"🏨","Bar":"🍸","Bar / Club":"🍸","Bar / Rooftop Club":"🏖️","Spa":"♨️",
  "Shopping":"🛍","Activity":"🎯","Filming Location":"🎬",
  "Nature / Day-trip":"🌿","Street Food":"🍜","Neighbourhood":"🏘️"
};

export const ZH_BY_CAT = {
  "Restaurant":"餐廳","Cafe":"咖啡廳","Cafe / Beverage":"飲料","Cafe / Juice Bar":"飲料","Beverages":"飲料",
  "Hotel":"飯店","Bar":"酒吧/天台俱樂部","Bar / Club":"酒吧/天台俱樂部","Bar / Rooftop Club":"酒吧/天台俱樂部","Spa":"Spa",
  "Shopping":"購物","Activity":"活動","Filming Location":"拍攝場地",
  "Nature / Day-trip":"自然 / 一日遊","Street Food":"街頭小吃","Neighbourhood":"街區"
};

export function normalizeStatus(s) {
  const raw = s.trim();
  if (raw === "Verified" || raw === "Needs Review" || raw === "Could Not Find") return raw;
  if (/verified/i.test(raw)) return "Verified";
  if (/could not find|not found/i.test(raw)) return "Could Not Find";
  return "Needs Review";
}

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

export function normalizeSourceTags(tags) {
  return tags.split(',').map(s => s.trim())
    .filter(s => s && !/^https?:\/\//i.test(s))
    .join(' + ');
}

export function mapsQuery(name, maps) {
  if (maps && !/open in maps/i.test(maps) && !/^📍/.test(maps)) return maps;
  return name ? `${name} Bangkok` : "";
}

// Internal sheet format: Name_EN, Name_ZH, Category_EN, … columns
export function parseInternalFormat(rows, idx, read) {
  const coreKeys = ["Name_EN","Name_ZH","Alt_Name","Category_EN","Category_ZH",
                    "Notes_EN","Notes_ZH","Icon","Lat","Lng",
                    "Maps_Query","Status","Duplicate_Group","Source","Coords_Approx"];
  if (!coreKeys.every(k => idx[k] !== undefined)) return null;
  return rows.slice(1)
    .filter(r => r.join('').trim())
    .map(r => ({
      id:       slugify(read(r, "Name_EN")),
      nameEn:   read(r, "Name_EN"),
      nameZh:   read(r, "Name_ZH"),
      alt:      read(r, "Alt_Name"),
      catEn:    read(r, "Category_EN"),
      catZh:    read(r, "Category_ZH"),
      notesEn:  read(r, "Notes_EN"),
      notesZh:  read(r, "Notes_ZH"),
      icon:     read(r, "Icon"),
      lat:      read(r, "Lat"),
      lng:      read(r, "Lng"),
      maps:     read(r, "Maps_Query"),
      status:   read(r, "Status"),
      dup:      read(r, "Duplicate_Group"),
      src:      read(r, "Source"),
      approx:   read(r, "Coords_Approx"),
      sourceUrl:read(r, "Source_URL"),
    }));
}

// Published/legacy sheet format: "Location Name", "Category", "Verification Status", … columns
export function parsePublishedFormat(rows, idx, read) {
  const required = ["Location Name","Thai / Alt Name","Category",
                    "Notes","Source URL","Verification Status","Duplicate Group"];
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
        id:       slugify(name),
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
        dup:      read(r, "Duplicate Group"),
        src:      tags || sourceLabel(sourceUrl),
        approx:   read(r, "Coordinates Approx") || "TRUE",
        sourceUrl,
      };
    });
}

export function parseCSV(text) {
  const rows = tokenizeCSV(text);
  if (rows.length < 2) return null;
  const headers = rows[0].map(h => h.replace(/^﻿/, '').trim());
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  const read = (r, k) => (idx[k] !== undefined ? r[idx[k]] || '' : '').trim();
  const parsed = parseInternalFormat(rows, idx, read)
             ?? parsePublishedFormat(rows, idx, read);
  return parsed ? normalizeCategoryRows(parsed) : null;
}
