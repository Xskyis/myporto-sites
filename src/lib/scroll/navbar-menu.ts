import { gsap } from 'gsap';
import { scrollLock } from './scroll-lock';

interface MobileMenuOptions {
  menu: HTMLElement;
  button: HTMLElement;
  signal: AbortSignal;
  onStateChange: () => void;
}

interface CloseOptions {
  immediate?: boolean;
  restoreFocus?: boolean;
  onComplete?: () => void;
}

/** Move the keyboard reading position without interrupting the owned smooth scroll. */
export function focusNavigationTarget(target: HTMLElement, signal: AbortSignal) {
  if (signal.aborted || !target.isConnected) return;
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
    const restore = () => {
      target.removeAttribute('tabindex');
      target.removeEventListener('blur', restore);
      signal.removeEventListener('abort', restore);
    };
    target.addEventListener('blur', restore, { once: true });
    signal.addEventListener('abort', restore, { once: true });
  }
  target.focus({ preventScroll: true });
}

/** Own the menu animation and its lock for exactly one Astro page lifecycle. */
export function setupMobileMenu({ menu, button, signal, onStateChange }: MobileMenuOptions) {
  const desktop = window.matchMedia('(min-width: 768px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const openIcon = button.querySelector('.menu-icon-open');
  const closeIcon = button.querySelector('.menu-icon-close');
  let revision = 0;
  let closing = false;

  const focusables = () => Array.from(menu.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
  ));

  const resetClosedState = () => {
    menu.classList.add('hidden');
    menu.classList.remove('flex');
    menu.style.removeProperty('opacity');
    menu.style.removeProperty('transform');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Open Navigation Menu');
    menu.setAttribute('aria-hidden', 'true');
    openIcon?.classList.remove('hidden');
    closeIcon?.classList.add('hidden');
    closing = false;
    scrollLock.release('mobile-menu');
    onStateChange();
  };

  const close = ({ immediate = false, restoreFocus = true, onComplete }: CloseOptions = {}) => {
    if (signal.aborted) return;
    const wasOpen = !menu.classList.contains('hidden');
    const currentRevision = ++revision;
    gsap.killTweensOf(menu);
    closing = true;
    const finish = () => {
      if (signal.aborted || currentRevision !== revision) return;
      resetClosedState();
      // At the desktop breakpoint the mobile toggle is display:none.
      if (wasOpen && restoreFocus && !desktop.matches) button.focus({ preventScroll: true });
      onComplete?.();
    };
    if (immediate || reduced.matches || !wasOpen) {
      finish();
    } else {
      gsap.to(menu, { opacity: 0, y: -6, duration: 0.18, ease: 'power2.in', onComplete: finish });
    }
  };

  const open = () => {
    if (signal.aborted || desktop.matches) return;
    ++revision;
    closing = false;
    gsap.killTweensOf(menu);
    menu.classList.remove('hidden');
    menu.classList.add('flex');
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-label', 'Close Navigation Menu');
    menu.setAttribute('aria-hidden', 'false');
    openIcon?.classList.add('hidden');
    closeIcon?.classList.remove('hidden');
    scrollLock.acquire('mobile-menu');
    onStateChange();
    if (reduced.matches) {
      gsap.set(menu, { opacity: 1, y: 0 });
    } else {
      gsap.fromTo(menu, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out' });
    }
    focusables()[0]?.focus({ preventScroll: true });
  };

  button.addEventListener('click', () => {
    if (menu.classList.contains('hidden') || closing) open();
    else close();
  }, { signal });

  document.addEventListener('keydown', (event) => {
    if (menu.classList.contains('hidden')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !menu.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !menu.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }, { signal });

  desktop.addEventListener('change', () => {
    if (!desktop.matches) return;
    const focusedLink = document.activeElement instanceof HTMLElement && menu.contains(document.activeElement)
      ? document.activeElement.closest<HTMLElement>('.mobile-nav-link')
      : null;
    const section = focusedLink?.dataset.section;
    const desktopLink = section
      ? Array.from(document.querySelectorAll<HTMLElement>('.nav-link')).find((link) => link.dataset.section === section) ?? null
      : null;
    close({
      immediate: true,
      restoreFocus: false,
      onComplete: () => desktopLink?.focus({ preventScroll: true }),
    });
  }, { signal });

  reduced.addEventListener('change', () => {
    if (!reduced.matches || signal.aborted || menu.classList.contains('hidden')) return;
    if (closing) {
      close();
      return;
    }
    // A newly requested reduced-motion preference must stop the in-flight open tween
    // and leave the visible menu in its final state while preserving its scroll lock.
    ++revision;
    gsap.killTweensOf(menu);
    gsap.set(menu, { opacity: 1, y: 0 });
  }, { signal });

  signal.addEventListener('abort', () => {
    ++revision;
    gsap.killTweensOf(menu);
    resetClosedState();
  }, { once: true });

  return { close };
}
