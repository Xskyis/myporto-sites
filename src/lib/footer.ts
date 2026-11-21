import { PROFILE } from '../data/profile';
import { getLenis } from './scroll/lenis';

/** Enhance footer actions while keeping native links usable without JavaScript. */
export function setupFooter(): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  const backToTop = document.getElementById('back-to-top-btn');

  backToTop?.addEventListener('click', (event) => {
    if (event instanceof MouseEvent && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    const target = document.getElementById('main-content');
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
    const lenis = getLenis();
    if (lenis) {
      lenis.scrollTo(0, { duration: 1.1 });
    } else {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    }
  }, { signal });

  const copyBtn = document.getElementById('copy-email-btn') as HTMLButtonElement | null;
  const copyText = document.getElementById('copy-text');
  const copyIcon = document.getElementById('copy-icon');
  const copyCheckIcon = document.getElementById('copy-check-icon');
  let resetTimer: number | undefined;

  const resetCopy = () => {
    window.clearTimeout(resetTimer);
    if (!copyBtn || !copyText) return;
    copyBtn.disabled = false;
    copyText.textContent = 'Copy email';
    copyIcon?.classList.remove('hidden');
    copyCheckIcon?.classList.add('hidden');
    copyBtn.classList.remove('border-[var(--status-dot)]', 'text-[var(--accent-text)]');
  };

  if (copyBtn && copyText && typeof navigator.clipboard?.writeText === 'function') {
    copyBtn.hidden = false;
    copyBtn.addEventListener('click', async () => {
      resetCopy();
      copyBtn.disabled = true;
      let succeeded = false;
      try {
        await navigator.clipboard.writeText(PROFILE.email);
        succeeded = true;
      } catch {
        // Clipboard permission can be denied even when the API is present.
      }
      // A pending browser permission prompt may outlive the outgoing page.
      if (signal.aborted || !copyBtn.isConnected) return;
      copyBtn.disabled = false;
      copyText.textContent = succeeded ? 'Copied to clipboard!' : 'Copy failed — use email link';
      if (succeeded) {
        copyIcon?.classList.add('hidden');
        copyCheckIcon?.classList.remove('hidden');
        copyBtn.classList.add('border-[var(--status-dot)]', 'text-[var(--accent-text)]');
      }
      resetTimer = window.setTimeout(resetCopy, succeeded ? 2500 : 4000);
    }, { signal });
  }

  return () => {
    abort.abort();
    resetCopy();
    if (copyBtn) copyBtn.hidden = true;
  };
}
