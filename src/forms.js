import { t } from './i18n.js';
import { state } from './state.js';
import { parseCSV } from './csv-parser.js';
import { doNetlifySubmit, resetFeedback } from './submit.js';

const LOCATIONS_API = '/api/locations';

/** @param {string} id @returns {HTMLElement} */
function requiredElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

/** @param {string} id @returns {HTMLInputElement|HTMLTextAreaElement} */
function requiredValueControl(id) {
  return /** @type {HTMLInputElement|HTMLTextAreaElement} */ (requiredElement(id));
}

// ═══════════════════════════════════════════════════
// ISSUE REPORT MODAL
// ═══════════════════════════════════════════════════
export function openIssueModal() {
  ['issue-message', 'issue-contact'].forEach(id => { requiredValueControl(id).value = ''; });
  resetFeedback('issue-feedback', 'issue-submit-btn', t('issue_submit'));
  requiredElement('issue-modal').classList.add('open');
}

export function closeIssueModal() {
  requiredElement('issue-modal').classList.remove('open');
}

/** @param {string} message @returns {string} */
export function validateIssueReport(message) {
  return message.trim() ? '' : 'err_issue_required';
}

/** @returns {Record<string,string>} */
export function buildIssueReportPayload() {
  return {
    'form-name': 'issue-report',
    'bot-field': '',
    message: requiredValueControl('issue-message').value.trim(),
    page_url: location.href,
    contact: requiredValueControl('issue-contact').value.trim(),
  };
}

export async function submitIssueReport() {
  const message = requiredValueControl('issue-message').value;
  const fb = requiredElement('issue-feedback');
  const errorKey = validateIssueReport(message);
  if (errorKey) { fb.className = 'submit-feedback err'; fb.textContent = t(errorKey); return; }

  await doNetlifySubmit('issue-submit-btn', 'issue-feedback', t('issue_submit'), buildIssueReportPayload(), () => {
    fb.className = 'submit-feedback ok'; fb.textContent = t('issue_submit_ok');
    setTimeout(closeIssueModal, 2200);
  });
}


/** @param {() => void} rebuild @returns {Promise<void>} */
export async function tryLoadSheet(rebuild) {
  const bar = document.createElement('div'); bar.className = 'loading-bar'; document.body.appendChild(bar);
  try {
    const resp = await fetch(LOCATIONS_API); if (!resp.ok) throw new Error();
    const parsed = parseCSV(await resp.text());
    if (parsed && parsed.length) state.data = parsed;
  } catch (e) { console.warn('Sheet load failed', e); }
  state.isLoading = false; bar.remove(); rebuild();
}
