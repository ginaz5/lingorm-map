# JavaScript Type Checking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Completed steps are recorded with `[x]` for historical tracking.

**Goal:** Add strict, incremental static type checking to the JavaScript project and document the verified development workflow.

**Architecture:** TypeScript runs as a development-only checker over four JavaScript entry modules and their imported dependencies; Vite remains the runtime build tool and emits the application. JSDoc owns application data contracts, while a small ambient declaration file supplies only the dynamically loaded Google Maps/HERE globals used by the code.

**Tech Stack:** JavaScript ES modules, JSDoc, TypeScript `checkJs`, Node.js `node:test`, Vite 6

---

## File Structure

- Create `tests/typecheck-config.test.mjs`: verifies the checker command, strict no-emit configuration, initial source scope, and TypeScript dependency.
- Create `jsconfig.json`: defines the JavaScript checker program and compiler rules.
- Create `src/map-globals.d.ts`: declares the two dynamic map SDK globals and map callback properties on `Window`.
- Modify `package.json` and `package-lock.json`: install TypeScript and expose `npm run typecheck`.
- Modify `src/csv-parser.js`: export JSDoc contracts for normalized rows and annotate parser inputs/outputs.
- Modify `src/state.js`: declare the shared state shape using the normalized-row contract.
- Modify `src/map.js`: annotate provider/config/function boundaries and make DOM lookups explicit under strict null checking.
- Modify `src/forms.js`: annotate validation/payload/callback boundaries and use typed DOM lookup helpers.
- Modify `README.md`: document the checker, project status as JavaScript, and pre-commit verification sequence.
- Modify `note/LOCAL_TESTING.md`: put type checking before tests and commit.
- Modify `note/TECH_DECISIONS.md`: record why incremental `checkJs` was chosen over migration.

### Task 1: Specify the Type-checking Contract

**Files:**
- Create: `tests/typecheck-config.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `jsconfig.json`
- Create: `src/map-globals.d.ts`

- [x] **Step 1: Write the failing configuration test**

Create `tests/typecheck-config.test.mjs`:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rootUrl = new URL('../', import.meta.url);

test('type checking is strict, no-emit, and scoped to the initial JavaScript modules', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', rootUrl), 'utf8'));
  const config = JSON.parse(await readFile(new URL('jsconfig.json', rootUrl), 'utf8'));

  assert.equal(pkg.scripts.typecheck, 'tsc --noEmit -p jsconfig.json');
  assert.equal(typeof pkg.devDependencies.typescript, 'string');
  assert.equal(config.compilerOptions.allowJs, true);
  assert.equal(config.compilerOptions.checkJs, true);
  assert.equal(config.compilerOptions.noEmit, true);
  assert.equal(config.compilerOptions.strict, true);
  assert.deepEqual(config.include, [
    'src/state.js',
    'src/csv-parser.js',
    'src/map.js',
    'src/forms.js',
    'src/map-globals.d.ts',
  ]);
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```sh
node --test tests/typecheck-config.test.mjs
```

Expected: FAIL with `ENOENT` for `jsconfig.json`.

- [x] **Step 3: Install the checker and add the command**

Run:

```sh
npm install --save-dev typescript
```

Then add this script to `package.json`:

```json
"typecheck": "tsc --noEmit -p jsconfig.json"
```

Do not commit yet: the user requires the checker itself to pass before any implementation commit.

- [x] **Step 4: Add strict checker configuration**

Create `jsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": true,
    "checkJs": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": [
    "src/state.js",
    "src/csv-parser.js",
    "src/map.js",
    "src/forms.js",
    "src/map-globals.d.ts"
  ]
}
```

- [x] **Step 5: Declare dynamic browser globals**

Create `src/map-globals.d.ts`:

```ts
declare const google: any;
declare const H: any;

interface Window {
  gm_authFailure?: () => void;
  initMapCallback?: () => void;
}
```

These declarations intentionally describe only the runtime loading boundary. Application-owned objects remain strictly typed through JSDoc.

- [x] **Step 6: Run the configuration test and verify GREEN**

Run:

```sh
node --test tests/typecheck-config.test.mjs
```

Expected: PASS.

- [x] **Step 7: Run the checker and capture the expected source failures**

Run:

```sh
npm run typecheck
```

Expected: FAIL with implicit-`any`, nullable DOM lookup, dynamic object-key, and untyped callback diagnostics. This is the implementation RED state; do not weaken `strict` or add `@ts-ignore`.

### Task 2: Type the Data Boundary and Shared State

**Files:**
- Modify: `src/csv-parser.js`
- Modify: `src/state.js`

- [x] **Step 1: Define exported parser contracts**

Add before the first parser function in `src/csv-parser.js`:

```js
/** @typedef {'Verified' | 'Needs Review' | 'Could Not Find'} LocationStatus */

