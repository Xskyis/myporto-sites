import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Mobile browsers resize the viewport when the address bar collapses; ignore those so
// scroll-linked animations don't jump mid-scroll.
ScrollTrigger.config({ ignoreMobileResize: true });

let lenisInstance: Lenis | null = null;

/** Fixed header is 80px tall; land section tops just below it. */
const HEADER_OFFSET = -75;

export function initLenis(): Lenis | null {
  if (typeof window === 'undefined') return null;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (lenisInstance) {
    return lenisInstance;
  }

  const lenis = new Lenis({
    duration: prefersReduced ? 0.01 : 1.35,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // exponential easeOut
    smoothWheel: !prefersReduced,
    touchMultiplier: 1.5,
    // Kill wheel inertia the moment a link to another page is clicked, so a glide that is
    // still running can't carry over into the next page (see installNavigationScroll).
    stopInertiaOnNavigate: true,
  });

  lenisInstance = lenis;

  // Synchronize Lenis scroll position with GSAP ScrollTrigger
  lenis.on('scroll', ScrollTrigger.update);

  // Hook Lenis into GSAP requestAnimationFrame ticker
  const tickerCallback = (time: number) => {
    lenis.raf(time * 1000);
  };

  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  // Refresh ScrollTrigger after fonts and layout settle
  window.addEventListener('load', () => {
    ScrollTrigger.refresh();
  });

  const isSplashActive =
    !document.documentElement.classList.contains('no-splash') &&
    !!document.getElementById('splash-screen');

  if (isSplashActive) {
    lenis.stop();
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
    const lenis = lenisInstance;
    if (!lenis) return;
    // stop()/start() is the public way to force Lenis' internal reset(): it aborts the running
    // wheel-inertia animation and snaps animatedScroll/targetScroll to the real window position.
    // (scrollTo(window.scrollY) is NOT enough: it returns early, without resetting, whenever the
    // target already equals targetScroll, which is exactly the state after resize().)
    // start() also guarantees no scroll lock from a mobile menu or splash survives the swap.
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

/** Re-land the anchored element just below the fixed header, without a visible second jump. */
function applyHeaderOffset(target: HTMLElement) {
  // Two frames: the browser's own fragment scroll is applied during the next layout pass,
  // so correcting one frame later guarantees we land after it rather than under it.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!target.isConnected) return;
      const top = target.getBoundingClientRect().top + window.scrollY + HEADER_OFFSET;
      if (lenisInstance) {
        lenisInstance.scrollTo(top, { immediate: true, force: true });
      } else {
        window.scrollTo({ top, left: 0, behavior: 'instant' });
      }
      ScrollTrigger.update();
      replayHeadingReveal(target);
    });
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
  const offset = options?.offset ?? HEADER_OFFSET;
  const duration = prefersReduced ? 0.01 : (options?.duration ?? 1.4);

  // Update URL hash without causing an instant browser jump. Keep the existing state object:
  // Astro's ClientRouter stores { index, scrollX, scrollY } there for back/forward restoration.
  if (options?.updateHash !== false && targetSelector.startsWith('#')) {
    history.replaceState(history.state, '', targetSelector);
  }

  if (lenisInstance && !prefersReduced) {
    lenisInstance.scrollTo(targetEl, {
      offset,
      duration,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      onComplete: () => {
        options?.onComplete?.();
        replayHeadingReveal(targetEl);
      },
    });
  } else {
    targetEl.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth' });
    setTimeout(() => {
      options?.onComplete?.();
      replayHeadingReveal(targetEl);
    }, prefersReduced ? 50 : 600);
  }
}

// Replay a subtle accent reveal on the section heading when navigated to
function replayHeadingReveal(sectionEl: HTMLElement) {
  const heading = sectionEl.querySelector<HTMLElement>('h2, h3, [data-reveal]');
  if (heading) {
    gsap.fromTo(
      heading,
      { y: 8, opacity: 0.8 },
      { y: 0, opacity: 1, duration: 0.5, ease: 'power2.out' }
    );
  }
}
