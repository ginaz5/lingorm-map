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

function getIssueReportPayloadKeys(src) {
  const payloadBuilderMatch = src.match(
    /(?:export\s+)?function buildIssueReportPayload\(\)\s*\{[\s\S]*?\n\}/
  );
  assert.ok(payloadBuilderMatch, 'buildIssueReportPayload function should exist in src/features/forms.js');

  const payloadMatch = payloadBuilderMatch[0].match(/return \{([\s\S]*?)\};/);
  assert.ok(payloadMatch, 'buildIssueReportPayload should return a payload object');

  const keyMatches = payloadMatch[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm);
  return [...keyMatches].map((match) => match[1] || match[2]);
}

test('issue-report Netlify detection form declares every submitted field', async () => {
  const html = await loadIndexHtml();
  const formsSrc = await readFile(new URL('../src/features/forms.js', import.meta.url), 'utf8');

  const detectionFields = getHiddenFormFieldNames(html, 'issue-report');
  const submittedFields = getIssueReportPayloadKeys(formsSrc).filter((field) => field !== 'form-name');
  const missingFields = submittedFields.filter((field) => !detectionFields.has(field));

  assert.deepEqual(missingFields, []);
});

test('issue report UI has header button and localized modal copy', async () => {
  const html = await loadIndexHtml();
  const i18nSrc = await readFile(new URL('../src/core/i18n.js', import.meta.url), 'utf8');
  const formsSrc = await readFile(new URL('../src/features/forms.js', import.meta.url), 'utf8');

  assert.match(html, /id="issue-btn"/);
  assert.match(html, /id="issue-modal"/);
  assert.match(html, /data-i18n="issue_title"/);
  assert.match(html, /data-i18n="issue_desc"/);
  assert.match(html, /id="issue-message"/);
  assert.doesNotMatch(html, /id="issue-type"/);
  assert.doesNotMatch(html, /name="issue_type"/);
  assert.match(i18nSrc, /issue_title:\s*'問題回報'/);
  assert.match(i18nSrc, /issue_title:\s*'Report an issue'/);
  assert.match(i18nSrc, /issue_submit_ok:\s*'✅ 已收到回報，感謝你提供資訊。'/);
  assert.match(i18nSrc, /issue_submit_ok:\s*'✅ Report received\. Thank you for letting us know\.'/);
  assert.match(formsSrc, /t\('issue_submit_ok'\)/);
});