/**
 * @typedef {object} LocationRow
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
 * @property {string} dup
 * @property {string} src
 * @property {string} approx
 * @property {string} sourceUrl
 */

/** @typedef {{ en: string, zh: string }} CategoryAlias */
/** @typedef {(row: string[], key: string) => string} ReadCell */
```

Annotate lookup tables so dynamic CSV values remain valid keys:

```js
/** @type {Record<string, CategoryAlias>} */
// Place immediately above `export const CATEGORY_ALIASES = {`.

/** @type {Record<string, string>} */
// Place immediately above both `export const ICON_BY_CAT = {` and
// `export const ZH_BY_CAT = {`.
```

- [x] **Step 2: Annotate parser function boundaries**

Add these JSDoc signatures immediately above the matching functions without changing their bodies:

```js
/** @param {unknown} s @returns {string} */
// slugify

/** @param {LocationRow} row @returns {LocationRow} */
// normalizeCategoryRow

/** @param {LocationRow[]} rows @returns {LocationRow[]} */
// normalizeCategoryRows

/** @param {string} text @returns {string[][]} */
// tokenizeCSV

/** @param {string} s @returns {LocationStatus} */
// normalizeStatus

/** @param {string} url @returns {string} */
// sourceLabel

/** @param {string} tags @returns {string} */
// normalizeSourceTags

/** @param {string} name @param {string} maps @returns {string} */
// mapsQuery

/**
 * @param {string[][]} rows
 * @param {Record<string, number>} idx
 * @param {ReadCell} read
 * @returns {LocationRow[] | null}
 */
// parseInternalFormat and parsePublishedFormat

/** @param {string} text @returns {LocationRow[] | null} */
// parseCSV
```

Inside `parseCSV`, type the dynamic header map and reader:

```js
/** @type {Record<string, number>} */
const idx = {};
/** @type {ReadCell} */
const read = (r, k) => (idx[k] !== undefined ? r[idx[k]] || '' : '').trim();
```

- [x] **Step 3: Type the shared state object**

Add to the top of `src/state.js`:

```js
/** @typedef {import('./csv-parser.js').LocationRow} LocationRow */
/** @typedef {'google' | 'here' | null} MapProvider */

/**
 * @typedef {object} AppState
 * @property {LocationRow[]} data
 * @property {number[]} visIdx
 * @property {number} activeIdx
 * @property {MapProvider} provider
 * @property {any} map
 * @property {any} infoWindow
 * @property {MutationObserver | null} googleErrorObserver
 * @property {any} hereUi
 * @property {any} hereLayers
 * @property {any} infoBubble
 * @property {any[]} markers
 * @property {any} userLocationMarker
 * @property {ReturnType<typeof setTimeout> | null} snackTimer
 * @property {boolean} isLoading
 * @property {Set<string>} favorites
 * @property {boolean} favFilterOn
 */
```

Annotate the existing exported object:

```js
/** @type {AppState} */
// Place immediately above the existing `export const state = {` declaration.
```

The SDK-owned fields remain `any` in this first pass because their objects come from dynamically loaded external scripts; the application-owned fields are concrete.

- [x] **Step 4: Re-run the checker**

Run:

```sh
npm run typecheck
```

Expected: parser and state implicit-`any`/dynamic-key diagnostics are gone; remaining failures point to DOM access and callback boundaries in map/forms or their imported modules.

### Task 3: Type Map and Form Boundaries

**Files:**
- Modify: `src/map.js`
- Modify: `src/forms.js`

- [x] **Step 1: Add required-element helpers**

Add near the imports in both `src/map.js` and `src/forms.js`:

```js
/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function getRequiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
}
```

Add this form-specific helper in `src/forms.js`:

```js
/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
function getRequiredInput(id) {
  return /** @type {HTMLInputElement} */ (getRequiredElement(id));
}
```

Replace form `.value`, `.checked`, and `.selectedIndex` accesses by `getRequiredInput(id)`. Keep `getRequiredElement(id)` for class, text, and style operations. For checked selectors use:

```js
document.querySelector('input[name="suggest-status"]:checked')?.getAttribute('value') || ''
```

This keeps nullable queries explicit without suppressing diagnostics.

- [x] **Step 2: Annotate form APIs**

Add the following signatures above the matching functions:

```js
/** @param {number} i */
// openEditModal

/** @param {string} url @returns {boolean} */
// isGoogleMapsUrl

/** @param {string} name @param {string} maps @returns {string} */
// validateAddLocation

/** @returns {Record<string, string>} */
// buildAddLocationPayload and buildIssueReportPayload

/** @param {string} message @returns {string} */
// validateIssueReport

