import { detectWebGL } from './webgl-tier';

/** Owns one page's preference listener and cancellable renderer sessions. */
export function setupBallPit(): () => void {
  const initialCanvas = document.getElementById('ball-pit-canvas') as HTMLCanvasElement | null;
  const wrapper = document.getElementById('ball-pit-wrapper');
  const fallback = document.getElementById('ball-pit-fallback');
  if (!initialCanvas || !wrapper) return () => {};

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  let canvas = initialCanvas;
  let cleanup: (() => void) | null = null;
  let disposed = false;
  let replaceCanvas = false;
  const stop = () => {
    if (cleanup) {
      cleanup();
      cleanup = null;
      replaceCanvas = true;
    }
  };
  const syncMotion = () => {
    if (disposed) return;
    stop();
    if (motion.matches || saveData || detectWebGL() !== 'hardware') {
      canvas.style.display = 'none';
      fallback?.classList.remove('hidden');
      return;
    }
    if (replaceCanvas) {
      // A disposed renderer loses its context; acquire the next one on a fresh canvas.
      const nextCanvas = canvas.cloneNode(false) as HTMLCanvasElement;
      canvas.replaceWith(nextCanvas);
      canvas = nextCanvas;
      replaceCanvas = false;
    }
    canvas.style.removeProperty('display');
    canvas.classList.remove('opacity-100');
    canvas.classList.add('opacity-0');
    fallback?.classList.add('hidden');
    cleanup = createBallPit(canvas, wrapper, fallback);
  };
  motion.addEventListener('change', syncMotion);
  syncMotion();

  return () => {
    if (disposed) return;
    disposed = true;
    motion.removeEventListener('change', syncMotion);
    stop();
  };
}

/** One session owns its lazy renderer, visibility and optional scroll subscription. */
function createBallPit(canvas: HTMLCanvasElement, wrapper: HTMLElement, fallback: HTMLElement | null): () => void {
  const showFallback = () => {
    canvas.style.display = 'none';
    fallback?.classList.remove('hidden');
  };

  let disposed = false;
  let inView = false;
  let loading = false;
  let failed = false;
  let pit: typeof import('./ballpit') | null = null;
  let teardown: (() => void) | null = null;
  let lenisOff: (() => void) | null = null;
  let lastWakeTime = 0;

  const releaseWake = () => {
    lenisOff?.();
    lenisOff = null;
  };
  const syncVisibility = () => {
    const active = inView && !document.hidden && !disposed;
    if (teardown) pit?.setBallPitVisible(active);
    if (!active) releaseWake();
    return active;
  };

  const activate = async () => {
    if (disposed || failed || !syncVisibility()) return;
    if (!teardown) {
      if (loading) return;
      loading = true;
      try {
        const module = await import('./ballpit');
        // A navigation or viewport exit during download must not create a renderer.
        if (disposed || !syncVisibility()) return;
        pit = module;
        // Init is synchronous: ownership cannot change between construction and assignment.
        teardown = module.initBallPit(canvas);
        syncVisibility();
        canvas.classList.remove('opacity-0');
        canvas.classList.add('opacity-100');
      } catch (error) {
        if (disposed) return;
        failed = true;
        console.warn('Ball pit init error, showing fallback:', error);
        showFallback();
        return;
      } finally {
        loading = false;
      }
    }

    // Scroll wake is optional. Recheck ownership after its import as well.
    try {
      const { getLenis } = await import('../scroll/lenis');
      if (disposed || !syncVisibility() || !teardown || lenisOff) return;
      const lenis = getLenis();
      if (!lenis) return;
      if (Math.abs(lenis.velocity) > 0.8) {
        pit?.applyScrollWake(lenis.velocity);
        lastWakeTime = performance.now();
      }
      lenisOff = lenis.on('scroll', () => {
        const now = performance.now();
        if (Math.abs(lenis.velocity) > 1.2 && now - lastWakeTime > 280) {
          lastWakeTime = now;
          pit?.applyScrollWake(lenis.velocity);
        }
      });
    } catch {
      // Rendering remains available when the optional scroll integration fails.
    }
  };

  const observer = new IntersectionObserver((entries) => {
    if (disposed) return;
    const entry = entries[entries.length - 1];
    if (!entry) return;
    inView = entry.isIntersecting;
    if (syncVisibility()) void activate();
  }, { rootMargin: '100px 0px' });
  observer.observe(wrapper);

  const onVisibilityChange = () => {
    if (syncVisibility()) void activate();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const onContextLost = () => {
    dispose();
    showFallback();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseWake();
    teardown?.();
    teardown = null;
    pit = null;
  }
  return dispose;
}
