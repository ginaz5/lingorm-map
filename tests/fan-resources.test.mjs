import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initFanResources } from '../src/features/fan-resources.js';
import { setLang } from '../src/core/i18n.js';

function makeEnvironment() {
  const documentRoot = {
    activeElement: null,
    getElementById: id => elements.get(id) ?? null,
  };
  function element() {
    return Object.assign(new EventTarget(), {
      isConnected: true,
      visible: true,
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      getAttribute(name) { return this.attributes.get(name); },
      getClientRects() { return this.visible ? [{}] : []; },
      focus() { documentRoot.activeElement = this; },
    });
  }
  // The entry is a side-menu item; the menu closes first, so focus returns
  // to the search bar's menu button.
  const trigger = element();
  const menuButton = element();
  const closeButton = element();
  const links = [
    ['lingorm_google_maps', 'source'], ['lingorm_google_maps', 'website'],
    ['lingorm_fanpage', 'source'], ['lingorm_fanpage', 'schedule'], ['lingorm_fanpage', 'website'],
    ['loism', 'source'], ['loism', 'website'], ['lingorm_news', 'source'], ['lingorm_news', 'website'],
    ['lingorm_pics', 'source'], ['lingorm_pics', 'website'],
    ['lingorm_music', 'source'], ['lingorm_music', 'website'],
    ['lingorm_feed_your_mind', 'source'], ['lingorm_feed_your_mind', 'website'],
  ].map(([resourceId, linkType]) => {
    const card = element();
    card.setAttribute('data-resource-id', resourceId);
    const link = element();
    link.setAttribute('data-resource-link', linkType);
    link.closest = () => card;
    return link;
  });
  const dialog = Object.assign(element(), {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatchEvent(new Event('close')); },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 600, bottom: 600 }),
    querySelectorAll: () => links,
  });
  const elements = new Map([
    ['fan-resources-btn', trigger], ['menu-btn', menuButton],
    ['fan-resources-modal', dialog], ['fan-resources-close', closeButton],
  ]);
  const controller = initFanResources(documentRoot);
  return { documentRoot, trigger, menuButton, closeButton, dialog, controller, links };
}

function pointerEvent(type, clientX, clientY) {
  return Object.assign(new Event(type), { clientX, clientY });
}

