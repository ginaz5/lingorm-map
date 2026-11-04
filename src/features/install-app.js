// ═══════════════════════════════════════════════════
// INSTALL APP — home-screen install entry in the side menu
// ═══════════════════════════════════════════════════
// The site ships a web app manifest but no service worker, so it stays a plain
// web app on the same URL. Browsers still install it from their own menu
// (Chrome 108+ mobile / 112+ desktop, Safari "Add to Home Screen") and open it
// full-screen. Chrome's in-page install prompt (`beforeinstallprompt`) needs a
// service worker fetch handler, so the menu item uses that prompt only when a
// browser offers it and otherwise explains the browser's own install step.

import { t } from '../core/i18n.js';

/**
 * @param {Window} view
 * @returns {boolean} whether the app is already running from the home screen
 */
export function isStandaloneDisplay(view) {
  const nav = /** @type {Navigator & { standalone?: boolean }} */ (view.navigator);
  return !!view.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true;
}

/**
 * iPadOS reports a Mac platform, so also treat touch-capable Macs as iOS.
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} nav
 * @returns {boolean}
 */
export function isIosDevice(nav) {
  return /iPad|iPhone|iPod/.test(nav.userAgent ?? '') ||
    (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
}

/**
 * @typedef {Event & { prompt: () => Promise<void> }} InstallPromptEvent
 */

/**
 * @param {{ documentRoot?: Document, showHint: (message: string) => void, beforeOpen?: () => void }} options
 * @returns {{ button: HTMLElement }|null}
 */
export function initInstallApp({ documentRoot = document, showHint, beforeOpen }) {
  const buttonElement = documentRoot.getElementById('install-btn');
  const view = documentRoot.defaultView;
  if (!buttonElement || !view) return null;
  const button = buttonElement;
  if (isStandaloneDisplay(view)) {
    button.hidden = true;
    return { button };
  }
  button.hidden = false;

  /** @type {InstallPromptEvent|null} */
  let deferredPrompt = null;
  view.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = /** @type {InstallPromptEvent} */ (event);
  });
  view.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    button.hidden = true;
  });

  button.addEventListener('click', () => {
    beforeOpen?.();
    if (deferredPrompt) {
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      void promptEvent.prompt().catch(() => {});
      return;
    }
    showHint(t(isIosDevice(view.navigator) ? 'install_hint_ios' : 'install_hint_other'));
  });
  return { button };
}
