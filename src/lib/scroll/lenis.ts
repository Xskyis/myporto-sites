import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  LENIS_EASE,
  LENIS_LERP,
  WHEEL_MULTIPLIER,
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
let splashWatchdog: number | null = null;

/**
 * Scroll offset so anchored sections land just below the fixed header.
 * Reads `--header-height` (defined in global.css, fallback 80px).
 */
function headerOffset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
  return headerOffsetFromVar(raw);
}

export function initLenis(): Lenis | null {
  if (typeof window === 'undefined') return null;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  // Remaster: never hijack scroll for reduced-motion users (no rAF cost),
  // and keep native momentum on coarse-only devices (phones/tablets).
  // Hybrid devices (fine + coarse) still get Lenis.
  if (!shouldUseLenis({ fine, coarse, reducedMotion: prefersReduced })) {
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
  wireScrollLock(
    () => lenis.stop(),
    () => lenis.start(),
  );

  // Synchronize Lenis scroll position with GSAP ScrollTrigger
  lenis.on('scroll', ScrollTrigger.update);

  // Hook Lenis into GSAP requestAnimationFrame ticker
  const tickerCallback = (time: number) => {
    lenis.raf(time * 1000);
  };

  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  // Refresh ScrollTrigger after fonts and layout settle
  const onWindowLoad = () => ScrollTrigger.refresh();
  window.addEventListener('load', onWindowLoad);

  const isSplashActive = () =>
    !document.documentElement.classList.contains('no-splash') &&
    !!document.getElementById('splash-screen');

  if (isSplashActive()) {
    lenis.stop();
    // Watchdog: if the splash script never exits (failed/blocked), never
    // leave the user permanently stuck with a stopped Lenis.
    if (splashWatchdog !== null) window.clearTimeout(splashWatchdog);
    splashWatchdog = window.setTimeout(() => {
      if (isSplashActive()) lenis.start();
      splashWatchdog = null;
    }, 6000);
    // Release the watchdog once the splash announces itself.
    window.addEventListener(
      'splash:hero-reveal',
      () => {
        if (splashWatchdog !== null) window.clearTimeout(splashWatchdog);
        splashWatchdog = null;
      },
      { once: true },
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

  document.addEventListener('astro:before-preparation', (e) => {
    const type = (e as { navigationType?: string }).navigationType;
    kind = type === 'traverse' || type === 'replace' ? type : 'push';
  });

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
  });

  // Fires after scripts ran (so `no-splash` etc. are accurate again). Handles the one thing the
  // browser can't: landing the anchored section below the fixed header.
  document.addEventListener('astro:page-load', () => {
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
          : new Promise<void>((resolve) => window.addEventListener('load', () => resolve(), { once: true }));
      const fonts = document.fonts?.ready ?? Promise.resolve();
      Promise.all([loaded, fonts]).then(() => applyHeaderOffset(target));
    } else {
      applyHeaderOffset(target);
    }
  });
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
function applyHeaderOffset(target: HTMLElement) {
  requestAnimationFrame(() => {
    const offset = headerOffset();
    if (lenisInstance && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      lenisInstance.scrollTo(target, {
        offset,
        immediate: true,
        force: true,
      });
    } else {
      const top = target.getBoundingClientRect().top + window.scrollY + offset;
      window.scrollTo({
        top,
        left: 0,
        behavior: 'instant',
      });
    }
  });
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
  if (!targetEl) return;

  const targetSelector = typeof target === 'string' ? target : `#${targetEl.id}`;
  const offset = options?.offset ?? headerOffset();
  const currentY = window.scrollY;
  const targetY = targetEl.getBoundingClientRect().top + currentY + offset;
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
      offset,
      duration,
      easing: LENIS_EASE,
      onComplete: () => {
        options?.onComplete?.();
      },
    });
  } else {
    // No Lenis (reduced motion / coarse pointer / init skipped): apply the
    // header offset with the same rect+scrollY math as applyHeaderOffset.
    // (offsetTop is relative to offsetParent — wrong when the parent is positioned.)
    window.scrollTo({ top: targetY, left: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
    window.setTimeout(() => {
      options?.onComplete?.();
    }, prefersReduced ? 50 : 600);
  }
}
