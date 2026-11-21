import type { PortraitHandle } from './portrait';
import { detectWebGL } from './webgl-tier';
import { onPaletteChange } from '../palette-events';

type Controller = {
  handle: PortraitHandle | null;
  teardown: () => void;
};

/** Owns one page's portrait and each cancellable motion-preference session. */
export function setupPortrait(): () => void {
  const root = document.getElementById('portrait-particles');
  const hero = document.getElementById('hero');
  const initialCanvas = root?.querySelector<HTMLCanvasElement>('.portrait__canvas');
  if (!root || !hero || !initialCanvas) return () => {};

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const forcedOff = new URLSearchParams(window.location.search).get('portrait') === '0';
  let canvas = initialCanvas;
  let controller: Controller | null = null;
  let disposed = false;
  let replaceCanvas = false;
  // A preference change should retain the already-visible static portrait during reboot.
  let hasStarted = motion.matches;

  const stop = () => {
    const previous = controller;
    controller = null;
    previous?.teardown();
    previous?.handle?.dispose();
    if (previous) replaceCanvas = true;
  };
  const syncMotion = () => {
    if (disposed) return;
    stop();
    if (motion.matches || saveData || forcedOff) {
      root.dataset.state = 'fallback';
      return;
    }
    if (replaceCanvas) {
      // dispose() deliberately loses its GL context; a fresh element can acquire a new one.
      const nextCanvas = canvas.cloneNode(false) as HTMLCanvasElement;
      canvas.replaceWith(nextCanvas);
      canvas = nextCanvas;
      replaceCanvas = false;
    }
    controller = createPortrait(root, hero, canvas, hasStarted);
    hasStarted = true;
  };
  const onPageHide = () => controller?.handle?.setActive(false);
  motion.addEventListener('change', syncMotion);
  window.addEventListener('pagehide', onPageHide);
  syncMotion();

  return () => {
    if (disposed) return;
    disposed = true;
    motion.removeEventListener('change', syncMotion);
    window.removeEventListener('pagehide', onPageHide);
    stop();
  };
}

