import { lang, t, CATEGORIES } from './i18n.js';
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

/** @param {string} id @returns {HTMLInputElement} */
function requiredInput(id) {
  return /** @type {HTMLInputElement} */ (requiredElement(id));
}

/** @param {string} id @returns {HTMLSelectElement} */
function requiredSelect(id) {
  return /** @type {HTMLSelectElement} */ (requiredElement(id));
}

// ═══════════════════════════════════════════════════
// EDIT MODAL
// ═══════════════════════════════════════════════════
/** @param {number} i */
export function openEditModal(i) {
  const row = state.data[i];
  const name = lang === 'zh' ? row.nameZh : row.nameEn;
  requiredValueControl('edit-location-name').value = `${row.icon} ${name}`;
  requiredValueControl('edit-location-index').value = String(i);
  requiredValueControl('edit-maps').value = row.maps.replace(/\+/g, ' ');
  requiredValueControl('edit-lat').value = row.lat || '';
  requiredValueControl('edit-lng').value = row.lng || '';
  ['edit-reason', 'edit-submitter'].forEach(id => { requiredValueControl(id).value = ''; });
  const st = row.status;
  const STATUS_OPTS = [
    { id: 'so-verified', val: 'Verified' },
    { id: 'so-review',   val: 'Needs Review' },
  ];
  let defaultSet = false;
  STATUS_OPTS.forEach(({ id, val }) => {
    const hide = val === st;
    const label = document.querySelector(`label[for="${id}"]`);
    if (!label) throw new Error(`Missing required label for #${id}`);
    /** @type {HTMLElement} */ (label).style.display = hide ? 'none' : '';
    requiredInput(id).checked = !hide && !defaultSet;
    if (!hide && !defaultSet) defaultSet = true;
  });
  resetFeedback('edit-feedback', 'edit-submit-btn', t('edit_submit'));
  requiredElement('edit-modal').classList.add('open');
}

export function closeEditModal() {
  requiredElement('edit-modal').classList.remove('open');
}

export async function submitEdit() {
  const idx = parseInt(requiredValueControl('edit-location-index').value);
  const row = state.data[idx];
  const editFb = requiredElement('edit-feedback');
  const checkedStatus = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="suggest-status"]:checked'));
  await doNetlifySubmit('edit-submit-btn', 'edit-feedback', t('edit_submit'), {
    'form-name': 'suggest-edit', 'bot-field': '',
    location_name: `${row.nameZh} / ${row.nameEn}`,
    location_index: String(idx),
    suggested_status: checkedStatus?.value || '',
    maps_query: requiredValueControl('edit-maps').value.trim(),
    lat: requiredValueControl('edit-lat').value.trim(),
    lng: requiredValueControl('edit-lng').value.trim(),
    notes_zh: '',
    notes_en: '',
    reason: requiredValueControl('edit-reason').value.trim(),
    submitter: requiredValueControl('edit-submitter').value.trim(),
  }, () => {
    editFb.className = 'submit-feedback ok'; editFb.textContent = t('submit_ok');
    setTimeout(() => document.getElementById('edit-modal')?.classList.remove('open'), 2200);
  });
}

// ═══════════════════════════════════════════════════
// ADD MODAL
// ═══════════════════════════════════════════════════
export function openAddModal() {
  ['add-name', 'add-maps', 'add-notes', 'add-source', 'add-submitter'].forEach(id =>
    requiredValueControl(id).value = '');
  requiredInput('ns-review').checked = true;
  requiredElement('add-modal').classList.remove('is-success');
  resetFeedback('add-feedback', 'add-submit-btn', t('add_submit'));
  requiredElement('add-modal').classList.add('open');
}

export function closeAddModal() {
  requiredElement('add-modal').classList.remove('open', 'is-success');
}

export function showAddSuccess() {
  requiredElement('add-modal').classList.add('is-success');
  resetFeedback('add-feedback', 'add-submit-btn', t('add_submit'));
}

/** @param {string} url @returns {boolean} */
export function isGoogleMapsUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host === 'maps.app.goo.gl' || host === 'maps.google.com') return true;
    if (host === 'goo.gl') return path.startsWith('/maps/');
    if (host === 'www.google.com') return path.startsWith('/maps');
    return false;
  } catch (e) { return false; }
}

/** @param {string} name @param {string} maps @returns {string} */
export function validateAddLocation(name, maps) {
  if (!maps) return 'err_maps_required';
  if (!isGoogleMapsUrl(maps)) return 'err_maps_invalid';
  return '';
}

/** @returns {Record<string,string>} */
export function buildAddLocationPayload() {
  const name = requiredValueControl('add-name').value.trim();
  const maps = requiredValueControl('add-maps').value.trim();
  const catSel = requiredSelect('add-cat');
  const catIdx = catSel.selectedIndex;
  const catObj = CATEGORIES[catIdx] || { zh: '', en: catSel.value };
  const notes = requiredValueControl('add-notes').value.trim();
  const checkedStatus = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="new-status"]:checked'));
  return {
    'form-name': 'add-location', 'bot-field': '',
    name_zh: lang === 'zh' ? name : '', name_en: lang === 'en' ? name : '',
    alt_name: '', icon: '',
    category_zh: catObj.zh, category_en: catObj.en,
    lat: '', lng: '',
    maps_query: maps,
    notes_zh: lang === 'zh' ? notes : '', notes_en: lang === 'en' ? notes : '',
    status: checkedStatus?.value || 'Needs Review',
    source_url: requiredValueControl('add-source').value.trim(),
    submitter: requiredValueControl('add-submitter').value.trim(),
  };
}

export async function submitAdd() {
  const name = requiredValueControl('add-name').value.trim();
  const maps = requiredValueControl('add-maps').value.trim();
  const fb = requiredElement('add-feedback');
  const errorKey = validateAddLocation(name, maps);
  if (errorKey) { fb.className = 'submit-feedback err'; fb.textContent = t(errorKey); return; }
  await doNetlifySubmit('add-submit-btn', 'add-feedback', t('add_submit'), buildAddLocationPayload(), showAddSuccess);
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
    fb.className = 'submit-feedback ok'; fb.textContent = t('submit_ok');
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
