# Refactoring Plan — lingorm_bangkok_v2/index.html

## Status Legend
- ✅ Done
- 🔄 In Progress
- ⬜ Pending

---

## High Priority

### ✅ Remove EMBEDDED fallback data
**Scope:** `index.html`
Removed the hardcoded 26-row `EMBEDDED` array and everything that depended on it:
- `hydrateSheetRows()` — coord-fill lookup from EMBEDDED
- `clearSheet()` — reset to EMBEDDED
- "Use Built-in Data" button in sheet modal
- `sheet_clear` / `sheet_cleared` i18n keys (zh + en)
- `data` initial state changed from `normalizeCategoryRows(EMBEDDED)` → `[]`

### ✅ Refactor `parseCSV` into focused functions
**Scope:** `index.html`, `tests/parsecsv.test.mjs`

Split the monolithic `parseCSV` into:
- `tokenizeCSV(text)` — pure RFC 4180 tokenizer, no business logic
- `parseInternalFormat(rows, idx, read)` — handles `Name_EN / Category_EN` headers
- `parsePublishedFormat(rows, idx, read)` — handles `Location Name / Category` headers
- `parseCSV(text)` — thin dispatcher: tokenize → detect format → normalize

Hoisted closure-trapped helpers to module level (no longer recreated per call):
- `ICON_BY_CAT`, `ZH_BY_CAT` — lookup tables
- `normalizeStatus()`, `sourceLabel()`, `normalizeSourceTags()`, `mapsQuery()`

### ✅ Fix double-normalization bug
**Scope:** `index.html` (`saveSheet`, `tryLoadSheet`)

`parseCSV` already calls `normalizeCategoryRows()` before returning. `saveSheet` and `tryLoadSheet` were wrapping the result in a second `normalizeCategoryRows()` call. Fixed to `data = parsed`.

### ✅ Replace positional array data model with objects
**Scope:** `index.html` (pervasive — touches every `row[C.XYZ]` access), `tests/parsecsv.test.mjs`

Removed `const C` index map. Parsers (`parseInternalFormat`, `parsePublishedFormat`) now return objects
with named fields: `nameEn`, `nameZh`, `alt`, `catEn`, `catZh`, `notesEn`, `notesZh`, `icon`, `lat`,
`lng`, `maps`, `status`, `dup`, `src`, `approx`, `sourceUrl`. `normalizeCategoryRow` updated to spread
and override rather than mutating a copied array. All 21 `row[C.X]` callsites replaced. Tests updated
to pass objects to `isApproximateCoords` and use named fields in `parseCSV` `deepEqual` assertions.
All 27 tests pass.

---

## Medium Priority

### ✅ Update `parsecsv.test.mjs` for new structure
**Scope:** `tests/parsecsv.test.mjs`

Rewrote `loadParsers()` to extract the full CSV parser section by banner marker instead of per-function regex. Added 27 tests:
- `tokenizeCSV` — 6 tests (basic, quoted fields, CRLF, BOM, trailing newline)
- `normalizeStatus` — 3 tests
- `sourceLabel` — 3 tests
- `normalizeSourceTags` — 3 tests
- `mapsQuery` — 3 tests
- `isApproximateCoords` — 2 tests
- `parseCSV` integration — 7 tests (internal format, published format, null cases, BOM)

All 27 passing.

### ✅ `doNetlifySubmit` — extract success callback instead of branching on `modalId`
**Scope:** `index.html`

Replaced `modalId` parameter with `onSuccess` callback. `doNetlifySubmit` now calls `onSuccess(fb)`
on success; callers own their post-submit behaviour:
- `submitAdd` passes `showAddSuccess` directly
- `submitEdit` passes an inline callback that sets the feedback element to ok-state and auto-closes the modal

### ✅ Extract `rebuildSelect(sel, html)` helper
**Scope:** `index.html` (`buildStatusFilter`, `buildCatFilter`)

Extracted `rebuildSelect(sel, html)` — saves current value, sets `innerHTML`, restores value.
Both `buildStatusFilter` and `buildCatFilter` now delegate to it.

### ✅ Collapse `updateLangUI` into one DOM pass
**Scope:** `index.html`

Single `querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-ph]')` call; loop branches on
which attribute is present to set `textContent`, `innerHTML`, or `placeholder`.

### ✅ Add `console.warn` to `tryLoadSheet` catch block
**Scope:** `index.html`

`catch(e){}` → `catch(e){console.warn('Sheet load failed',e);}`

---

## Low Priority

### ⬜ Replace inline `onclick` handlers with `addEventListener`
**Scope:** `index.html` (HTML template section)

`onclick="openAddModal()"`, `onclick="cycleTheme()"`, etc. couple HTML and JS. Moving to `addEventListener` in an init block decouples them and makes JS-only testing easier.

### ⬜ Move `ADD_LOCATION_INPUT_IDS` to local scope
**Scope:** `index.html`

Declared at module level but only used inside `openAddModal`. Move inside the function.

### ⬜ Simplify `switchTab` attribute logic
**Scope:** `index.html`

```js
// Current — asymmetric ternaries are easy to misread
document.getElementById('panel').setAttribute('data-mobile-tab', tab === 'map' ? 'map' : 'list');
document.getElementById('map-wrap').setAttribute('data-mobile-tab', tab === 'list' ? 'list' : 'map');

// Target — explicit and symmetric
const isMap = tab === 'map';
panel.setAttribute('data-mobile-tab', isMap ? 'map' : 'list');
mapWrap.setAttribute('data-mobile-tab', isMap ? 'map' : 'list');
```

### ⬜ Cache repeated `getElementById` calls in `verifyAdminPassword`
**Scope:** `index.html`

`admin-feedback` and `admin-pwd` are looked up multiple times in the same function. Cache at the top of the function.
