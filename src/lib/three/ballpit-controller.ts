import { detectWebGL } from './webgl-tier';

/** Owns one page's lazy renderer, visibility and scroll subscription. */
export function setupBallPit(): () => void {
  const canvas = document.getElementById('ball-pit-canvas') as HTMLCanvasElement | null;
  const wrapper = document.getElementById('ball-pit-wrapper');
  const fallback = document.getElementById('ball-pit-fallback');
  if (!canvas || !wrapper) return () => {};

  const showFallback = () => {
    canvas.style.display = 'none';
    fallback?.classList.remove('hidden');
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  if (reduced || saveData || detectWebGL() !== 'hardware') {
    showFallback();
    return () => {};
  }

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

  return () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    releaseWake();
    teardown?.();
    teardown = null;
    pit = null;
  };
}
