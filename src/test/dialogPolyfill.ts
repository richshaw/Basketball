/**
 * jsdom has no <dialog> behavior yet (showModal, close, Escape to cancel), so this
 * stands in for the parts our components use. Real browsers are covered by the
 * Playwright tests (e2e/ui-kit.spec.ts).
 */

const openModals: HTMLDialogElement[] = [];

const focusableSelector = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

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
    // Like browsers: focus the element marked autofocus, else the first focusable one.
    (
      this.querySelector<HTMLElement>('[autofocus]') ??
      this.querySelector<HTMLElement>(focusableSelector)
    )?.focus();
  };

  dialogPrototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    openModals.splice(openModals.indexOf(this), 1);
    this.dispatchEvent(new Event('close'));
  };

  // Escape sends a cancelable "cancel" event to the top modal, which closes unless canceled.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = openModals.filter((dialog) => dialog.isConnected && dialog.open).at(-1);
    if (top?.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
  });
}
