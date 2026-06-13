import { t } from './i18n.js';

// ═══════════════════════════════════════════════════
// NETLIFY FORM SUBMIT
// ═══════════════════════════════════════════════════
export function shouldMockNetlifySubmit() {
  return ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
}

export async function doNetlifySubmit(btnId, fbId, btnLabel, payload, onSuccess) {
  const btn = document.getElementById(btnId);
  const fb = document.getElementById(fbId);
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
    } else { throw new Error(resp.status); }
  } catch (e) {
    fb.className = 'submit-feedback err'; fb.textContent = t('submit_err');
    btn.disabled = false; btn.textContent = btnLabel;
  }
}

export function resetFeedback(fbId, btnId, btnLabel) {
  const fb = document.getElementById(fbId);
  fb.className = 'submit-feedback'; fb.textContent = '';
  const btn = document.getElementById(btnId);
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
    document.getElementById('pending-banner').classList.add('is-visible');
}
