/** Set up the native dialog so keyboard focus stays inside while it is open.
 * @param {Document} [documentRoot]
 */
export function initFanResources(documentRoot = document) {
  const dialogElement = /** @type {HTMLDialogElement|null} */ (documentRoot.getElementById('fan-resources-modal'));
  const closeElement = documentRoot.getElementById('fan-resources-close');
  if (!dialogElement || !closeElement) return null;
  const dialog = dialogElement;
  const closeButton = closeElement;

  const desktopTrigger = documentRoot.getElementById('fan-resources-btn');
  const mobileTrigger = documentRoot.querySelector('[data-mobile-action="fan-resources"]');
  const moreButton = documentRoot.getElementById('mobile-actions-btn');
  /** @type {HTMLElement|null} */
  let returnFocus = null;
  let startedOnBackdrop = false;

  /** @param {boolean} expanded */
  function setExpanded(expanded) {
    for (const trigger of [desktopTrigger, mobileTrigger]) {
      trigger?.setAttribute('aria-expanded', String(expanded));
    }
  }

  /** @param {HTMLElement|null} [trigger] */
  function open(trigger = desktopTrigger) {
    if (dialog.open) return;
    returnFocus = trigger;
    startedOnBackdrop = false;
    dialog.showModal();
    setExpanded(true);
    closeButton.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  /** @param {MouseEvent} event */
  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  }

  desktopTrigger?.addEventListener('click', () => open(desktopTrigger));
  closeButton.addEventListener('click', close);
  dialog.addEventListener('pointerdown', event => { startedOnBackdrop = isBackdrop(event); });
  dialog.addEventListener('click', event => {
    if (startedOnBackdrop && isBackdrop(event)) close();
    startedOnBackdrop = false;
  });
  // Native Escape dismissal also fires close, keeping focus/ARIA in sync.
  dialog.addEventListener('close', () => {
    setExpanded(false);
    const target = [returnFocus, desktopTrigger, moreButton].find(element =>
      element?.isConnected && element.getClientRects().length > 0
    );
    target?.focus();
    returnFocus = null;
  });

  return { open };
}
