import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  SHEET_PEEK_PX,
  getSheetSnap,
  getSheetVisibleHeight,
  initBottomSheet,
  resolveSheetSnap,
  setSheetSnap,
  sheetSnapHeights,
} from '../src/ui/bottom-sheet.js';
import { makeMapFirstDom } from './helpers/map-first-dom.mjs';

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete globalThis.window;
});

test('snap heights keep the full sheet under the search bar and half near 45%', () => {
  assert.deepEqual(sheetSnapHeights(800, 120), { peek: SHEET_PEEK_PX, half: 360, full: 680 });
  // Short landscape phones: half never exceeds full, peek never exceeds half.
  assert.deepEqual(sheetSnapHeights(300, 120), { peek: 112, half: 135, full: 180 });
  assert.equal(SHEET_PEEK_PX, 112, 'keep in sync with --sheet-peek in styles.css');
});

test('a slow release settles on the nearest snap; a fling moves one step', () => {
  const heights = { peek: 112, half: 360, full: 680 };
  assert.equal(resolveSheetSnap(200, 0, heights), 'peek');
  assert.equal(resolveSheetSnap(300, 0, heights), 'half');
  assert.equal(resolveSheetSnap(600, 0.1, heights), 'full');
  assert.equal(resolveSheetSnap(380, 0.6, heights), 'full');
  assert.equal(resolveSheetSnap(340, -0.6, heights), 'peek');
  assert.equal(resolveSheetSnap(680, 1, heights), 'full');
  assert.equal(resolveSheetSnap(112, -1, heights), 'peek');
});

function initSheet(options) {
  const dom = makeMapFirstDom(options);
  globalThis.window = dom.view;
  const changes = [];
  const controller = initBottomSheet({
    documentRoot: dom.documentRoot,
    onSnapChange: (snap, source) => changes.push([snap, source]),
  });
  return { ...dom, controller, changes };
}

test('the sheet starts at half and exposes its geometry through CSS variables', () => {
  const { elements, documentRoot } = initSheet();
  assert.equal(getSheetSnap(), 'half');
  assert.equal(getSheetVisibleHeight(), 360);
  assert.equal(elements.panel.dataset.sheet, 'half');
  assert.equal(elements['app-body'].dataset.sheet, 'half');
  assert.equal(elements.panel.style.values['--sheet-h'], '680px');
  assert.equal(elements.panel.style.values['--sheet-y'], '320px');
  assert.equal(documentRoot.documentElement.style.values['--sheet-visible'], '360px');
});

test('the handle toggles between half and full and labels its next action', () => {
  const { elements, changes } = initSheet();
  const handle = elements['sheet-handle'];
  assert.equal(handle.getAttribute('aria-expanded'), 'false');
  assert.equal(handle.dataset.i18nAria, 'sheet_expand');

  handle.dispatchEvent(new Event('click'));
  assert.equal(getSheetSnap(), 'full');
  assert.equal(handle.getAttribute('aria-expanded'), 'true');
  assert.equal(handle.dataset.i18nAria, 'sheet_collapse');
  assert.equal(elements.panel.style.values['--sheet-y'], '0px');

  handle.dispatchEvent(new Event('click'));
  assert.equal(getSheetSnap(), 'half');
  setSheetSnap('peek');
  assert.deepEqual(changes, [['full', 'handle'], ['half', 'handle'], ['peek', 'program']]);
});

test('dragging the header follows the finger and snaps on release', () => {
  const { elements, changes } = initSheet();
  const panel = elements.panel;
  const grip = { closest: selector => selector.includes('#sheet-grip') ? grip : null };
  const pointer = (type, clientY, timeStamp) => {
    const event = Object.assign(new Event(type), {
      isPrimary: true, pointerType: 'touch', pointerId: 7, button: 0, clientX: 100, clientY,
    });
    Object.defineProperty(event, 'target', { value: grip });
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
    return event;
  };
  panel.dispatchEvent(pointer('pointerdown', 440, 0));
  panel.dispatchEvent(pointer('pointermove', 436, 16)); // inside the slop: no move
  assert.equal(panel.style.values['--sheet-y'], '320px');
  panel.dispatchEvent(pointer('pointermove', 300, 400));
  assert.equal(panel.style.values['--sheet-y'], '180px');
  assert.ok(panel.classList.contains('is-dragging'));
  panel.dispatchEvent(pointer('pointermove', 200, 800));
  panel.dispatchEvent(pointer('pointerup', 200, 1600));
  // 600px visible at a slow release: nearest snap is full.
  assert.equal(getSheetSnap(), 'full');
  assert.equal(panel.classList.contains('is-dragging'), false);
  assert.deepEqual(changes, [['full', 'drag']]);
});

test('desktop leaves the panel alone', () => {
  const { elements, documentRoot } = initSheet({ width: 1280 });
  elements['sheet-handle'].dispatchEvent(new Event('click'));
  assert.equal(getSheetSnap(), 'half');
  assert.equal(getSheetVisibleHeight(), 0);
  assert.equal(documentRoot.documentElement.style.values['--sheet-visible'], '0px');
});

test('init returns null without the panel markup', () => {
  assert.equal(initBottomSheet({ documentRoot: { getElementById: () => null, defaultView: {} } }), null);
});
