import { lang, t, CATEGORIES } from './i18n.js';
import { state } from './state.js';
import { parseCSV } from './csv-parser.js';
import { doNetlifySubmit, resetFeedback, shouldMockNetlifySubmit } from './submit.js';

const LOCATIONS_API = '/api/locations';

// ═══════════════════════════════════════════════════
// EDIT MODAL
// ═══════════════════════════════════════════════════
export function openEditModal(i) {
  const row = state.data[i];
  const name = lang === 'zh' ? row.nameZh : row.nameEn;
  document.getElementById('edit-location-name').value = `${row.icon} ${name}`;
  document.getElementById('edit-location-index').value = i;
  document.getElementById('edit-maps').value = row.maps.replace(/\+/g, ' ');
  document.getElementById('edit-lat').value = row.lat || '';
  document.getElementById('edit-lng').value = row.lng || '';
  ['edit-reason', 'edit-submitter'].forEach(id => document.getElementById(id).value = '');
  const st = row.status;
  const STATUS_OPTS = [
    { id: 'so-verified', val: 'Verified' },
    { id: 'so-review',   val: 'Needs Review' },
  ];
  let defaultSet = false;
  STATUS_OPTS.forEach(({ id, val }) => {
    const hide = val === st;
    document.querySelector(`label[for="${id}"]`).style.display = hide ? 'none' : '';
    document.getElementById(id).checked = !hide && !defaultSet;
    if (!hide && !defaultSet) defaultSet = true;
  });
  resetFeedback('edit-feedback', 'edit-submit-btn', t('edit_submit'));
  document.getElementById('edit-modal').classList.add('open');
}

export function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
}

export async function submitEdit() {
  const idx = parseInt(document.getElementById('edit-location-index').value);
  const row = state.data[idx];
  const editFb = document.getElementById('edit-feedback');
  await doNetlifySubmit('edit-submit-btn', 'edit-feedback', t('edit_submit'), {
    'form-name': 'suggest-edit', 'bot-field': '',
    location_name: `${row.nameZh} / ${row.nameEn}`,
    location_index: idx,
    suggested_status: document.querySelector('input[name="suggest-status"]:checked')?.value || '',
    maps_query: document.getElementById('edit-maps').value.trim(),
    lat: document.getElementById('edit-lat').value.trim(),
    lng: document.getElementById('edit-lng').value.trim(),
    notes_zh: '',
    notes_en: '',
    reason: document.getElementById('edit-reason').value.trim(),
    submitter: document.getElementById('edit-submitter').value.trim(),
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
    document.getElementById(id).value = '');
  document.getElementById('ns-review').checked = true;
  document.getElementById('add-modal').classList.remove('is-success');
  resetFeedback('add-feedback', 'add-submit-btn', t('add_submit'));
  document.getElementById('add-modal').classList.add('open');
}

export function closeAddModal() {
  document.getElementById('add-modal').classList.remove('open', 'is-success');
}

export function showAddSuccess() {
  document.getElementById('add-modal').classList.add('is-success');
  resetFeedback('add-feedback', 'add-submit-btn', t('add_submit'));
}

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

export function validateAddLocation(name, maps) {
  if (!maps) return 'err_maps_required';
  if (!isGoogleMapsUrl(maps)) return 'err_maps_invalid';
  return '';
}

export function buildAddLocationPayload() {
  const name = document.getElementById('add-name').value.trim();
  const maps = document.getElementById('add-maps').value.trim();
  const catSel = document.getElementById('add-cat');
  const catIdx = catSel.selectedIndex;
  const catObj = CATEGORIES[catIdx] || { zh: '', en: catSel.value };
  const notes = document.getElementById('add-notes').value.trim();
  return {
    'form-name': 'add-location', 'bot-field': '',
    name_zh: lang === 'zh' ? name : '', name_en: lang === 'en' ? name : '',
    alt_name: '', icon: '',
    category_zh: catObj.zh, category_en: catObj.en,
    lat: '', lng: '',
    maps_query: maps,
    notes_zh: lang === 'zh' ? notes : '', notes_en: lang === 'en' ? notes : '',
    status: document.querySelector('input[name="new-status"]:checked')?.value || 'Needs Review',
    source_url: document.getElementById('add-source').value.trim(),
    submitter: document.getElementById('add-submitter').value.trim(),
  };
}

export async function submitAdd() {
  const name = document.getElementById('add-name').value.trim();
  const maps = document.getElementById('add-maps').value.trim();
  const fb = document.getElementById('add-feedback');
  const errorKey = validateAddLocation(name, maps);
  if (errorKey) { fb.className = 'submit-feedback err'; fb.textContent = t(errorKey); return; }
  await doNetlifySubmit('add-submit-btn', 'add-feedback', t('add_submit'), buildAddLocationPayload(), showAddSuccess);
}

// ═══════════════════════════════════════════════════
// ISSUE REPORT MODAL
// ═══════════════════════════════════════════════════
export function openIssueModal() {
  ['issue-message', 'issue-contact'].forEach(id => document.getElementById(id).value = '');
  resetFeedback('issue-feedback', 'issue-submit-btn', t('issue_submit'));
  document.getElementById('issue-modal').classList.add('open');
}

export function closeIssueModal() {
  document.getElementById('issue-modal').classList.remove('open');
}

export function validateIssueReport(message) {
  return message.trim() ? '' : 'err_issue_required';
}

export function buildIssueReportPayload() {
  return {
    'form-name': 'issue-report',
    'bot-field': '',
    message: document.getElementById('issue-message').value.trim(),
    page_url: location.href,
    contact: document.getElementById('issue-contact').value.trim(),
  };
}

export async function submitIssueReport() {
  const message = document.getElementById('issue-message').value;
  const fb = document.getElementById('issue-feedback');
  const errorKey = validateIssueReport(message);
  if (errorKey) { fb.className = 'submit-feedback err'; fb.textContent = t(errorKey); return; }

  await doNetlifySubmit('issue-submit-btn', 'issue-feedback', t('issue_submit'), buildIssueReportPayload(), () => {
    fb.className = 'submit-feedback ok'; fb.textContent = t('submit_ok');
    setTimeout(closeIssueModal, 2200);
  });
}


export async function tryLoadSheet(rebuild) {
  const bar = document.createElement('div'); bar.className = 'loading-bar'; document.body.appendChild(bar);
  try {
    const resp = await fetch(LOCATIONS_API); if (!resp.ok) throw new Error();
    const parsed = parseCSV(await resp.text());
    if (parsed && parsed.length) state.data = parsed;
  } catch (e) { console.warn('Sheet load failed', e); }
  state.isLoading = false; bar.remove(); rebuild();
}
