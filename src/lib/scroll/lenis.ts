import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let lenisInstance: Lenis | null = null;

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

export function resetScrollOnNavigation() {
  if (typeof window === 'undefined') return;

  const hash = window.location.hash;
  if (hash && hash !== '#' && document.querySelector(hash)) {
    setTimeout(() => {
      scrollToTarget(hash, { duration: 1.0 });
    }, 60);
  } else {
    if (lenisInstance) {
      lenisInstance.scrollTo(0, { immediate: true, force: true });
      lenisInstance.resize();
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
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
  const offset = options?.offset ?? -75;
  const duration = prefersReduced ? 0.01 : (options?.duration ?? 1.4);

  // Update URL hash without causing an instant browser jump
  if (options?.updateHash !== false && targetSelector.startsWith('#')) {
    history.replaceState(null, '', targetSelector);
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
