import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

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
    setupProgressBar();
    setupHero(signal);
    setupScrollReveals();
    setupStaggers();
    setupTimelineLine();
    setupCounters();
    setupParallax();
    setupVelocityMarquee(cleanups, signal);
    setupMagneticButtons(signal);
  });

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

function setupProgressBar() {
  const progressBar = document.getElementById('scroll-progress-bar');
  if (!progressBar) return;

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
      // Hold until the splash curtain wipe exposes the hero
      window.addEventListener('splash:hero-reveal', () => entrance.play(), { once: true, signal });
    } else {
      entrance.delay(0.1).play();
    }
  }

  // Scroll-out: hero content drifts up slower than the page and fades, giving depth to the hand-off
  const content = hero.querySelector<HTMLElement>('[data-hero-parallax]');
  const exit = gsap.timeline({
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
    },
  });
  exit.to(hero, { opacity: 0, ease: 'none' }, 0);
  if (content) {
    exit.to(content, { y: -90, scale: 0.985, ease: 'none', transformOrigin: 'left center' }, 0);
  }
}

/* -------------------------------------------------------------------------- */
/*  3. Scroll-triggered reveals (everything outside the hero)                 */
/* -------------------------------------------------------------------------- */

function setupScrollReveals() {
  const reveals = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]')).filter(
    (el) => !el.closest('#hero')
  );

  reveals.forEach((el) => {
    const anim = createRevealAnimation(el);
    ScrollTrigger.create({
      trigger: el,
      start: REVEAL_START,
      once: true,
      onEnter: () => anim.play(),
    });
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
        start: 'top 70%',
        end: 'bottom 80%',
        scrub: true,
      },
    }
  );
}

/* -------------------------------------------------------------------------- */
/*  6. Stat counters                                                          */
/* -------------------------------------------------------------------------- */

function setupCounters() {
  const counters = document.querySelectorAll<HTMLElement>('[data-counter-target]');
  counters.forEach((el) => {
    const target = parseInt(el.getAttribute('data-counter-target') || '0', 10);
    const obj = { val: 0 };
    gsap.to(obj, {
      val: target,
      duration: 1.8,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 90%',
        toggleActions: 'play none none none',
      },
      onUpdate: () => {
        el.textContent = Math.floor(obj.val).toString();
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
/*  8. Scroll-velocity marquee ribbon                                         */
/*     Direction follows scroll direction, speed & skew follow velocity.      */
/* -------------------------------------------------------------------------- */

function setupVelocityMarquee(cleanups: Cleanup[], signal: AbortSignal) {
  const ribbon = document.querySelector<HTMLElement>('[data-marquee]');
  const track = ribbon?.querySelector<HTMLElement>('[data-marquee-track]');
  if (!ribbon || !track) return;

  // Hand control from the CSS keyframe animation to GSAP
  track.classList.remove('animate-marquee');

  const BASE_SPEED = 2.4; // % of track width per second (track is 2x content, so -50% = one loop)
  const MAX_BOOST = 14;
  const wrap = gsap.utils.wrap(-50, 0);
  const clampBoost = gsap.utils.clamp(0, MAX_BOOST);
  const clampSkew = gsap.utils.clamp(-10, 10);

  let position = 0;
  let boost = 0;
  let skew = 0;
  let direction = 1; // 1 = leftwards (scrolling down), -1 = rightwards (scrolling up)
  let hoverFactor = 1;

  const velocityWatcher = ScrollTrigger.create({
    onUpdate: (self) => {
      const velocity = self.getVelocity();
      if (Math.abs(velocity) > 40) direction = velocity > 0 ? 1 : -1;
      boost = Math.max(boost, clampBoost(Math.abs(velocity) / 110));
      skew = clampSkew(-velocity / 260);
    },
  });

  const tick = (_time: number, deltaTime: number) => {
    const dt = Math.min(deltaTime, 64) / 1000;
    boost += (0 - boost) * 0.06;
    skew += (0 - skew) * 0.1;
    position = wrap(position - direction * (BASE_SPEED * hoverFactor + boost) * dt);
    gsap.set(track, { xPercent: position, skewX: skew });
  };
  gsap.ticker.add(tick);

  ribbon.addEventListener('pointerenter', () => (hoverFactor = 0.25), { signal });
  ribbon.addEventListener('pointerleave', () => (hoverFactor = 1), { signal });

  cleanups.push(() => {
    gsap.ticker.remove(tick);
    velocityWatcher.kill();
    gsap.set(track, { clearProps: 'transform' });
    track.classList.add('animate-marquee');
  });
}

/* -------------------------------------------------------------------------- */
/*  9. Magnetic buttons (pointer: fine only)                                  */
/* -------------------------------------------------------------------------- */

function setupMagneticButtons(signal: AbortSignal) {
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const buttons = document.querySelectorAll<HTMLElement>('.magnetic-btn');
  buttons.forEach((btn) => {
    const xTo = gsap.quickTo(btn, 'x', { duration: 0.35, ease: 'power3.out' });
    const yTo = gsap.quickTo(btn, 'y', { duration: 0.35, ease: 'power3.out' });

    btn.addEventListener(
      'mousemove',
      (e: MouseEvent) => {
        const rect = btn.getBoundingClientRect();
        const dx = (e.clientX - (rect.left + rect.width / 2)) * 0.35;
        const dy = (e.clientY - (rect.top + rect.height / 2)) * 0.35;
        xTo(dx);
        yTo(dy);
      },
      { signal }
    );

    btn.addEventListener(
      'mouseleave',
      () => {
        gsap.to(btn, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
      },
      { signal }
    );
  });
}

/* -------------------------------------------------------------------------- */
/*  10. Keep ScrollTrigger positions accurate after late layout shifts        */
/* -------------------------------------------------------------------------- */

function scheduleRefresh(signal: AbortSignal) {
  const refresh = () => {
    if (!signal.aborted) ScrollTrigger.refresh();
  };

  // Web fonts (Geist / Instrument Serif) change heading heights once they land
  if (document.fonts?.ready) {
    document.fonts.ready.then(refresh).catch(() => {});
  }

  // Images without explicit dimensions (project covers) push content down as they load
  document.querySelectorAll<HTMLImageElement>('#main-content img').forEach((img) => {
    if (!img.complete) {
      img.addEventListener('load', refresh, { once: true, signal });
    }
  });
}
