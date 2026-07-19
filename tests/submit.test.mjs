import assert from 'node:assert/strict';
import test from 'node:test';

import { doNetlifySubmit, shouldMockNetlifySubmit } from '../src/submit.js';

function installSubmitDom() {
  const elements = {
    submit: { disabled: false, textContent: '' },
    feedback: { className: 'old', textContent: 'old' },
  };
  globalThis.document = { getElementById: (id) => elements[id] ?? null };
  return elements;
}

function cleanup() {
  delete globalThis.document;
  delete globalThis.location;
  delete globalThis.fetch;
  delete globalThis.localStorage;
}

test('Netlify mock is limited to loopback hostnames', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    globalThis.location = { hostname };
    assert.equal(shouldMockNetlifySubmit(), true);
  }
  globalThis.location = { hostname: 'lingorm-map.netlify.app' };
  assert.equal(shouldMockNetlifySubmit(), false);
  delete globalThis.location;
});

test('local mock calls success without recording pending state', async () => {
  const elements = installSubmitDom();
  globalThis.location = { hostname: 'localhost' };
  globalThis.localStorage = {
    setItem() {
      assert.fail('local submit must not write pending state');
    },
  };
  const originalInfo = console.info;
  console.info = () => {};
  let successFeedback;

  try {
    await doNetlifySubmit(
      'submit',
      'feedback',
      'Send',
      { 'form-name': 'issue-report' },
      (feedback) => { successFeedback = feedback; },
    );
    assert.equal(successFeedback, elements.feedback);
    assert.equal(elements.submit.disabled, true);
  } finally {
    console.info = originalInfo;
    cleanup();
  }
});

test('production POST success calls the success callback', async () => {
  const elements = installSubmitDom();
  globalThis.location = { hostname: 'lingorm-map.netlify.app' };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.match(options.body, /form-name=issue-report/);
    return new Response('', { status: 200 });
  };
  let successFeedback;

  try {
    await doNetlifySubmit(
      'submit',
      'feedback',
      'Send',
      { 'form-name': 'issue-report' },
      (feedback) => { successFeedback = feedback; },
    );
    assert.equal(successFeedback, elements.feedback);
  } finally {
    cleanup();
  }
});

test('production POST failure shows feedback and restores the button', async () => {
  const elements = installSubmitDom();
  globalThis.location = { hostname: 'lingorm-map.netlify.app' };
  globalThis.fetch = async () => new Response('', { status: 500 });

  try {
    await doNetlifySubmit(
      'submit',
      'feedback',
      'Send report',
      { 'form-name': 'issue-report' },
      () => assert.fail('failure must not call success'),
    );
    assert.equal(elements.feedback.className, 'submit-feedback err');
    assert.match(elements.feedback.textContent, /送出失敗/);
    assert.equal(elements.submit.disabled, false);
    assert.equal(elements.submit.textContent, 'Send report');
  } finally {
    cleanup();
  }
});