function createPortrait(
  root: HTMLElement,
  hero: HTMLElement,
  canvas: HTMLCanvasElement,
  showImmediately: boolean,
): Controller {
  const abort = new AbortController();
  const { signal } = abort;
  const state: Controller = { handle: null, teardown: () => abort.abort() };
  canvas.addEventListener('webglcontextlost', () => {
    // An evicted GPU context cannot keep the live layer visible. Abort pending
    // imports/downloads as well, so no late callback can hide the static fallback.
    abort.abort();
    state.handle?.dispose();
    state.handle = null;
    root.dataset.state = 'fallback';
  }, { signal });

  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const isNarrow = window.matchMedia('(max-width: 1023.98px)').matches;
  const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;

  const isSplashActive = () =>
    !document.documentElement.classList.contains('no-splash') && !!document.getElementById('splash-screen');

  // ?portrait=0 forces the static fallback, ?portrait=1 forces WebGL even on software GL (testing)
  const portraitParam = new URLSearchParams(window.location.search).get('portrait');
  const forcedOn = portraitParam === '1';

  // The server renders `data-state="fallback"` so static dots stay visible without JavaScript.
  // The inline pre-paint script above switches to `idle` when motion + JS are enabled, so
  // reloads and first visits both run the assemble intro cleanly without flashing static dots
  // over the WebGL canvas. Static dots only step in if WebGL fails or exceeds the timer.
  let placeholderShown = showImmediately;
  root.dataset.state = showImmediately ? 'placeholder' : 'idle';
  const showPlaceholder = () => {
    if (root.dataset.state !== 'idle') return;
    root.dataset.state = 'placeholder';
    placeholderShown = true;
  };
  let placeholderTimer = 0;
  const armPlaceholderTimer = (delay: number) => {
    window.clearTimeout(placeholderTimer);
    placeholderTimer = window.setTimeout(showPlaceholder, delay);
  };
  signal.addEventListener('abort', () => window.clearTimeout(placeholderTimer));

  const reduced = isTouch || isNarrow || lowEnd;
  if (reduced) {
    root.style.setProperty('--portrait-inset', '-20%');
    root.style.setProperty('--portrait-size', '140%');
  } else {
    root.style.removeProperty('--portrait-inset');
    root.style.removeProperty('--portrait-size');
  }

  const boot = async () => {
    if (signal.aborted) return;

    // Probe before downloading three.js: no GPU → static portrait, nothing else fetched
    const tier = detectWebGL({ allowSoftware: forcedOn });
    if (tier === 'none' || (tier === 'software' && !forcedOn)) {
      root.dataset.state = 'fallback';
      return;
    }

    let mod: typeof import('./portrait');
    try {
      mod = await import('./portrait');
    } catch {
      if (!signal.aborted) root.dataset.state = 'fallback';
      return;
    }
    if (signal.aborted) return;

    let handle: PortraitHandle;
    try {
      handle = await mod.initPortrait(canvas, {
        reduced,
        signal,
        tilt: !isTouch,
        onReady: () => {
          if (signal.aborted) return;
          window.clearTimeout(placeholderTimer);
          root.dataset.state = 'live';
        },
      });
    } catch (err) {
      if (signal.aborted) return;
      console.warn('[portrait] WebGL init failed, using static fallback:', err);
      root.dataset.state = 'fallback';
      return;
    }
    if (signal.aborted) {
      handle.dispose();
      return;
    }
    window.clearTimeout(placeholderTimer);
    state.handle = handle;

    // --- intro -----------------------------------------------------------
    // When the slow-boot placeholder already appeared, crossfade straight to the assembled
    // portrait instead of sweeping an assemble over static dots. Otherwise play the full
    // scattered → assembled intro on both first visits and reloads.
    if (placeholderShown) {
      handle.showAssembled();
    } else {
      void handle.assemble();
    }
    handle.setActive(!document.hidden);

    // --- visibility: only the on-screen WebGL context may run its loop ------
    let heroInView = true;
    const io = new IntersectionObserver(
      ([entry]) => {
        heroInView = entry.isIntersecting;
        handle.setActive(heroInView && !document.hidden);
      },
      { threshold: 0.02 }
    );
    io.observe(hero);
    signal.addEventListener('abort', () => io.disconnect());
    document.addEventListener('visibilitychange', () => handle.setActive(heroInView && !document.hidden), { signal });

    // --- pointer → repulsion + tilt ----------------------------------------
    // The canvas is pointer-events:none; listen on the whole hero so the cloud reacts
    // even when the cursor is over text, and keep touch purely passive (never blocks scroll).
    let cachedRect = canvas.getBoundingClientRect();
    let rectDirty = false;
    const markRectDirty = () => {
      rectDirty = true;
    };
    window.addEventListener('scroll', markRectDirty, { passive: true, signal });
    window.addEventListener('resize', markRectDirty, { passive: true, signal });

    const toCanvas = (clientX: number, clientY: number) => {
      if (rectDirty) {
        cachedRect = canvas.getBoundingClientRect();
        rectDirty = false;
      }
      return { x: clientX - cachedRect.left, y: clientY - cachedRect.top };
    };
    if (!isTouch) {
      hero.addEventListener(
        'pointermove',
        (e) => {
          const p = toCanvas(e.clientX, e.clientY);
          handle.setPointer(p.x, p.y, 1);
        },
        { passive: true, signal }
      );
      hero.addEventListener('pointerleave', () => handle.setPointer(null, null), { signal });
    } else {
      let rippleTimer = 0;
      signal.addEventListener('abort', () => window.clearTimeout(rippleTimer), { once: true });
      hero.addEventListener(
        'touchmove',
        (e) => {
          const t = e.touches[0];
          if (!t) return;
          const p = toCanvas(t.clientX, t.clientY);
          handle.setPointer(p.x, p.y, 0.55);
          window.clearTimeout(rippleTimer);
          rippleTimer = window.setTimeout(() => handle.setPointer(null, null), 180);
        },
        { passive: true, signal }
      );
      const endRipple = () => {
        window.clearTimeout(rippleTimer);
        handle.setPointer(null, null);
      };
      hero.addEventListener('touchend', endRipple, { passive: true, signal });
      hero.addEventListener('touchcancel', endRipple, { passive: true, signal });
    }

    // --- scroll → scatter (Hero progress 0..1) ------------------------------
    const { gsap } = await import('gsap');
    if (signal.aborted) return;
    const { ScrollTrigger } = await import('gsap/ScrollTrigger');
    if (signal.aborted) return;
    gsap.registerPlugin(ScrollTrigger);
    const st = ScrollTrigger.create({
      trigger: hero,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => handle.setScatter(self.progress),
    });
    signal.addEventListener('abort', () => st.kill());

    // --- palette -----------------------------------------------------------
    onPaletteChange(() => handle.syncPalette(true), signal);
  };

  // On first visit the portrait sits behind the splash curtain. Hold the three.js bundle and
  // the point cloud (~350 KB gzip combined) until the curtain starts lifting, so they never
  // compete with fonts/CSS on the critical path — then boot WITH the reveal, so the assemble
  // intro plays from its very beginning as the hero appears, exactly like a reload.
  let bootStarted = false;
  const startBoot = (withPlaceholder: boolean) => {
    if (bootStarted || signal.aborted) return;
    bootStarted = true;
    if (withPlaceholder) {
      // Safety path (splash never announced): cover the box immediately.
      showPlaceholder();
    } else {
      // 800 ms covers typical bundle + point-cloud boot (including the 700 ms splash wipe)
      // so normal reloads and first visits run the assemble intro instead of crossfading
      // over static dots, while genuinely slow connections still get a placeholder.
      armPlaceholderTimer(800);
    }
    void boot();
  };

  if (isSplashActive() && !(window as unknown as { __heroRevealed?: boolean }).__heroRevealed) {
    window.addEventListener('splash:hero-reveal', () => startBoot(false), { once: true, signal });
    // Safety net: if the splash never announces (e.g. its script failed), boot anyway.
    const safetyTimer = window.setTimeout(() => startBoot(true), 5000);
    signal.addEventListener('abort', () => window.clearTimeout(safetyTimer));
  } else {
    // Returning visitors, reloads, and subpages: boot straight away with the assemble intro.
    startBoot(false);
  }

  return state;
}
