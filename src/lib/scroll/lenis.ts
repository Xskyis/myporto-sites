import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  LENIS_EASE,
  LENIS_LERP,
  WHEEL_MULTIPLIER,
  compensateLenisOffset,
  durationForDistance,
  headerOffsetFromVar,
  shouldUseLenis,
} from './scroll-math';
import { scrollLock, wireScrollLock } from './scroll-lock';

gsap.registerPlugin(ScrollTrigger);

ScrollTrigger.config({
  ignoreMobileResize: true,
});

let lenisInstance: Lenis | null = null;
let cleanupLenis: (() => void) | null = null;
let reducedMotionQuery: MediaQueryList | null = null;
let splashWatchdog: number | null = null;
let navigationScope: AbortController | null = null;

function cancelNavigationScroll() {
  navigationScope?.abort();
  navigationScope = null;
}

function navigationSignal(): AbortSignal {
  navigationScope ??= new AbortController();
  return navigationScope.signal;
}

/**
 * Scroll offset so anchored sections land just below the fixed header.
 * Reads `--header-height` (defined in global.css, fallback 80px).
 */
function headerOffset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
  return headerOffsetFromVar(raw);
}

function offsetForTarget(target: HTMLElement, explicitOffset?: number): number {
  if (explicitOffset !== undefined) return explicitOffset;
  // Full-bleed page sections already carry header-clearance top padding.
  if (target.hasAttribute('data-nav-section')) return 0;
  return headerOffset();
}

function lenisOffsetForTarget(target: HTMLElement, desiredOffset: number): number {
  const rootPadding = Number.parseFloat(
    getComputedStyle(document.documentElement).scrollPaddingTop,
  );
  const targetMargin = Number.parseFloat(getComputedStyle(target).scrollMarginTop);
  return compensateLenisOffset(desiredOffset, rootPadding, targetMargin);
}

export function initLenis(): Lenis | null {
  if (typeof window === 'undefined') return null;

  if (!reducedMotionQuery) {
    reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    // This observer belongs to the persistent scroll service, not an individual page.
    // Re-enable smooth scrolling on the next page setup, when consumers can subscribe
    // to the new instance. The current page keeps working with native scrolling.
    reducedMotionQuery.addEventListener('change', () => {
      if (reducedMotionQuery?.matches) cleanupLenis?.();
    });
  }
  const prefersReduced = reducedMotionQuery.matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  // Remaster: never hijack scroll for reduced-motion users (no rAF cost),
  // and keep native momentum on coarse-only devices (phones/tablets).
  // Hybrid devices (fine + coarse) still get Lenis.
  if (!shouldUseLenis({ fine, coarse, reducedMotion: prefersReduced })) {
    cleanupLenis?.();
    return null;
  }

  if (lenisInstance) {
    return lenisInstance;
  }

  const lenis = new Lenis({
    // Remaster: lerp mode for wheel (frame-rate independent, tighter feel).
    // NOTE: duration + easing would take precedence over lerp inside Lenis'
    // Animate, so the instance intentionally omits them. Programmatic
    // scrolls pass duration+easing explicitly per call (see scrollToTarget).
    lerp: LENIS_LERP,
    smoothWheel: true,
    // Native touch on hybrid devices: never smooth touch gestures.
    syncTouch: false,
    wheelMultiplier: WHEEL_MULTIPLIER,
    // Kill wheel inertia the moment a link to another page is clicked, so a glide that is
    // still running can't carry over into the next page (see installNavigationScroll).
    stopInertiaOnNavigate: true,
  });

  lenisInstance = lenis;
  const scope = new AbortController();
  const { signal } = scope;
  wireScrollLock(
    () => lenisInstance?.stop(),
    () => lenisInstance?.start(),
  );

  // Synchronize Lenis scroll position with GSAP ScrollTrigger
  const offScroll = lenis.on('scroll', ScrollTrigger.update);

  // Hook Lenis into GSAP requestAnimationFrame ticker
  const tickerCallback = (time: number) => {
    if (!signal.aborted) lenis.raf(time * 1000);
  };

  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  cleanupLenis = () => {
    scope.abort();
    gsap.ticker.remove(tickerCallback);
    offScroll();
    if (splashWatchdog !== null) window.clearTimeout(splashWatchdog);
    splashWatchdog = null;
    lenis.destroy();
    lenisInstance = null;
    cleanupLenis = null;
  };

  // Refresh ScrollTrigger after fonts and layout settle
  const onWindowLoad = () => ScrollTrigger.refresh();
  window.addEventListener('load', onWindowLoad, { once: true, signal });

  const isSplashActive = () =>
    !document.documentElement.classList.contains('no-splash') &&
    !!document.getElementById('splash-screen');

  if (scrollLock.isLocked() || isSplashActive()) lenis.stop();

  if (isSplashActive()) {
    // Watchdog: if the splash script never exits (failed/blocked), never
    // leave the user permanently stuck with a stopped Lenis.
    if (splashWatchdog !== null) window.clearTimeout(splashWatchdog);
    splashWatchdog = window.setTimeout(() => {
      if (isSplashActive() && !scrollLock.isLocked()) lenis.start();
      splashWatchdog = null;
    }, 6000);
    // Release the watchdog once the splash announces itself.
    window.addEventListener(
      'splash:hero-reveal',
      () => {
        if (splashWatchdog !== null) window.clearTimeout(splashWatchdog);
        splashWatchdog = null;
      },
      { once: true, signal },
    );
  }

  return lenis;
}

