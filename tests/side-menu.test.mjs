import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initSideMenu } from '../src/ui/side-menu.js';
import { initInstallApp, isIosDevice, isStandaloneDisplay } from '../src/features/install-app.js';
import { element } from './helpers/map-first-dom.mjs';

function makeMenu() {
  const documentRoot = { activeElement: null };
  const focusable = extra => {
    const node = element(extra);
    node.focus = () => { documentRoot.activeElement = node; };
    return node;
  };
  const dialog = focusable({
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatchEvent(new Event('close')); },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 320, bottom: 800 }),
  });
  const elements = { 'side-menu': dialog, 'menu-btn': focusable(), 'side-menu-close': focusable() };
  documentRoot.getElementById = id => elements[id] ?? null;
  return { documentRoot, dialog, trigger: elements['menu-btn'], closeButton: elements['side-menu-close'], menu: initSideMenu({ documentRoot }) };
}

test('the menu button opens the drawer and closing returns focus to it', () => {
  const { documentRoot, dialog, trigger, closeButton } = makeMenu();
  trigger.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  closeButton.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(documentRoot.activeElement, trigger);
});

test('closeThen hands focus to the next dialog instead of the menu button', () => {
  const { documentRoot, dialog, menu } = makeMenu();
  menu.open();
  const next = element();
  menu.closeThen(() => { documentRoot.activeElement = next; });
  assert.equal(dialog.open, false);
  assert.equal(documentRoot.activeElement, next);
});

test('a backdrop tap beside the drawer closes it; taps inside do not', () => {
  const { dialog, menu } = makeMenu();
  menu.open();
  const pointer = (type, clientX) => {
    const event = Object.assign(new Event(type), { clientX, clientY: 100 });
    Object.defineProperty(event, 'target', { value: dialog });
    return event;
  };
  dialog.dispatchEvent(pointer('pointerdown', 200));
  dialog.dispatchEvent(pointer('click', 200));
  assert.equal(dialog.open, true);
  dialog.dispatchEvent(pointer('pointerdown', 360));
  dialog.dispatchEvent(pointer('click', 360));
  assert.equal(dialog.open, false);
});

test('install entry hides inside the installed app and explains the browser step otherwise', () => {
  const standalone = { matchMedia: () => ({ matches: true }), navigator: {} };
  assert.equal(isStandaloneDisplay(standalone), true);
  assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), true);
  assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux' }), false);

  const button = element({ hidden: true });
  const listeners = {};
  const view = {
    matchMedia: () => ({ matches: false }),
    navigator: { userAgent: 'Android', platform: 'Linux' },
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const hints = [];
  initInstallApp({ documentRoot: { defaultView: view, getElementById: () => button }, showHint: message => hints.push(message) });
  assert.equal(button.hidden, false);
  button.dispatchEvent(new Event('click'));
  assert.equal(hints.length, 1);
  assert.match(hints[0], /安裝應用程式|加到主畫面/);

  // A browser-provided install prompt is used once instead of the hint.
  let prompted = 0;
  const promptEvent = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: async () => { prompted += 1; },
  });
  listeners.beforeinstallprompt(promptEvent);
  assert.equal(promptEvent.defaultPrevented, true, 'the mini-infobar is replaced by the menu entry');
  button.dispatchEvent(new Event('click'));
  assert.equal(prompted, 1);
  assert.equal(hints.length, 1);
  listeners.appinstalled();
  assert.equal(button.hidden, true);
});

test('the manifest makes the site installable without a service worker', async () => {
  const [manifestText, html] = await Promise.all([
    readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.name, 'LingOrm Map');
  const sizes = manifest.icons.map(icon => `${icon.sizes}:${icon.purpose}`);
  assert.deepEqual(sizes, ['192x192:any', '512x512:any', '512x512:maskable']);
  for (const icon of manifest.icons) {
    await readFile(new URL(`../public${icon.src}`, import.meta.url));
  }
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest"\/>/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png"\/>/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<meta name="theme-color" content="#ffffff"\/>/);
  assert.doesNotMatch(html, /serviceWorker|service-worker/);
});
