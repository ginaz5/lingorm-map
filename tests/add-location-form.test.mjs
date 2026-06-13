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

test('add-location Netlify detection form declares every submitted field', async () => {
  const html = await loadIndexHtml();
  const detectionFields = getHiddenFormFieldNames(html, 'add-location');
  const submittedFields = getAddLocationPayloadKeys(html).filter((field) => field !== 'form-name');

  const missingFields = submittedFields.filter((field) => !detectionFields.has(field));

  assert.deepEqual(missingFields, []);
});