export function getLenis(): Lenis | null {
  return lenisInstance;
}

/* -------------------------------------------------------------------------- */
/*  Navigation ↔ scroll synchronisation                                       */
/*                                                                            */
/*  Astro's ClientRouter already handles the raw scroll position on swap:     */
/*    - push/replace without hash → scrollTo(0, 0)                            */
/*    - push/replace with hash    → native jump to the anchor                 */
/*    - traverse (back/forward)   → restores the saved scrollX/scrollY        */
/*  What it can't know about is Lenis (whose internal target must be synced)  */
/*  and the fixed header offset, so this layer adds only those two things,    */
/*  exactly once per navigation.                                              */
/* -------------------------------------------------------------------------- */

type NavigationKind = 'initial' | 'push' | 'replace' | 'traverse';

let navigationScrollInstalled = false;

export function installNavigationScroll() {
  if (typeof window === 'undefined' || navigationScrollInstalled) return;
  navigationScrollInstalled = true;

  let kind: NavigationKind = 'initial';
  const scope = new AbortController();
  const { signal } = scope;

  document.addEventListener('astro:before-preparation', (e) => {
    cancelNavigationScroll();
    const type = (e as { navigationType?: string }).navigationType;
    kind = type === 'traverse' || type === 'replace' ? type : 'push';
  }, { signal });

  document.addEventListener('astro:before-swap', cancelNavigationScroll, { signal });

  // Fires before the new page paints. Astro has already placed the window (top, restored
  // position, or a pending fragment jump); the only job here is to kill any in-flight Lenis
  // animation from the previous page and align its internal position with the window, so a
  // stale smooth-scroll can never "resume" and drag the new page around.
  document.addEventListener('astro:after-swap', () => {
    // Centralised lock reset — a lock from the previous page (splash, menu,
    // dialog) must never survive navigation. This is the single escape hatch
    // that lets every owner skip its own swap cleanup.
    scrollLock.reset();

    const lenis = lenisInstance;
    if (!lenis) return;
    // stop()/start() is the public way to force Lenis' internal reset(): it aborts the running
    // wheel-inertia animation and snaps animatedScroll/targetScroll to the real window position.
    // (scrollTo(window.scrollY) is NOT enough: it returns early, without resetting, whenever the
    // target already equals targetScroll, which is exactly the state after resize().)
    lenis.stop();
    lenis.start();
    lenis.resize();
  }, { signal });

  // Fires after scripts ran (so `no-splash` etc. are accurate again). Handles the one thing the
  // browser can't: landing the anchored section below the fixed header.
  document.addEventListener('astro:page-load', () => {
    cancelNavigationScroll();
    const pageSignal = navigationSignal();
    const currentKind = kind;
    kind = 'push'; // anything after the first page-load that isn't announced is a push

    if (currentKind === 'traverse') return;

    const target = getHashTarget();
    if (!target) return;

    const isSplashActive =
      !document.documentElement.classList.contains('no-splash') &&
      !!document.getElementById('splash-screen');
    if (isSplashActive) return; // splash pins the page to the top until it exits

    if (currentKind === 'initial') {
      // Chromium re-applies the fragment scroll on every layout change until `load`
      // (web fonts shift heading heights), so wait for both before correcting.
      const loaded =
        document.readyState === 'complete'
          ? Promise.resolve()
          : new Promise<void>((resolve) => window.addEventListener('load', () => resolve(), { once: true, signal: pageSignal }));
      const fonts = document.fonts?.ready ?? Promise.resolve();
      Promise.all([loaded, fonts]).then(() => applyHeaderOffset(target, pageSignal));
    } else {
      applyHeaderOffset(target, pageSignal);
    }
  }, { signal });

  return () => {
    if (signal.aborted) return;
    scope.abort();
    cancelNavigationScroll();
    navigationScrollInstalled = false;
  };
}

