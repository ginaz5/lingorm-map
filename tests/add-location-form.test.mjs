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

function getAddLocationPayloadKeys(html) {
  const payloadBuilderMatch = html.match(/function buildAddLocationPayload\(\)\{[\s\S]*?\n\}/);
  assert.ok(payloadBuilderMatch, 'buildAddLocationPayload function should exist');

  const payloadMatch = payloadBuilderMatch[0].match(/return \{([\s\S]*?)\};/);
  assert.ok(payloadMatch, 'buildAddLocationPayload should return a payload object');

  const keyMatches = payloadMatch[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm);
  return [...keyMatches].map((match) => match[1] || match[2]);
}

function getAddLocationValidators(html) {
  const validatorsMatch = html.match(/function isGoogleMapsUrl\(url\)\{[\s\S]*?(?=\nfunction buildAddLocationPayload\(\))/);
  assert.ok(validatorsMatch, 'add-location validation functions should exist');

  return Function(`${validatorsMatch[0]}; return { isGoogleMapsUrl, validateAddLocation };`)();
}

test('add-location Netlify detection form declares every submitted field', async () => {
  const html = await loadIndexHtml();
  const detectionFields = getHiddenFormFieldNames(html, 'add-location');
  const submittedFields = getAddLocationPayloadKeys(html).filter((field) => field !== 'form-name');

  const missingFields = submittedFields.filter((field) => !detectionFields.has(field));

  assert.deepEqual(missingFields, []);
});

test('Netlify form submit mock is limited to local development hosts', async () => {
  const html = await loadIndexHtml();
  const mockMatch = html.match(/function shouldMockNetlifySubmit\(\)\{[\s\S]*?\n\}/);
  assert.ok(mockMatch, 'shouldMockNetlifySubmit function should exist');

  const shouldMockFor = (hostname) => Function(
    'location',
    `${mockMatch[0]}; return shouldMockNetlifySubmit();`,
  )({ hostname });

  assert.equal(shouldMockFor('localhost'), true);
  assert.equal(shouldMockFor('127.0.0.1'), true);
  assert.equal(shouldMockFor('[::1]'), true);
  assert.equal(shouldMockFor('lingorm-map.netlify.app'), false);
});

test('add-location modal has localized success view copy', async () => {
  const html = await loadIndexHtml();

  assert.match(html, /id="add-form-view"/);
  assert.match(html, /id="add-success-view"/);
  assert.match(html, /data-i18n="add_success_title"/);
  assert.match(html, /data-i18n="add_success_desc"/);
  assert.match(html, /data-i18n="done"/);
  assert.match(html, /add_success_title:\s*'感謝您的地點貢獻'/);
  assert.match(html, /add_success_title:\s*'Thanks for contributing a location'/);
});

test('add-location validation only accepts real Google Maps URL hosts', async () => {
  const html = await loadIndexHtml();
  const { validateAddLocation } = getAddLocationValidators(html);

  assert.equal(validateAddLocation('', ''), 'err_maps_required');
  assert.equal(validateAddLocation('', 'https://maps.app.goo.gl/abc'), '');
  assert.equal(validateAddLocation('', 'https://goo.gl/maps/abc'), '');
  assert.equal(validateAddLocation('', 'https://www.google.com/maps/place/Bangkok'), '');
  assert.equal(validateAddLocation('', 'https://maps.google.com/?q=Bangkok'), '');
  assert.equal(validateAddLocation('', 'https://maps.app.goo.glevil/abc'), 'err_maps_invalid');
  assert.equal(validateAddLocation('', 'https://maps.google.com.evil/?q=Bangkok'), 'err_maps_invalid');
  assert.equal(validateAddLocation('', 'https://example.com/maps'), 'err_maps_invalid');
});
