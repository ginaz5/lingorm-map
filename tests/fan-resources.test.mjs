import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { initFanResources } from '../src/features/fan-resources.js';

function makeEnvironment() {
  const documentRoot = {
    activeElement: null,
    getElementById: id => elements.get(id) ?? null,
    querySelector: () => mobileTrigger,
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
  const trigger = element();
  const mobileTrigger = element();
  const more = element();
  const closeButton = element();
  const dialog = Object.assign(element(), {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; this.dispatchEvent(new Event('close')); },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 600, bottom: 600 }),
  });
  const elements = new Map([
    ['fan-resources-btn', trigger], ['mobile-actions-btn', more],
    ['fan-resources-modal', dialog], ['fan-resources-close', closeButton],
  ]);
  const controller = initFanResources(documentRoot);
  return { documentRoot, trigger, mobileTrigger, more, closeButton, dialog, controller };
}

function pointerEvent(type, clientX, clientY) {
  return Object.assign(new Event(type), { clientX, clientY });
}

test('desktop resources opens with close-button focus and restores the opener', () => {
  const { documentRoot, trigger, mobileTrigger, closeButton, dialog, controller, more } = makeEnvironment();
  trigger.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, true);
  assert.equal(documentRoot.activeElement, closeButton);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(mobileTrigger.getAttribute('aria-expanded'), 'true');
  controller.open(more); // Repeated opens must not replace the original focus target.
  closeButton.dispatchEvent(new Event('click'));
  assert.equal(dialog.open, false);
  assert.equal(documentRoot.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(mobileTrigger.getAttribute('aria-expanded'), 'false');
});

test('mobile dismissal restores More instead of a hidden menu item', () => {
  const { documentRoot, controller, more, dialog, mobileTrigger } = makeEnvironment();
  mobileTrigger.visible = false;
  controller.open(more);
  dialog.close(); // Also exercises the native Escape close-event path.
  assert.equal(documentRoot.activeElement, more);
  assert.equal(mobileTrigger.getAttribute('aria-expanded'), 'false');
});

test('focus falls back to More if the desktop opener disappears at a breakpoint', () => {
  const { documentRoot, controller, trigger, more, dialog } = makeEnvironment();
  controller.open(trigger);
  trigger.visible = false;
  dialog.close();
  assert.equal(documentRoot.activeElement, more);
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

test('resource links distinguish the Fanpage homepage from its schedule shortcut', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dialog = html.match(/<dialog\b[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);
  const links = [...dialog.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
  assert.equal(links.length, 3);
  for (const [url, className] of [
    ['https://www.lingorm.site/', 'fan-resource-visit'],
    ['https://www.lingorm.site/upcoming-schedule', 'fan-resource-shortcut'],
    ['https://loism1127.com/', 'fan-resource-visit'],
  ]) {
    const link = links.find(markup => markup.includes(`href="${url}"`));
    assert.ok(link, url);
    assert.ok(link.includes(`class="${className}"`));
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
    assert.match(link, /data-i18n-aria="fan_resources_/);
  }
});
