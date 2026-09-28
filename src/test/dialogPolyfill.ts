import { afterEach } from 'vitest';

/**
 * jsdom has no <dialog> behavior yet (showModal, close, Escape to cancel), so this
 * stands in for the parts our components use, close to how browsers behave:
 * - showModal() focuses the autofocus element, else the first focusable one;
 * - everything outside the top modal gets the `inert` attribute (jsdom doesn't act
 *   on it, but tests can check it);
 * - Escape sends a cancelable "cancel" to the top modal, which closes unless canceled;
 * - "close" fires from a queued task, not synchronously.
 * Real browsers are covered by the Playwright tests (e2e/ui-kit.spec.ts).
 */

const openModals: HTMLDialogElement[] = [];
/** Elements this stand-in made inert, so it only ever clears its own. */
const madeInert = new Set<Element>();

const focusableSelector = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Makes everything outside the top open modal inert, like browsers do. */
function updateInertness() {
  for (const element of madeInert) element.removeAttribute('inert');
  madeInert.clear();
  // Forget modals that were removed from the page while open.
  for (let index = openModals.length - 1; index >= 0; index -= 1) {
    if (!openModals[index]?.isConnected) openModals.splice(index, 1);
  }
  let node: Element | null = openModals.at(-1) ?? null;
  while (node && node !== document.body && node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '');
        madeInert.add(sibling);
      }
    }
    node = node.parentElement;
  }
}

export function installDialogPolyfill() {
  const dialogPrototype = HTMLDialogElement.prototype as Partial<HTMLDialogElement>;
  if (typeof dialogPrototype.showModal === 'function') return;

  dialogPrototype.show = function show(this: HTMLDialogElement) {
    this.open = true;
  };

  dialogPrototype.showModal = function showModal(this: HTMLDialogElement) {
    if (this.open) throw new DOMException('The dialog is already open.', 'InvalidStateError');
    if (!this.isConnected) {
      throw new DOMException('The dialog is not in a document.', 'InvalidStateError');
    }
    this.open = true;
    openModals.push(this);
    updateInertness();
    (
      this.querySelector<HTMLElement>('[autofocus]') ??
      this.querySelector<HTMLElement>(focusableSelector)
    )?.focus();
  };

  dialogPrototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    const index = openModals.indexOf(this);
    if (index !== -1) openModals.splice(index, 1);
    updateInertness();
    setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  };

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = openModals.filter((dialog) => dialog.isConnected && dialog.open).at(-1);
    if (top?.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
  });

  // Each test starts with no modal open and nothing inert.
  afterEach(() => {
    openModals.length = 0;
    updateInertness();
  });
}
