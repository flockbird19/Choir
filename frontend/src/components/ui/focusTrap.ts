/**
 * Belt-and-suspenders focus trap for a native <dialog> shown via showModal().
 * The browser is supposed to keep Tab cycling inside on its own, but Chromium
 * was observed (live-tested, not assumed) letting Tab fall through to
 * document.body when the dialog has very few focusable descendants — e.g. an
 * empty-state panel with just a close button. Call this from the dialog's own
 * onKeyDown rather than relying on the native trap alone.
 */
export function trapTabKey(dialog: HTMLElement, event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
