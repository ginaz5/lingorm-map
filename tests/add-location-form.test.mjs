// Updated for Option B modularisation:
//   - buildAddLocationPayload / validators extracted from src/forms.js
//   - shouldMockNetlifySubmit / doNetlifySubmit extracted from src/submit.js
//   - add_success_title i18n strings checked in src/i18n.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadIndexHtml() {
  return readFile(new URL('../index.html', import.meta.url), 'utf8');
}

function getHiddenFormFieldNames(html, formName) {
  const formMatch = html.match(new RegExp(`<form[^>]*name="${formName}"[\\s\\S]*?<\\/form>`));
  assert.ok(formMatch, `${formName} detection form should exist`);

  const fieldMatches = formMatch[0].matchAll(/<(?:input|textarea|select)\b[^>]*\bname="([^"]+)"/g);
  return new Set([...fieldMatches].map((match) => match[1]));
}

function getAddLocationPayloadKeys(src) {
  const payloadBuilderMatch = src.match(
    /(?:export\s+)?function buildAddLocationPayload\(\)\s*\{[\s\S]*?\n\}/
  );
  assert.ok(payloadBuilderMatch, 'buildAddLocationPayload function should exist in src/forms.js');

  const payloadMatch = payloadBuilderMatch[0].match(/return \{([\s\S]*?)\};/);
  assert.ok(payloadMatch, 'buildAddLocationPayload should return a payload object');

  const keyMatches = payloadMatch[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm);
  return [...keyMatches].map((match) => match[1] || match[2]);
}

function getAddLocationValidators(src) {
  // Captures isGoogleMapsUrl + validateAddLocation up to buildAddLocationPayload
  const validatorsMatch = src.match(
    /(?:export\s+)?function isGoogleMapsUrl\(url\)\s*\{[\s\S]*?(?=\n(?:export\s+)?function buildAddLocationPayload\(\))/
  );
  assert.ok(validatorsMatch, 'add-location validation functions should exist in src/forms.js');

  const code = validatorsMatch[0].replace(/\bexport\s+/g, '');
  return Function(`${code}; return { isGoogleMapsUrl, validateAddLocation };`)();
}

function getNetlifySubmitFunctions(src, deps) {
  // Captures shouldMockNetlifySubmit + doNetlifySubmit up to resetFeedback
  const submitMatch = src.match(
    /(?:export\s+)?function shouldMockNetlifySubmit\(\)\s*\{[\s\S]*?(?=\n(?:export\s+)?function resetFeedback\()/
  );
  assert.ok(submitMatch, 'Netlify submit functions should exist in src/submit.js');

  const code = submitMatch[0].replace(/\bexport\s+/g, '');
  return Function(
    'location',
    'document',
    'recordPending',
    't',
    'console',
    `${code}; return { shouldMockNetlifySubmit, doNetlifySubmit };`,
  )(deps.location, deps.document, deps.recordPending, deps.t, deps.console);
}

test('add-location Netlify detection form declares every submitted field', async () => {
  const html = await loadIndexHtml();
  const formsSrc = await readFile(new URL('../src/forms.js', import.meta.url), 'utf8');

  const detectionFields = getHiddenFormFieldNames(html, 'add-location');
  const submittedFields = getAddLocationPayloadKeys(formsSrc).filter((field) => field !== 'form-name');

  const missingFields = submittedFields.filter((field) => !detectionFields.has(field));

  assert.deepEqual(missingFields, []);
});

test('Netlify form submit mock is limited to local development hosts', async () => {
  const src = await readFile(new URL('../src/submit.js', import.meta.url), 'utf8');
  const mockMatch = src.match(/(?:export\s+)?function shouldMockNetlifySubmit\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(mockMatch, 'shouldMockNetlifySubmit function should exist in src/submit.js');

  const code = mockMatch[0].replace(/\bexport\s+/g, '');
  const shouldMockFor = (hostname) => Function(
    'location',
    `${code}; return shouldMockNetlifySubmit();`,
  )({ hostname });

  assert.equal(shouldMockFor('localhost'), true);
  assert.equal(shouldMockFor('127.0.0.1'), true);
  assert.equal(shouldMockFor('[::1]'), true);
  assert.equal(shouldMockFor('lingorm-map.netlify.app'), false);
});

test('add-location modal has localized success view copy', async () => {
  const html = await loadIndexHtml();
  const i18nSrc = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');

  // HTML structure check (still in index.html)
  assert.match(html, /id="add-form-view"/);
  assert.match(html, /id="add-success-view"/);
  assert.match(html, /data-i18n="add_success_title"/);
  assert.match(html, /data-i18n="add_success_desc"/);
  assert.match(html, /data-i18n="done"/);

  // i18n string content now lives in src/i18n.js
  assert.match(i18nSrc, /add_success_title:\s*'感謝您的地點貢獻'/);
  assert.match(i18nSrc, /add_success_title:\s*'Thanks for contributing a location'/);
});

test('add-location validation only accepts real Google Maps URL hosts', async () => {
  const src = await readFile(new URL('../src/forms.js', import.meta.url), 'utf8');
  const { validateAddLocation } = getAddLocationValidators(src);

  assert.equal(validateAddLocation('', ''), 'err_maps_required');
  assert.equal(validateAddLocation('', 'https://maps.app.goo.gl/abc'), '');
  assert.equal(validateAddLocation('', 'https://goo.gl/maps/abc'), '');
  assert.equal(validateAddLocation('', 'https://www.google.com/maps/place/Bangkok'), '');
  assert.equal(validateAddLocation('', 'https://maps.google.com/?q=Bangkok'), '');
  assert.equal(validateAddLocation('', 'https://maps.app.goo.glevil/abc'), 'err_maps_invalid');
  assert.equal(validateAddLocation('', 'https://maps.google.com.evil/?q=Bangkok'), 'err_maps_invalid');
  assert.equal(validateAddLocation('', 'https://example.com/maps'), 'err_maps_invalid');
});

test('Netlify submit local mock records pending and delegates success handling', async () => {
  const src = await readFile(new URL('../src/submit.js', import.meta.url), 'utf8');
  const elements = {
    submit: { disabled: false, textContent: '' },
    feedback: { className: 'old', textContent: 'old' },
  };
  let pendingCount = 0;
  const { doNetlifySubmit } = getNetlifySubmitFunctions(src, {
    location: { hostname: 'localhost' },
    document: { getElementById: (id) => elements[id] },
    recordPending: () => { pendingCount += 1; },
    t: (key) => ({ submitting: 'Submitting...' }[key] || key),
    console: { info: () => {} },
  });

  let successFeedback = null;
  await doNetlifySubmit(
    'submit',
    'feedback',
    'Submit',
    { 'form-name': 'add-location' },
    (fb) => {
      successFeedback = fb;
      fb.className = 'submit-feedback ok';
      fb.textContent = 'ok';
    },
  );

  assert.equal(pendingCount, 1);
  assert.equal(successFeedback, elements.feedback);
  assert.equal(elements.submit.disabled, true);
  assert.equal(elements.submit.textContent, 'Submitting...');
  assert.equal(elements.feedback.className, 'submit-feedback ok');
  assert.equal(elements.feedback.textContent, 'ok');
});