function getHashTarget(): HTMLElement | null {
  const hash = window.location.hash;
  if (!hash || hash === '#') return null;
  try {
    return document.querySelector<HTMLElement>(hash);
  } catch {
    return null;
  }
}

/** Re-land the anchored element just below the fixed header after layout settles. */
function applyHeaderOffset(target: HTMLElement, signal: AbortSignal) {
  if (signal.aborted || !target.isConnected) return;
  const cancelFrame = () => cancelAnimationFrame(frame);
  const frame = requestAnimationFrame(() => {
    signal.removeEventListener('abort', cancelFrame);
    if (signal.aborted || !target.isConnected) return;
    const desiredOffset = offsetForTarget(target);
    if (lenisInstance && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      lenisInstance.scrollTo(target, {
        offset: lenisOffsetForTarget(target, desiredOffset),
        immediate: true,
        force: true,
      });
    } else {
      const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY + desiredOffset);
      window.scrollTo({
        top,
        left: 0,
        behavior: 'instant',
      });
    }
  });
  signal.addEventListener('abort', cancelFrame, { once: true });
}

export function scrollToTarget(
  target: string | HTMLElement,
  options?: {
    offset?: number;
    duration?: number;
    updateHash?: boolean;
    onComplete?: () => void;
  }
) {
  if (typeof window === 'undefined') return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targetEl = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!targetEl?.isConnected) return;
  const signal = navigationSignal();

  const targetSelector = typeof target === 'string' ? target : `#${targetEl.id}`;
  const desiredOffset = offsetForTarget(targetEl, options?.offset);
  const currentY = window.scrollY;
  const targetY = Math.max(0, targetEl.getBoundingClientRect().top + currentY + desiredOffset);
  const distance = Math.abs(targetY - currentY);
  const duration = prefersReduced
    ? 0.01
    : (options?.duration ?? durationForDistance(distance));

  // Update URL hash without causing an instant browser jump. Keep the existing state object:
  // Astro's ClientRouter stores { index, scrollX, scrollY } there for back/forward restoration.
  if (options?.updateHash !== false && targetSelector.startsWith('#')) {
    history.replaceState(history.state, '', targetSelector);
  }

  if (lenisInstance && !prefersReduced) {
    lenisInstance.scrollTo(targetEl, {
      offset: lenisOffsetForTarget(targetEl, desiredOffset),
      duration,
      easing: LENIS_EASE,
      onComplete: () => {
        if (!signal.aborted && targetEl.isConnected) options?.onComplete?.();
      },
    });
  } else {
    // No Lenis (reduced motion / coarse pointer / init skipped): apply the
    // header offset with the same rect+scrollY math as applyHeaderOffset.
    // (offsetTop is relative to offsetParent — wrong when the parent is positioned.)
    window.scrollTo({ top: targetY, left: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
    const cancelCompletion = () => window.clearTimeout(timer);
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', cancelCompletion);
      if (!signal.aborted && targetEl.isConnected) options?.onComplete?.();
    }, prefersReduced ? 50 : 600);
    signal.addEventListener('abort', cancelCompletion, { once: true });
  }
}
