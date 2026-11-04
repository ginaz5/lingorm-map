// ═══════════════════════════════════════════════════
// SIDE MENU — app navigation drawer
// ═══════════════════════════════════════════════════
// The search bar's menu button opens a native modal <dialog> that holds the
// home reset, language, theme and secondary pages. A native dialog gives the
// focus trap, Escape handling and inert background for free.

/**
 * @typedef {Object} SideMenu
 * @property {() => void} open
 * @property {() => void} close
 * @property {(action: () => void) => void} closeThen
 *   close without restoring focus to the menu button, then run an action that
 *   moves focus elsewhere (another dialog or a page reset)
 */

/**
 * @param {{ documentRoot?: Document }} [options]
 * @returns {SideMenu|null}
 */
export function initSideMenu({ documentRoot = document } = {}) {
  const dialogElement = /** @type {HTMLDialogElement|null} */ (documentRoot.getElementById('side-menu'));
  const triggerElement = documentRoot.getElementById('menu-btn');
  if (!dialogElement || !triggerElement) return null;
  const dialog = dialogElement;
  const trigger = triggerElement;
  let restoreFocus = true;
  let startedOnBackdrop = false;

  function open() {
    if (dialog.open) return;
    restoreFocus = true;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  /** @param {() => void} action */
  function closeThen(action) {
    restoreFocus = false;
    close();
    action();
  }

  /** @param {MouseEvent} event */
  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  }

  trigger.addEventListener('click', open);
  documentRoot.getElementById('side-menu-close')?.addEventListener('click', close);
  dialog.addEventListener('pointerdown', event => { startedOnBackdrop = isBackdrop(event); });
  dialog.addEventListener('click', event => {
    if (startedOnBackdrop && isBackdrop(event)) close();
    startedOnBackdrop = false;
  });
  // Native Escape dismissal also fires close.
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
    restoreFocus = true;
  });

  return { open, close, closeThen };
}
