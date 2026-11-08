import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { onPaletteChange } from '../palette-events';
import { getLenis } from './lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

type Cleanup = () => void;

/**
 * Viewport position at which a [data-reveal] element starts animating in.
 * "top 88%" = when the element's top edge reaches 88% down the viewport.
 */
const REVEAL_START = 'top 88%';

/**
 * Supported `data-reveal` variants:
 *  - "up"    (default) fade + 40px rise
 *  - "fade"  opacity only
 *  - "scale" fade + subtle scale/rise, good for cards & media
 *  - "clip"  curtain wipe from bottom (clip-path), good for cover images
 *  - "words" masked word-by-word rise for display headings
 */
type RevealVariant = 'up' | 'fade' | 'scale' | 'clip' | 'words';

export function initScrollAnimations(): Cleanup {
  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReduced) return () => {};

  const cleanups: Cleanup[] = [];
  const abort = new AbortController();
  const { signal } = abort;
  cleanups.push(() => abort.abort());

  const ctx = gsap.context(() => {
    setupProgressBar(cleanups);
    setupHero(signal);
    setupScrollReveals();
    setupStaggers();
    setupTimelineLine();
    setupCounters();
    setupParallax();
    setupMagneticButtons(signal);
  });

  // `js-anim` (global.css) exists only to hide [data-reveal] between first paint and the
  // moment GSAP takes over. Every reveal now owns an inline opacity, so release the class:
  // from here on a broken animation path can only mean "visible", never "blank".
  document.documentElement.classList.remove('js-anim');

  scheduleRefresh(signal);

  return () => {
    ctx.revert();
    cleanups.forEach((fn) => fn());
  };
}

/* -------------------------------------------------------------------------- */
/*  Reveal factory                                                            */
/* -------------------------------------------------------------------------- */

function createRevealAnimation(el: HTMLElement): gsap.core.Animation {
  const variant = (el.dataset.reveal || 'up') as RevealVariant;

  switch (variant) {
    case 'words': {
      const split = SplitText.create(el, {
        type: 'words',
        mask: 'words',
        wordsClass: 'split-word',
        aria: 'auto',
      });
      // The parent is hidden via CSS until JS takes over; the mask does the hiding from here on.
      gsap.set(el, { opacity: 1 });
      return gsap.fromTo(
        split.words,
        { yPercent: 130 },
        { yPercent: 0, duration: 1.1, ease: 'power4.out', stagger: 0.04, paused: true }
      );
    }
    case 'fade':
      return gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 1, ease: 'power2.out', paused: true });
    case 'scale':
      return gsap.fromTo(
        el,
        { opacity: 0, scale: 0.96, y: 24 },
        { opacity: 1, scale: 1, y: 0, duration: 1, ease: 'power3.out', paused: true }
      );
    case 'clip':
      return gsap.fromTo(
        el,
        { opacity: 1, clipPath: 'inset(0% 0% 100% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'power4.inOut', paused: true }
      );
    case 'up':
    default:
      return gsap.fromTo(
        el,
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 1, ease: 'power3.out', paused: true }
      );
  }
}

/* -------------------------------------------------------------------------- */
/*  1. Reading progress bar                                                   */
/* -------------------------------------------------------------------------- */

