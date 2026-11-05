import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initSideMenu } from '../src/ui/side-menu.js';
import { initInstallApp, isIosDevice, isStandaloneDisplay } from '../src/features/install-app.js';
import { element } from './helpers/map-first-dom.mjs';

function makeMenu() {
  const documentRoot = { activeElement: null, documentElement: element() };
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
  const root = documentRoot.documentElement;
  trigger.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  // The floating search bar and chips step back while the drawer is open.
  assert.equal(root.classList.contains('menu-open'), true);
  closeButton.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.equal(root.classList.contains('menu-open'), false);
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

test('language and theme show both choices with the current one highlighted', async () => {
  const [html, css, mainSrc] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  ]);
  const { T } = await import('../src/core/i18n.js');
  const langBtn = html.match(/<button[^>]*id="lang-btn"[\s\S]*?<\/button>/)?.[0] ?? '';
  const themeBtn = html.match(/<button[^>]*id="theme-btn"[\s\S]*?<\/button>/)?.[0] ?? '';
  assert.match(langBtn, /data-i18n-aria="menu_language_aria"/);
  assert.match(langBtn, /data-lang-option="zh">中文</);
  assert.match(langBtn, /data-lang-option="en">English</);
  assert.match(themeBtn, /data-theme-option="light" data-i18n="theme_light"/);
  assert.match(themeBtn, /data-theme-option="dark" data-i18n="theme_dark"/);
  assert.doesNotMatch(html, /side-menu-value/, 'no lone value that could read as state or action');
  // Pre-paint: the inline head script sets both attributes the switch reads.
  assert.match(html, /dataset\.lang = localStorage\.getItem\('lang'\) === 'en' \? 'en' : 'zh'/);
  assert.match(css, /:root\[data-lang="zh"\] \[data-lang-option="zh"\],:root\[data-lang="en"\] \[data-lang-option="en"\],\s*:root\[data-theme="light"\] \[data-theme-option="light"\],:root\[data-theme="dark"\] \[data-theme-option="dark"\]\{/);
  assert.match(css, /\.menu-open \.map-top,\.menu-open \.map-fabs\{opacity:0;visibility:hidden;transition:opacity \.15s,visibility 0s \.15s\}/);
  // Visibility must come back instantly on close, or focus cannot return to ☰.
  assert.match(css, /\.map-top\{transition:opacity \.15s,visibility 0s\}/);
  // The theme label states the current value and the action, in both languages.
  assert.match(mainSrc, /theme === 'dark' \? 'menu_theme_aria_dark' : 'menu_theme_aria_light'/);
  for (const language of ['zh', 'en']) {
    for (const key of ['menu_language_aria', 'menu_theme_aria_light', 'menu_theme_aria_dark', 'map_provider_label']) {
      assert.equal(typeof T[language][key], 'string', `${language}.${key}`);
    }
  }
  assert.match(T.zh.menu_language_aria, /^語言：中文/);
  assert.match(T.en.menu_language_aria, /^Language: English/);
});
