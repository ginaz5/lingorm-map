import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { initCollectionInfo } from '../src/features/collection-info.js';

class FakeElement extends EventTarget {
  constructor(documentRoot) {
    super();
    this.documentRoot = documentRoot;
    this.parentElement = null;
    this.children = [];
    this.hidden = false;
    this.hovered = false;
    this.attributes = new Map();
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
  }

  contains(node) {
    return node === this || this.children.some(child => child.contains(node));
  }

  matches(selector) {
    return selector === ':hover' && this.hovered;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.documentRoot.activeElement = this;
    this.dispatchEvent(new Event('focus'));
  }
}

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.activeElement = null;
    this.elements = new Map();
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }
}

function makeEnvironment() {
  const documentRoot = new FakeDocument();
  const wrapper = new FakeElement(documentRoot);
  const trigger = new FakeElement(documentRoot);
  const popover = new FakeElement(documentRoot);
  const closeButton = new FakeElement(documentRoot);
  const outside = new FakeElement(documentRoot);

  popover.hidden = true;
  wrapper.append(trigger);
  wrapper.append(popover);
  popover.append(closeButton);
  documentRoot.elements.set('type-info-btn', trigger);
  documentRoot.elements.set('type-info-popover', popover);
  documentRoot.elements.set('type-info-close', closeButton);

  initCollectionInfo(/** @type {Document} */ (/** @type {unknown} */ (documentRoot)));
  return { documentRoot, wrapper, trigger, popover, closeButton, outside };
}

function waitForClose() {
  return new Promise(resolve => setTimeout(resolve, 180));
}

function escapeEvent() {
  const event = new Event('keydown');
  Object.defineProperty(event, 'key', { value: 'Escape' });
  return event;
}

test('collection guide opens on hover and closes after the pointer leaves', async () => {
  const { wrapper, trigger, popover } = makeEnvironment();

  trigger.dispatchEvent(new Event('pointerenter'));
  assert.equal(popover.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');

  wrapper.dispatchEvent(new Event('pointerleave'));
  await waitForClose();
  assert.equal(popover.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('collection guide click pins, toggles, and closes on outside click', () => {
  const { documentRoot, trigger, popover } = makeEnvironment();

  trigger.dispatchEvent(new Event('click'));
  assert.equal(popover.hidden, false);

  trigger.dispatchEvent(new Event('click'));
  assert.equal(popover.hidden, true);

  trigger.dispatchEvent(new Event('click'));
  documentRoot.dispatchEvent(new Event('click'));
  assert.equal(popover.hidden, true);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('collection guide follows focus and Escape without reopening itself', async () => {
  const { documentRoot, wrapper, trigger, popover, outside } = makeEnvironment();

  trigger.focus();
  assert.equal(popover.hidden, false);

  documentRoot.activeElement = outside;
  wrapper.dispatchEvent(new Event('focusout'));
  await waitForClose();
  assert.equal(popover.hidden, true);

  trigger.focus();
  documentRoot.dispatchEvent(escapeEvent());
  assert.equal(popover.hidden, true);
  assert.equal(documentRoot.activeElement, trigger);
});

test('collection guide close button closes and restores trigger focus', () => {
  const { documentRoot, trigger, popover, closeButton } = makeEnvironment();

  trigger.dispatchEvent(new Event('click'));
  closeButton.dispatchEvent(new Event('click'));

  assert.equal(popover.hidden, true);
  assert.equal(documentRoot.activeElement, trigger);
});

test('collection guide is height constrained and scrollable in short viewports', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(
    css,
    /\.type-info-popover\{[^}]*max-height:min\(360px,calc\(100dvh - 195px\)\);overflow-y:auto;/,
  );
});