function setupProgressBar(cleanups: Array<() => void>) {
  const progressBar = document.getElementById('scroll-progress-bar');
  if (!progressBar) return;

  // Remaster: drive from Lenis' own progress when available (single source,
  // no extra ScrollTrigger over document.body). Falls back to a scrubbed
  // ScrollTrigger on native scroll (touch / reduced-motion / no-Lenis).
  const lenis = getLenis();
  if (lenis) {
    const setProgress = () => {
      const p = Math.min(1, Math.max(0, lenis.progress ?? 0));
      gsap.set(progressBar, { scaleX: p });
    };
    setProgress();
    const off = lenis.on('scroll', setProgress);
    // ctx.revert() does not unsubscribe Lenis listeners — register via the
    // context's cleanup so swaps do not leak duplicate handlers.
    cleanups.push(() => off());
    return;
  }

  gsap.to(progressBar, {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: {
      trigger: document.body,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.3,
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  2. Hero: entrance choreography + scroll-out parallax                      */
/* -------------------------------------------------------------------------- */

function setupHero(signal: AbortSignal) {
  const hero = document.getElementById('hero');
  if (!hero) return;

  const isSplashActive =
    !document.documentElement.classList.contains('no-splash') &&
    !!document.getElementById('splash-screen');

  // Entrance: one master timeline so block reveals and word masks are choreographed together
  const heroReveals = Array.from(hero.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (heroReveals.length > 0) {
    const entrance = gsap.timeline({ paused: true });
    heroReveals.forEach((el, i) => {
      const anim = createRevealAnimation(el);
      anim.paused(false);
      entrance.add(anim, i * 0.12);
    });

    if (isSplashActive) {
      // Hold until the splash curtain wipe exposes the hero. Safety net: the splash script can
      // fail after adding `js-anim` (which hides every [data-reveal]) and never announce, so
      // never let the hero stay invisible.
      const reveal = () => entrance.play();
      const revealTimer = window.setTimeout(reveal, 6000);
      window.addEventListener(
        'splash:hero-reveal',
        () => {
          window.clearTimeout(revealTimer);
          reveal();
        },
        { once: true, signal }
      );
      signal.addEventListener('abort', () => window.clearTimeout(revealTimer));
    } else {
      entrance.delay(0.1).play();
    }
  }

  // Scroll-out: hero content drifts up slower than the page and fades, giving depth to the hand-off
  const content = hero.querySelector<HTMLElement>('[data-hero-parallax]');
  const bottomBar = hero.querySelector<HTMLElement>(':scope > div:last-child');
  const exit = gsap.timeline({
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: 'bottom top',
      scrub: 0.3,
    },
  });
  if (content) {
    exit.to(content, { y: -90, opacity: 0, scale: 0.985, ease: 'none', transformOrigin: 'left center' }, 0);
  }
  if (bottomBar) {
    exit.to(bottomBar, { opacity: 0, ease: 'none' }, 0);
  }
}

/* -------------------------------------------------------------------------- */
/*  3. Scroll-triggered reveals (everything outside the hero)                 */
/* -------------------------------------------------------------------------- */

function setupScrollReveals() {
  const reveals = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]')).filter(
    (el) => !el.closest('#hero')
  );

  if (reveals.length === 0) return;

  // Remaster: ScrollTrigger.batch registers one trigger for the group
  // instead of one per element, cutting refresh/recalc cost with many reveals.
  const anims = new Map<HTMLElement, gsap.core.Animation>();
  reveals.forEach((el) => anims.set(el, createRevealAnimation(el)));

  ScrollTrigger.batch(reveals, {
    start: REVEAL_START,
    once: true,
    onEnter: (batch) => {
      batch.forEach((el) => anims.get(el as HTMLElement)?.play());
    },
  });
}

/* -------------------------------------------------------------------------- */
/*  4. Staggered groups (cards, badges, tech chips)                           */
/* -------------------------------------------------------------------------- */

function setupStaggers() {
  const containers = document.querySelectorAll<HTMLElement>('[data-stagger-container]');
  containers.forEach((container) => {
    const items = container.querySelectorAll<HTMLElement>('[data-stagger-item]');
    if (items.length === 0) return;

    gsap.fromTo(
      items,
      { y: 30, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.8,
        ease: 'power3.out',
        stagger: { each: 0.06, from: 'start' },
        scrollTrigger: {
          trigger: container,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      }
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  5. Timeline vertical progress line                                        */
/* -------------------------------------------------------------------------- */

function setupTimelineLine() {
  const line = document.getElementById('timeline-progress-line');
  const container = document.getElementById('timeline-container');
  if (!line || !container) return;

  gsap.fromTo(
    line,
    { scaleY: 0 },
    {
      scaleY: 1,
      transformOrigin: 'top center',
      ease: 'none',
      scrollTrigger: {
        trigger: container,
        start: 'top 75%',
        end: 'bottom 75%',
        scrub: 0.3,
      },
    }
  );

  // Dynamic node dot lighting: lights up at the exact viewport line (75%) as the scrub line crosses it
  const dots = container.querySelectorAll<HTMLElement>('.timeline-node-dot');
  dots.forEach((dot) => {
    ScrollTrigger.create({
      trigger: dot,
      start: 'center 75%',
      toggleActions: 'play reverse play reverse',
      onEnter: () => {
        gsap.to(dot, {
          backgroundColor: 'var(--accent-primary)',
          scale: 1.25,
          duration: 0.35,
          ease: 'back.out(2)',
        });
      },
      onLeaveBack: () => {
        gsap.to(dot, {
          backgroundColor: 'var(--text-muted)',
          scale: 1,
          duration: 0.3,
          ease: 'power2.out',
        });
      },
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  6. Stat counters                                                          */
/* -------------------------------------------------------------------------- */

function setupCounters() {
  const counters = document.querySelectorAll<HTMLElement>('[data-counter-target]');
  counters.forEach((el) => {
    const target = parseInt(el.getAttribute('data-counter-target') || '0', 10);
    if (!Number.isFinite(target) || target <= 0) {
      el.textContent = Number.isFinite(target) ? String(Math.max(0, target)) : '0';
      return;
    }
    // Duration scales with magnitude — a fixed 1.8s makes 1-digit stats
    // (e.g. "1+ yrs", "1st") sit at 0 for ~most of the tween before flipping.
    const duration = target <= 9 ? 0.6 : target <= 99 ? 1.2 : 1.8;
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target,
      duration,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 90%',
        toggleActions: 'play none none none',
      },
      onUpdate: () => {
        // round (not floor) so small counts flip at ~50% instead of the very end
        el.textContent = Math.round(obj.val).toString();
      },
      onComplete: () => {
        el.textContent = target.toString();
      },
    });
  });
}

/* -------------------------------------------------------------------------- */
/*  7. Generic parallax: [data-parallax="0.15"] inside an overflow-hidden box  */
/* -------------------------------------------------------------------------- */

function setupParallax() {
  const layers = document.querySelectorAll<HTMLElement>('[data-parallax]');
  layers.forEach((el) => {
    const speed = parseFloat(el.dataset.parallax || '0.15');
    if (!Number.isFinite(speed) || speed === 0) return;

    const trigger = el.parentElement ?? el;
    const shift = speed * 100;

    gsap.fromTo(
      el,
      { yPercent: -shift, scale: 1 + Math.abs(speed) * 2 },
      {
        yPercent: shift,
        scale: 1 + Math.abs(speed) * 2,
        ease: 'none',
        scrollTrigger: {
          trigger,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      }
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  8. Magnetic buttons (pointer: fine only)                                  */
/* -------------------------------------------------------------------------- */

function setupMagneticButtons(signal: AbortSignal) {
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const buttons = document.querySelectorAll<HTMLElement>('.magnetic-btn');
  buttons.forEach((btn) => {
    const xTo = gsap.quickTo(btn, 'x', { duration: 0.35, ease: 'power3.out' });
    const yTo = gsap.quickTo(btn, 'y', { duration: 0.35, ease: 'power3.out' });

    let centerX = 0;
    let centerY = 0;

    btn.addEventListener(
      'mouseenter',
      () => {
        // Calculate true resting center without translation distortion
        const rect = btn.getBoundingClientRect();
        const currentX = (gsap.getProperty(btn, 'x') as number) || 0;
        const currentY = (gsap.getProperty(btn, 'y') as number) || 0;
        centerX = rect.left - currentX + rect.width / 2;
        centerY = rect.top - currentY + rect.height / 2;
      },
      { signal }
    );

    btn.addEventListener(
      'mousemove',
      (e: MouseEvent) => {
        if (!centerX) {
          const rect = btn.getBoundingClientRect();
          centerX = rect.left + rect.width / 2;
          centerY = rect.top + rect.height / 2;
        }
        const dx = (e.clientX - centerX) * 0.35;
        const dy = (e.clientY - centerY) * 0.35;
        xTo(dx);
        yTo(dy);
      },
      { signal }
    );

    btn.addEventListener(
      'mouseleave',
      () => {
        centerX = 0;
        centerY = 0;
        gsap.to(btn, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      },
      { signal }
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  9. Keep ScrollTrigger positions accurate after late layout shifts         */
/* -------------------------------------------------------------------------- */

function scheduleRefresh(signal: AbortSignal) {
  // Remaster: coalesce bursts (20 images loading in sequence) into one
  // rAF-throttled refresh instead of a full recalcs per image.
  let queued = false;
  const refresh = () => {
    if (signal.aborted) return;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (!signal.aborted) ScrollTrigger.refresh();
    });
  };

  // Web fonts (Geist / Instrument Serif) change heading heights once they land
  if (document.fonts?.ready) {
    document.fonts.ready.then(refresh).catch(() => {});
  }

  // Switching between mono (Geist) and poster color (Instrument Serif) shifts display font metrics
  onPaletteChange(() => {
    requestAnimationFrame(refresh);
  }, signal);

  // Images without explicit dimensions (project covers) push content down as they load
  document.querySelectorAll<HTMLImageElement>('#main-content img').forEach((img) => {
    if (!img.complete) {
      img.addEventListener('load', refresh, { once: true, signal });
    }
  });
}