/** @param {() => void} rebuild @returns {Promise<void>} */
// tryLoadSheet
```

Type `catSel` as `HTMLSelectElement`:

```js
const catSel = /** @type {HTMLSelectElement} */ (getRequiredElement('add-cat'));
```

Narrow caught values before logging only if the checker reports an unsafe access; no catch block currently reads an error property.

- [x] **Step 3: Annotate the map boundary**

Add near the imports in `src/map.js`:

```js
/** @typedef {'google' | 'here'} ActiveMapProvider */
/** @typedef {{ googleMapsKey?: string, googleMapId?: string, hereApiKey: string }} MapConfig */
```

Add signatures above the matching functions:

```js
/** @param {ActiveMapProvider} provider */
// updateProviderBadge

/** @param {any} layers @param {'light' | 'dark'} theme @returns {any} */
// getHereBaseLayer

/** @param {string} status @param {string} icon @returns {HTMLDivElement} */
// makeMarkerContent

/** @param {string} src @returns {Promise<void>} */
// loadScript

/** @param {MapConfig} cfg */
// initWithGoogle and fallbackToHere

/** @param {string} apiKey */
// initWithHere
```

Replace map DOM lookups that are unconditionally dereferenced with `getRequiredElement(id)`. Keep the existing nullable checks for `provider-dot`, `provider-label`, and optional message elements.

After `resp.json()`, make the untrusted boundary explicit:

```js
const cfg = /** @type {MapConfig} */ (await resp.json());
```

- [x] **Step 4: Type the imported boundaries TypeScript includes in the program**

TypeScript follows the imports from map/forms, so annotate the reached modules rather than suppressing them. Add the existing row contract to `render.js` and `ui.js`:

```js
/** @typedef {import('./csv-parser.js').LocationRow} LocationRow */
```

Add these signatures above the matching exports:

```js
// i18n.js
/** @param {'zh' | 'en'} l */
// setLang
/** @param {string} k @param {...any} a @returns {any} */
// t
/** @param {string} k @param {string} s @returns {string} */
// tobj

// render.js
/** @param {boolean} active @returns {string} */
// heartSVG
/** @param {string} s @returns {string} */
// getBadgeClass
/** @param {LocationRow} row @returns {boolean} */
// isPublicLocation and isApproximateCoords
/** @param {LocationRow} row @returns {string} */
// renderSources
/** @param {number} i @returns {string} */
// buildPopupContent
/** @param {number} i */
// activateCard
/** @param {HTMLSelectElement} sel @param {string} html */
// rebuildSelect

// ui.js
/** @param {'map' | 'list'} tab */
// switchTab
/** @param {string} msg @param {number} [duration] */
// showSnackbar
/** @param {number} i */
// openNavigation and openInGoogleMaps

// submit.js
/**
 * @param {string} btnId
 * @param {string} fbId
 * @param {string} btnLabel
 * @param {Record<string, string>} payload
 * @param {(feedback: HTMLElement) => void} onSuccess
 */
