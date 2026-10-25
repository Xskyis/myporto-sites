import { gsap } from 'gsap';
import { getLenis } from '../scroll/lenis';

export function initSplashScreen() {
  if (typeof window === 'undefined') return;

  const isHome =
    window.location.pathname === '/' ||
    window.location.pathname === '' ||
    window.location.pathname === '/index.html';

  const params = new URLSearchParams(window.location.search);
  const forceSplash = params.get('splash') === '1';

  let splashShown = false;
  try {
    splashShown = sessionStorage.getItem('splash_shown') === 'true';
  } catch (e) {
    // Graceful fallback for restricted storage environments
  }

  const splashEl = document.getElementById('splash-screen');
  if (!splashEl) return;

  // Skip splash screen on subpages and repeat visits within the same session
  if (!isHome || (splashShown && !forceSplash)) {
    document.documentElement.classList.add('no-splash');
    splashEl.style.display = 'none';
    const header = document.getElementById('main-header');
    if (header) {
      header.style.opacity = '1';
      header.style.pointerEvents = 'auto';
    }
    return;
  }

  // 1. Lock scroll and reset to top
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  document.documentElement.classList.add('overflow-hidden');
  document.body.classList.add('overflow-hidden');

  const lenis = getLenis();
  if (lenis) {
    lenis.stop();
    lenis.scrollTo(0, { immediate: true });
  }

  // 2. Accessibility: prefers-reduced-motion replaces sequence with a quick 300ms fade
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    handleReducedMotion(splashEl);
    return;
  }

  // 3. Full editorial sequence (~2.4s - 2.8s total)
  let hasExited = false;

  // Stagger letter slide-up with masked overflow
  gsap.to('.splash-char', {
    y: '0%',
    duration: 0.85,
    stagger: 0.045,
    ease: 'expo.out',
    delay: 0.15,
  });

  // Track progress with tabular-nums counter and 1px bottom edge line
  const counterEl = document.getElementById('splash-counter');
  const progressBarEl = document.getElementById('splash-progress-bar');

  const updateProgressUI = (val: number) => {
    const clamped = Math.min(100, Math.max(0, Math.floor(val)));
    if (counterEl) {
      counterEl.textContent = String(clamped).padStart(3, '0');
    }
    if (progressBarEl) {
      progressBarEl.style.transform = `scaleX(${clamped / 100})`;
    }
  };

  const executeCurtainExit = () => {
    if (hasExited) return;
    hasExited = true;

    const exitTl = gsap.timeline({
      onComplete: () => {
        // Unlock scroll and restore Lenis
        document.documentElement.classList.remove('overflow-hidden');
        document.body.classList.remove('overflow-hidden');
        const activeLenis = getLenis();
        if (activeLenis) activeLenis.start();

        try {
          sessionStorage.setItem('splash_shown', 'true');
        } catch (e) {}

        document.documentElement.classList.add('no-splash');
        if (splashEl) splashEl.style.display = 'none';
      },
    });

    // Wordmark slightly scales/fades up
    exitTl.to(
      '#splash-wordmark',
      {
        scale: 1.04,
        opacity: 0.95,
        duration: 0.32,
        ease: 'power2.out',
      },
      0
    );

    // Subtle fade of counter & bottom info
    exitTl.to(
      ['#splash-bottom', '#splash-progress-track', '#splash-top'],
      {
        opacity: 0,
        duration: 0.22,
        ease: 'power2.out',
      },
      0.05
    );

    // Curtain wipe (clip-path inset from bottom to top ~0.9s, power4.inOut)
    exitTl.to(
      splashEl,
      {
        clipPath: 'inset(0% 0% 100% 0%)',
        duration: 0.9,
        ease: 'power4.inOut',
      },
      0.18
    );

    // Hero intro animations play during curtain reveal
    exitTl.add(() => {
      window.dispatchEvent(new CustomEvent('splash:hero-reveal'));
    }, 0.38);

    // Navbar fades in after curtain leaves
    exitTl.to(
      '#main-header',
      {
        opacity: 1,
        duration: 0.75,
        ease: 'power2.out',
        onStart: () => {
          const header = document.getElementById('main-header');
          if (header) header.style.pointerEvents = 'auto';
        },
      },
      0.82
    );
  };

  // Real loading progress tracking
  trackRealLoading(updateProgressUI, executeCurtainExit);

  // Hard timeout safety: if loading takes longer than 3.8s, finish anyway
  setTimeout(() => {
    if (!hasExited) {
      updateProgressUI(100);
      executeCurtainExit();
    }
  }, 3800);
}

function trackRealLoading(
  onProgress: (p: number) => void,
  onComplete: () => void
) {
  let isDone = false;
  const progressObj = { val: 0 };

  // Phase 1: Ease smoothly to ~50%
  const phase1Tween = gsap.to(progressObj, {
    val: 52,
    duration: 0.8,
    ease: 'power1.out',
    onUpdate: () => onProgress(progressObj.val),
  });

  const fontsPromise = document.fonts ? document.fonts.ready : Promise.resolve();
  const windowPromise = new Promise<void>((resolve) => {
    if (document.readyState === 'complete') {
      resolve();
    } else {
      window.addEventListener('load', () => resolve(), { once: true });
    }
  });

  // Minimum wait of ~1.1s so letter stagger completes elegantly before hitting 100
  const minTimePromise = new Promise<void>((resolve) => setTimeout(resolve, 1100));

  Promise.all([fontsPromise, windowPromise, minTimePromise]).then(() => {
    if (isDone) return;
    phase1Tween.kill();

    // Phase 2: Ease towards 100%
    gsap.to(progressObj, {
      val: 100,
      duration: 0.65,
      ease: 'power2.out',
      onUpdate: () => onProgress(progressObj.val),
      onComplete: () => {
        if (!isDone) {
          isDone = true;
          onProgress(100);
          // Brief pause on 100 for visual satisfaction before curtain wipe
          setTimeout(() => {
            onComplete();
          }, 120);
        }
      },
    });
  });
}

function handleReducedMotion(splashEl: HTMLElement) {
  const chars = document.querySelectorAll<HTMLElement>('.splash-char');
  chars.forEach((c) => {
    c.style.transform = 'translateY(0%)';
  });

  const counter = document.getElementById('splash-counter');
  if (counter) counter.textContent = '100';

  const bar = document.getElementById('splash-progress-bar');
  if (bar) bar.style.transform = 'scaleX(1)';

  gsap.to(splashEl, {
    opacity: 0,
    duration: 0.3,
    delay: 0.15,
    ease: 'none',
    onComplete: () => {
      document.documentElement.classList.remove('overflow-hidden');
      document.body.classList.remove('overflow-hidden');
      const lenis = getLenis();
      if (lenis) lenis.start();

      try {
        sessionStorage.setItem('splash_shown', 'true');
      } catch (e) {}

      document.documentElement.classList.add('no-splash');
      splashEl.style.display = 'none';

      window.dispatchEvent(new CustomEvent('splash:hero-reveal'));
      const header = document.getElementById('main-header');
      if (header) {
        header.style.opacity = '1';
        header.style.pointerEvents = 'auto';
      }
    },
  });
}
