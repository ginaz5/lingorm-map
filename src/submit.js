import { t } from './i18n.js';

/** @param {string} id @returns {HTMLElement} */
function requiredElement(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el;
}

/** @param {string} id @returns {HTMLButtonElement} */
function requiredButton(id) {
  return /** @type {HTMLButtonElement} */ (requiredElement(id));
}

// ═══════════════════════════════════════════════════
// NETLIFY FORM SUBMIT
// ═══════════════════════════════════════════════════
export function shouldMockNetlifySubmit() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

/**
 * @param {string} btnId
 * @param {string} fbId
 * @param {string} btnLabel
 * @param {Record<string,string>} payload
 * @param {(feedback: HTMLElement) => void} onSuccess
 * @returns {Promise<void>}
 */
export async function doNetlifySubmit(btnId, fbId, btnLabel, payload, onSuccess) {
  const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById(btnId));
  const fb = document.getElementById(fbId);
  if (!btn) throw new Error(`Missing required element #${btnId}`);
  if (!fb) throw new Error(`Missing required element #${fbId}`);
  btn.disabled = true; btn.textContent = t('submitting');
  fb.className = 'submit-feedback'; fb.textContent = '';
  if (shouldMockNetlifySubmit()) {
    console.info('[local Netlify Forms mock]', payload['form-name'], payload);
    recordPending();
    onSuccess(fb);
    return;
  }
  try {
    const resp = await fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(payload).toString(),
    });
    if (resp.ok) {
      recordPending();
      onSuccess(fb);
    } else { throw new Error(String(resp.status)); }
  } catch (e) {
    fb.className = 'submit-feedback err'; fb.textContent = t('submit_err');
    btn.disabled = false; btn.textContent = btnLabel;
  }
}

/** @param {string} fbId @param {string} btnId @param {string} btnLabel */
export function resetFeedback(fbId, btnId, btnLabel) {
  const fb = requiredElement(fbId);
  fb.className = 'submit-feedback'; fb.textContent = '';
  const btn = requiredButton(btnId);
  btn.disabled = false; btn.textContent = btnLabel;
}

// ═══════════════════════════════════════════════════
// PENDING BANNER
// ═══════════════════════════════════════════════════
export function recordPending() {
  localStorage.setItem('has_pending', '1');
  showPendingBanner();
}

export function showPendingBanner() {
  if (localStorage.getItem('has_pending') === '1')
    requiredElement('pending-banner').classList.add('is-visible');
}
