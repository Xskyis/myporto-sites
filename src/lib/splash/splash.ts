import { gsap } from 'gsap';
import { getLenis } from '../scroll/lenis';
import { scrollLock } from '../scroll/scroll-lock';

// The component boots directly and on page-load. A fresh swapped element gets a fresh scope,
// while repeated initialisation of the same element must not replay the intro.
let bootedEl: HTMLElement | null = null;
let cleanupSplash: (() => void) | null = null;

export function initSplashScreen() {
  if (typeof window === 'undefined') return;

  const splashEl = document.getElementById('splash-screen');
  if (!splashEl || splashEl === bootedEl) return;
  cleanupSplash?.();
  bootedEl = splashEl;

  const header = document.getElementById('main-header');
  const mainContent = document.getElementById('main-content');
  const isHome = ['/', '', '/index.html'].includes(window.location.pathname);
  const forceSplash = new URLSearchParams(window.location.search).get('splash') === '1';
  let splashShown = false;
  try {
    splashShown = sessionStorage.getItem('splash_shown') === 'true';
  } catch {
    // Graceful fallback for restricted storage environments.
  }

  // ClientRouter stamps no-splash onto incoming pages before they paint. Honour that state
  // even when this session first entered on a detail page and never played the home intro.
  if (!isHome || (splashShown && !forceSplash) || document.documentElement.classList.contains('no-splash')) {
    document.documentElement.classList.add('no-splash');
    splashEl.style.display = 'none';
    if (header) {
      header.style.opacity = '1';
      header.style.pointerEvents = 'auto';
    }
    return;
  }

  const scope = new AbortController();
  const { signal } = scope;
  const timers = new Set<number>();
  const animations: gsap.core.Animation[] = [];
  let ownsScrollLock = false;
  const later = (callback: () => void, ms: number) => {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      if (!signal.aborted) callback();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const releaseScrollLock = () => {
    if (!ownsScrollLock) return;
    ownsScrollLock = false;
    scrollLock.release('splash');
  };
  const cleanup = () => {
    if (signal.aborted) return;
    scope.abort();
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    animations.forEach((animation) => animation.kill());
    releaseScrollLock();
    if (cleanupSplash === cleanup) cleanupSplash = null;
  };
  cleanupSplash = cleanup;
  document.addEventListener('astro:before-swap', cleanup, { once: true, signal });

  // Lock scroll and reset to top. Only this scope may release its splash lock.
  (window as unknown as { __heroRevealed?: boolean }).__heroRevealed = false;
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  scrollLock.acquire('splash');
  ownsScrollLock = true;
  getLenis()?.scrollTo(0, { immediate: true });

  // Keep focus inside the visible splash; swap cleanup never moves focus on the next page.
  splashEl.setAttribute('tabindex', '-1');
  splashEl.focus({ preventScroll: true });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    splashEl.focus({ preventScroll: true });
  }, { capture: true, signal });

  const chars = splashEl.querySelectorAll<HTMLElement>('.splash-char');
  const counterEl = splashEl.querySelector<HTMLElement>('#splash-counter');
  const progressBarEl = splashEl.querySelector<HTMLElement>('#splash-progress-bar');
  let heroRevealed = false;
  const revealHero = () => {
    if (signal.aborted || heroRevealed) return;
    heroRevealed = true;
    (window as unknown as { __heroRevealed?: boolean }).__heroRevealed = true;
    window.dispatchEvent(new CustomEvent('splash:hero-reveal'));
  };
  const finish = () => {
    if (signal.aborted) return;
    try {
      sessionStorage.setItem('splash_shown', 'true');
    } catch {}
    document.documentElement.classList.add('no-splash');
    splashEl.style.display = 'none';
    cleanup();
    mainContent?.focus({ preventScroll: true });
  };

  // Reduced motion keeps the existing quick fade and announces the hero on completion.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    chars.forEach((char) => { char.style.transform = 'translateY(0%)'; });
    if (counterEl) counterEl.textContent = '100';
    if (progressBarEl) progressBarEl.style.transform = 'scaleX(1)';
    animations.push(gsap.to(splashEl, {
      opacity: 0,
      duration: 0.3,
      delay: 0.15,
      ease: 'none',
      onComplete: () => {
        if (signal.aborted) return;
        revealHero();
        if (header) {
          header.style.opacity = '1';
          header.style.pointerEvents = 'auto';
        }
        finish();
      },
    }));
    return;
  }

  animations.push(gsap.to(chars, {
    y: '0%', duration: 0.85, stagger: 0.045, ease: 'expo.out', delay: 0.15,
  }));

  let hasExited = false;
  const updateProgressUI = (val: number) => {
    if (signal.aborted || hasExited) return;
    const clamped = Math.min(100, Math.max(0, Math.floor(val)));
    if (counterEl) counterEl.textContent = String(clamped).padStart(3, '0');
    if (progressBarEl) progressBarEl.style.transform = `scaleX(${clamped / 100})`;
  };
  const executeCurtainExit = () => {
    if (signal.aborted || hasExited) return;
    hasExited = true;
    // Loading can still be pending after the safety timeout. Stop its progress tweens now;
    // the promise continuation below also checks hasExited before allocating another one.
    animations.forEach((animation) => animation.kill());
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();

    const exitTl = gsap.timeline({ onComplete: finish });
    animations.push(exitTl);
    const wordmark = splashEl.querySelector<HTMLElement>('#splash-wordmark');
    if (wordmark) {
      exitTl.to(wordmark, { scale: 1.04, opacity: 0.95, duration: 0.32, ease: 'power2.out' }, 0);
    }
    const elementsToFade = splashEl.querySelectorAll<HTMLElement>('#splash-bottom, #splash-progress-track, #splash-top');
    if (elementsToFade.length > 0) {
      exitTl.to(elementsToFade, { opacity: 0, duration: 0.22, ease: 'power2.out' }, 0.05);
    }
    exitTl.to(splashEl, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.9, ease: 'power4.inOut' }, 0.18);
    // Preserve the deferred portrait handoff during the curtain reveal.
    exitTl.add(revealHero, 0.38);
    if (header) {
      exitTl.to(header, {
        opacity: 1,
        duration: 0.75,
        ease: 'power2.out',
        onStart: () => { if (!signal.aborted) header.style.pointerEvents = 'auto'; },
      }, 0.82);
    }
  };

  const progressObj = { val: 0 };
  const phase1Tween = gsap.to(progressObj, {
    val: 52,
    duration: 0.8,
    ease: 'power1.out',
    onUpdate: () => updateProgressUI(progressObj.val),
  });
  animations.push(phase1Tween);
  const fontsPromise = document.fonts?.ready ?? Promise.resolve();
  const windowPromise = document.readyState === 'complete'
    ? Promise.resolve()
    : new Promise<void>((resolve) => window.addEventListener('load', () => resolve(), { once: true, signal }));
  const minTimePromise = new Promise<void>((resolve) => later(resolve, 1100));

  Promise.all([fontsPromise, windowPromise, minTimePromise]).then(() => {
    if (signal.aborted || hasExited) return;
    phase1Tween.kill();
    animations.push(gsap.to(progressObj, {
      val: 100,
      duration: 0.65,
      ease: 'power2.out',
      onUpdate: () => updateProgressUI(progressObj.val),
      onComplete: () => {
        if (signal.aborted || hasExited) return;
        updateProgressUI(100);
        later(executeCurtainExit, 120);
      },
    }));
  });

  // A slow font or window load cannot keep the splash up indefinitely.
  later(() => {
    updateProgressUI(100);
    executeCurtainExit();
  }, 3800);
}