// doNetlifySubmit
/** @param {string} fbId @param {string} btnId @param {string} btnLabel */
// resetFeedback
```

Reuse the `getRequiredElement`/`getRequiredInput` pattern from Step 1 for unconditionally dereferenced DOM nodes in `render.js`, `ui.js`, and `submit.js`. Type select elements as `HTMLSelectElement`, buttons as `HTMLButtonElement`, and inputs as `HTMLInputElement` at the lookup site.

Before correcting the invalid `row.mapsQuery` read in `ui.js`, append this regression test to `tests/no-maplink-ui.test.mjs` (reuse that file's existing `readFile` import if present):

```js
test('Google Maps navigation uses the normalized row maps field', async () => {
  const uiSource = await readFile(new URL('../src/ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(uiSource, /\brow\.mapsQuery\b/);
  assert.match(uiSource, /\brow\.maps\b/);
});
```

Run:

```sh
node --test tests/no-maplink-ui.test.mjs
```

Expected RED: the first assertion reports the existing `row.mapsQuery` match. Then replace both `row.mapsQuery` occurrences in `openInGoogleMaps` with `row.maps` and rerun the test. Expected GREEN: all tests in the file pass.

Do not add `@ts-ignore`, `@ts-nocheck`, or broader ambient declarations.

- [x] **Step 5: Verify the checker is GREEN**

Run:

```sh
npm run typecheck
```

Expected: exit code 0 and no diagnostics.

- [x] **Step 6: Run focused behavior tests after DOM lookup changes**

Run:

```sh
node --test tests/parsecsv.test.mjs tests/add-location-form.test.mjs tests/edit-submit.test.mjs tests/issue-report.test.mjs tests/google-maps-loader.test.mjs tests/here-map-layer.test.mjs
```

Expected: all selected tests PASS with `fail 0`.

### Task 4: Document and Commit the Verified Workflow

**Files:**
- Modify: `README.md`
- Modify: `note/LOCAL_TESTING.md`
- Modify: `note/TECH_DECISIONS.md`
- Modify: `docs/superpowers/specs/2026-06-21-javascript-type-checking-design.md`
- Create: `docs/superpowers/plans/2026-06-21-javascript-type-checking.md`
- Modify: `tests/typecheck-config.test.mjs`
- Modify: `tests/i18n-ui.test.mjs`
- Modify: `tests/no-maplink-ui.test.mjs`
- Modify: `tests/parsecsv.test.mjs`
- Modify: `tests/ui-events.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `jsconfig.json`
- Create: `src/map-globals.d.ts`
- Modify: typed JavaScript files from Tasks 2-3

- [x] **Step 1: Update README commands and architecture**

In the README tech-stack table, change the build row to:

```markdown
| Build / checks | Vite 6 + TypeScript `checkJs` (JavaScript source, no emit) |
```

Add before “Unit tests”:

```markdown
### Static type checking

The project remains JavaScript. TypeScript checks selected high-risk modules through JSDoc and emits no runtime files:

```bash
npm run typecheck
```

The initial scope is `state.js`, `csv-parser.js`, `map.js`, and `forms.js`, plus their imported boundaries. New modules can be added to `jsconfig.json` incrementally.
```

Replace the pre-deploy verification commands with this order:

```bash
npm run typecheck
node --test tests/*.test.mjs
npm run build
```

- [x] **Step 2: Update local testing instructions**

In `note/LOCAL_TESTING.md`, make type checking step 1 and tests step 2:

```markdown
1. 跑靜態型別檢查：

```bash
npm run typecheck
```

預期結果：指令成功結束，沒有型別錯誤。

2. 跑自動測試：

```bash
node --test tests/*.test.mjs
```
```

Renumber subsequent steps. In “確認後才部署”, show all three verification commands immediately before `git status` and `git commit`.

- [x] **Step 3: Record the technical decision**

Append to `note/TECH_DECISIONS.md`:

```markdown
## 型別檢查：JavaScript + JSDoc + TypeScript checkJs

**決策：** 保留 `.js` 原始碼與 Vite runtime build，使用 TypeScript 作為開發期的 no-emit checker。

**第一階段範圍：** `state.js`、`csv-parser.js`、`map.js`、`forms.js`，以及 TypeScript 追蹤到的 import boundaries。

**理由：**

- 專案規模不需要承擔完整 `.ts` migration 與雙語言 source tree 的成本。
- location row、共享 state、nullable DOM lookup 與雙 map provider 是目前最需要 contract 的區域。
- JSDoc 不改變 browser runtime 或 Netlify/Vite deploy output。

**限制：** Google Maps 與 HERE SDK 由 runtime script 動態載入；第一階段只宣告使用到的 global boundary，SDK object 暫時視為 `any`。

**擴充方式：** 每次修改尚未納入的 module 時，補齊其 exported JSDoc contract，加入 `jsconfig.json`，並確保 `npm run typecheck` 通過。
```

- [x] **Step 4: Run all required verification before committing**

Run, in this exact order:

```sh
npm run typecheck
node --test tests/*.test.mjs
npm run build
git diff --check
```

Expected:

- typecheck exits 0 with no diagnostics;
- all tests pass with `fail 0`;
- Vite reports `✓ built`;
- `git diff --check` prints no errors.

- [x] **Step 5: Review the final diff for scope and suppressions**

Run:

```sh
git diff --stat
rg -n "@ts-ignore|@ts-expect-error|@ts-nocheck" src jsconfig.json
git status --short
```

Expected: only planned source/config/test/documentation files are changed; the `rg` command returns no matches; no generated `dist/` files are staged.

- [x] **Step 6: Commit only after verification passes**

Run:

```sh
git add package.json package-lock.json jsconfig.json src/map-globals.d.ts src/state.js src/csv-parser.js src/map.js src/forms.js src/i18n.js src/render.js src/ui.js src/submit.js tests/typecheck-config.test.mjs tests/i18n-ui.test.mjs tests/no-maplink-ui.test.mjs tests/parsecsv.test.mjs tests/ui-events.test.mjs README.md note/LOCAL_TESTING.md note/TECH_DECISIONS.md docs/superpowers/specs/2026-06-21-javascript-type-checking-design.md docs/superpowers/plans/2026-06-21-javascript-type-checking.md
git commit -m "chore: add incremental JavaScript type checking"
```

If an imported-boundary file listed in the command was unchanged, omit it from `git add`. Do not commit if any command in Step 4 failed.