test('resources opens with close-button focus and returns focus to the menu button', () => {
  const { documentRoot, trigger, menuButton, closeButton, dialog, controller } = makeEnvironment();
  controller.open();
  assert.equal(dialog.open, true);
  assert.equal(documentRoot.activeElement, closeButton);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  controller.open(trigger); // Repeated opens must not replace the original focus target.
  closeButton.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.equal(documentRoot.activeElement, menuButton);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('focus falls back to the menu button when the requested opener is hidden', () => {
  const { documentRoot, controller, trigger, menuButton, dialog } = makeEnvironment();
  controller.open(trigger);
  trigger.visible = false; // The side menu closed around it.
  dialog.close(); // Also exercises the native Escape close-event path.
  assert.equal(documentRoot.activeElement, menuButton);
});

test('the side menu item does not open the dialog on its own', () => {
  const { trigger, dialog } = makeEnvironment();
  trigger.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false, 'main.js closes the menu first, then calls open()');
});

test('only a gesture starting and ending outside the dialog dismisses it', () => {
  const { controller, dialog } = makeEnvironment();
  controller.open();
  dialog.dispatchEvent(pointerEvent('pointerdown', 200, 200));
  dialog.dispatchEvent(pointerEvent('click', 200, 200));
  assert.equal(dialog.open, true, 'content clicks stay open');
  dialog.dispatchEvent(pointerEvent('pointerdown', 200, 200));
  dialog.dispatchEvent(pointerEvent('click', 10, 10));
  assert.equal(dialog.open, true, 'dragging out of the panel stays open');
  dialog.dispatchEvent(pointerEvent('pointerdown', 10, 10));
  dialog.dispatchEvent(pointerEvent('click', 10, 10));
  assert.equal(dialog.open, false, 'backdrop clicks close');
});

test('missing resources markup is safe on pages without the feature', () => {
  assert.equal(initFanResources({ getElementById: () => null }), null);
});

test('resources tracks each successful open once with its entry point', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { dataLayer: [{ event: 'location_open', location_id: 'previous-place' }] };
  try {
    const { menuButton, dialog, controller, closeButton } = makeEnvironment();
    controller.open();
    controller.open(menuButton);
    dialog.dispatchEvent(pointerEvent('click', 200, 200));
    closeButton.dispatchEvent(new Event('click'));
    controller.open(menuButton);
    dialog.close();
    controller.open(null, 'unknown');
    assert.deepEqual(globalThis.window.dataLayer.slice(1), [
      { event: 'fan_resources_open', ui_language: 'zh', interaction_source: 'side_menu' },
      { event: 'fan_resources_open', ui_language: 'zh', interaction_source: 'side_menu' },
      { event: 'fan_resources_open', ui_language: 'zh', interaction_source: 'unknown' },
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('a dialog that fails to open does not queue an open event', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { dataLayer: [] };
  try {
    const { dialog, controller } = makeEnvironment();
    dialog.showModal = () => { throw new Error('dialog unavailable'); };
    assert.throws(() => controller.open(), /dialog unavailable/);
    assert.deepEqual(globalThis.window.dataLayer, []);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('each resource link queues its card and link type without preventing navigation', () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() {} };
  globalThis.window = { dataLayer: [{ event: 'location_open', location_id: 'previous-place' }] };
  try {
    const { controller, links, dialog } = makeEnvironment();
    controller.open();
    for (const link of links) {
      const click = new Event('click', { cancelable: true });
      link.dispatchEvent(click);
      assert.equal(click.defaultPrevented, false);
      assert.deepEqual(globalThis.window.dataLayer.at(-1), {
        event: 'fan_resource_click',
        resource_id: link.closest().getAttribute('data-resource-id'),
        link_type: link.getAttribute('data-resource-link'),
        ui_language: 'zh', interaction_source: 'side_menu',
      });
    }
    const trackedClicks = links.length + 2; // Initial event, one open, and one click per link.
    assert.equal(globalThis.window.dataLayer.length, trackedClicks, 'one open plus exactly one click per link');
    dialog.close();
    links[0].dispatchEvent(new Event('click'));
    assert.equal(globalThis.window.dataLayer.length, trackedClicks, 'closed dialog does not track');
    setLang('en');
    controller.open(null, 'unknown');
    links[3].dispatchEvent(Object.assign(new Event('auxclick'), { button: 2 }));
    assert.equal(globalThis.window.dataLayer.length, trackedClicks + 1, 'right click does not track');
    links[3].dispatchEvent(Object.assign(new Event('auxclick'), { button: 1 }));
    assert.deepEqual(globalThis.window.dataLayer.at(-1), {
      event: 'fan_resource_click', resource_id: 'lingorm_fanpage', link_type: 'schedule',
      ui_language: 'en', interaction_source: 'unknown',
    });
    const cancelled = new Event('click', { cancelable: true });
    cancelled.preventDefault();
    links[3].dispatchEvent(cancelled);
    assert.equal(globalThis.window.dataLayer.length, trackedClicks + 2, 'cancelled navigation does not track');
  } finally {
    setLang('zh');
    globalThis.localStorage = previousStorage;
    globalThis.window = previousWindow;
  }
});

test('all seven cards have stable analytics IDs and all fifteen links have a defined type', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const cards = [...html.matchAll(/<article class="fan-resource" data-resource-id="([^"]+)">([\s\S]*?)<\/article>/g)];
  assert.deepEqual(cards.map(card => card[1]), [
    'lingorm_google_maps', 'lingorm_fanpage', 'loism', 'lingorm_news', 'lingorm_pics', 'lingorm_music',
    'lingorm_feed_your_mind',
  ]);
  for (const card of cards) {
    for (const link of card[2].matchAll(/<a\b[^>]*>/g)) {
      const kind = link[0].match(/data-resource-link="([^"]+)"/)?.[1];
      assert.ok(['source', 'website', 'schedule'].includes(kind));
      assert.equal(kind, link[0].includes('fan-resource-visit') ? 'website'
        : link[0].includes('fan-resource-shortcut') ? 'schedule' : 'source');
    }
  }
});

test('resource links distinguish the Fanpage homepage from its schedule shortcut', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dialog = html.match(/<dialog class="fan-resources-dialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);
  const links = [...dialog.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
  assert.equal(links.length, 15);
  for (const [url, className] of [
    ['https://maps.app.goo.gl/eSnPtMYzPsqS3PjU7?g_st=i', 'fan-resource-visit'],
    ['https://www.threads.com/@___epoh___/post/DPv0bDVieSE', 'fan-resource-source'],
    ['https://www.lingorm.site/', 'fan-resource-visit'],
    ['https://x.com/phicha__', 'fan-resource-source'],
    ['https://www.lingorm.site/upcoming-schedule', 'fan-resource-shortcut'],
    ['https://loism1127.com/', 'fan-resource-visit'],
    ['https://www.threads.com/share/P9Qe99Kfr/', 'fan-resource-source'],
    ['https://lingormnews.wordpress.com/', 'fan-resource-visit'],
    ['https://www.threads.com/@lingormcrew', 'fan-resource-source'],
    ['https://lingorm.pics/', 'fan-resource-visit'],
    ['https://x.com/_rr0715', 'fan-resource-source'],
    ['https://orm2527.github.io/my-music/', 'fan-resource-visit'],
    ['https://www.threads.com/share/FL9IREfmh/', 'fan-resource-source'],
    ['https://lingormfeedyourmind.com/', 'fan-resource-visit'],
    ['https://www.threads.com/share/DZSk9W9bZ/', 'fan-resource-source'],
  ]) {
    const link = links.find(markup => markup.includes(`href="${url}"`));
    assert.ok(link, url);
    assert.ok(link.includes(`class="${className}"`));
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
    assert.match(link, /data-i18n-aria="fan_resources_/);
  }
});

test('the music archive card keeps its original Threads source beside the website', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const card = html.match(/<article class="fan-resource" data-resource-id="lingorm_music">[\s\S]*?<\/article>/)?.[0];
  assert.ok(card);
  assert.match(card, /<h3>LingOrm Music Archive<\/h3>/);
  assert.match(card, /data-i18n="fan_resources_music_subtitle"/);
  assert.match(card, /data-i18n="fan_resources_music_desc"/);
  assert.match(card, /data-i18n="fan_resources_music_source"/);
  assert.match(card, /href="https:\/\/www\.threads\.com\/share\/FL9IREfmh\/"/);
  assert.match(card, /href="https:\/\/orm2527\.github\.io\/my-music\/"/);
});

test('the fiction index card keeps its original Threads source beside the website', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const card = html.match(/<article class="fan-resource" data-resource-id="lingorm_feed_your_mind">[\s\S]*?<\/article>/)?.[0];
  assert.ok(card);
  assert.match(card, /<h3>LingOrm · Feed Your Mind<\/h3>/);
  assert.match(card, /data-i18n="fan_resources_fym_subtitle"/);
  assert.match(card, /data-i18n="fan_resources_fym_desc"/);
  assert.match(card, /data-i18n="fan_resources_fym_source"/);
  assert.match(card, /href="https:\/\/www\.threads\.com\/share\/DZSk9W9bZ\/"/);
  assert.match(card, /href="https:\/\/lingormfeedyourmind\.com\/"/);
});

test('the original map card keeps its author source beside the complete Google Maps list', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const card = [...html.matchAll(/<article class="fan-resource"[^>]*>[\s\S]*?<\/article>/g)]
    .map(match => match[0])
    .find(markup => markup.includes('https://maps.app.goo.gl/eSnPtMYzPsqS3PjU7?g_st=i'));
  assert.ok(card);
  assert.match(card, /data-i18n="fan_resources_map_subtitle"/);
  assert.match(card, /data-i18n="fan_resources_map_desc"/);
  assert.match(card, /href="https:\/\/www\.threads\.com\/@___epoh___\/post\/DPv0bDVieSE"/);
  assert.match(card, /data-i18n="fan_resources_map_source"/);
  assert.match(card, /data-i18n="fan_resources_map_open"/);
});
