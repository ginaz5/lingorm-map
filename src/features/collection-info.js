/** @param {Document} documentRoot @param {string} id @returns {HTMLElement} */
function requiredElement(documentRoot, id) {
  const element = documentRoot.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
}

/** @param {Document} [documentRoot] */
export function initCollectionInfo(documentRoot = document) {
  const parent = requiredElement(documentRoot, 'type-info-popover').parentElement;
  if (!parent) throw new Error('Missing collection info wrapper');
  const wrapper = parent;

  const trigger = requiredElement(documentRoot, 'type-info-btn');
  const popover = requiredElement(documentRoot, 'type-info-popover');
  const closeButton = requiredElement(documentRoot, 'type-info-close');
  const canHover = documentRoot.defaultView?.matchMedia?.('(hover: hover)').matches ?? false;
  let pinned = false;
  let suppressFocusOpen = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let closeTimer = null;

  /** @param {boolean} open */
  function setOpen(open) {
    popover.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  }

  function clearCloseTimer() {
    if (closeTimer === null) return;
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  function close() {
    pinned = false;
    clearCloseTimer();
    setOpen(false);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (pinned || wrapper.matches(':hover') || wrapper.contains(documentRoot.activeElement)) return;
      setOpen(false);
    }, 160);
  }

  function schedulePointerClose() {
    if (!canHover) {
      scheduleClose();
      return;
    }
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = null;
      if (wrapper.matches(':hover')) return;
      pinned = false;
      setOpen(false);
    }, 160);
  }

  trigger.addEventListener('pointerenter', () => {
    clearCloseTimer();
    setOpen(true);
  });
  wrapper.addEventListener('pointerleave', schedulePointerClose);
  wrapper.addEventListener('pointerenter', clearCloseTimer);

  trigger.addEventListener('focus', () => {
    if (!suppressFocusOpen) setOpen(true);
  });
  wrapper.addEventListener('focusout', scheduleClose);

  trigger.addEventListener('click', () => {
    if (canHover) {
      setOpen(popover.hidden !== false);
      return;
    }
    if (pinned) {
      close();
      return;
    }
    pinned = true;
    setOpen(true);
  });

  closeButton.addEventListener('click', () => {
    close();
    suppressFocusOpen = true;
    trigger.focus();
    queueMicrotask(() => { suppressFocusOpen = false; });
  });

  documentRoot.addEventListener('click', event => {
    if (!wrapper.contains(/** @type {Node|null} */ (event.target))) close();
  });
  documentRoot.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || popover.hidden) return;
    close();
    suppressFocusOpen = true;
    trigger.focus();
    queueMicrotask(() => { suppressFocusOpen = false; });
  });
}
