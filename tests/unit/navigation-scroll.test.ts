// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class Lenis {
    static instances: Lenis[] = [];
    offScroll = vi.fn();
    on = vi.fn(() => this.offScroll);
    raf = vi.fn();
    stop = vi.fn();
    start = vi.fn();
    resize = vi.fn();
    destroy = vi.fn();
    scrollTo = vi.fn();
    constructor() { Lenis.instances.push(this); }
  }
  return {
    Lenis,
    ticker: { add: vi.fn(), remove: vi.fn(), lagSmoothing: vi.fn() },
    refresh: vi.fn(),
    update: vi.fn(),
  };
});

vi.mock('lenis', () => ({ default: mocks.Lenis }));
vi.mock('gsap', () => ({ gsap: { registerPlugin: vi.fn(), ticker: mocks.ticker } }));
vi.mock('gsap/ScrollTrigger', () => ({
  ScrollTrigger: { config: vi.fn(), refresh: mocks.refresh, update: mocks.update },
}));

class MotionQuery extends EventTarget {
  matches = false;
  change(matches: boolean) {
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }
}

let motion: MotionQuery;
let scroll: typeof import('../../src/lib/scroll/lenis');
let scrollLock: typeof import('../../src/lib/scroll/scroll-lock').scrollLock;
let disposeNavigation: (() => void) | undefined;
let resolveFonts: () => void;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  mocks.Lenis.instances.length = 0;
  motion = new MotionQuery();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    if (query.includes('prefers-reduced-motion')) return motion;
    return { matches: query.includes('pointer: fine') };
  }));
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('scrollY', 400);
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => frames.delete(frame)));
  document.documentElement.className = 'no-splash';
  document.documentElement.style.setProperty('--header-height', '80px');
  document.body.innerHTML = '<section id="projects"></section>';
  vi.spyOn(document.getElementById('projects')!, 'getBoundingClientRect').mockReturnValue({ top: 800 } as DOMRect);
  Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
  Object.defineProperty(document, 'fonts', {
    value: { ready: new Promise<void>((resolve) => { resolveFonts = resolve; }) },
    configurable: true,
  });
  history.replaceState({ index: 2, scrollX: 0, scrollY: 400 }, '', '/#projects');
  scroll = await import('../../src/lib/scroll/lenis');
  ({ scrollLock } = await import('../../src/lib/scroll/scroll-lock'));
  disposeNavigation = scroll.installNavigationScroll();
});

afterEach(() => {
  motion.change(true);
  disposeNavigation?.();
  scrollLock.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const emit = (name: string) => document.dispatchEvent(new Event(name));
const flushPromises = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const flushFrames = () => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
};
const prepare = (navigationType: string) => {
  const event = new Event('astro:before-preparation');
  Object.assign(event, { navigationType });
  document.dispatchEvent(event);
};

describe('navigation scroll ownership', () => {
  it('waits for initial fonts and load, then applies the fixed header offset once', async () => {
    scroll.installNavigationScroll(); // Repeated installation cannot add another correction.
    emit('astro:page-load');
    resolveFonts();
    await flushPromises();
    expect(frames.size).toBe(0);

    window.dispatchEvent(new Event('load'));
    await flushPromises();
    expect(frames.size).toBe(1);
    flushFrames();

    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1125, left: 0, behavior: 'instant' });
  });

  it.each(['astro:before-preparation', 'astro:before-swap'])
    ('cancels pending initial loading on %s before it can scroll a replacement page', async (event) => {
      emit('astro:page-load');
      emit(event);
      document.body.innerHTML = '<main id="new-page"></main>';
      history.replaceState({}, '', '/projects/example');
      emit('astro:after-swap');
      emit('astro:page-load');

      resolveFonts();
      window.dispatchEvent(new Event('load'));
      await flushPromises();
      flushFrames();

      expect(window.scrollTo).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
    });

  it('rejects a late font continuation after load, even while the old target is connected', async () => {
    emit('astro:page-load');
    window.dispatchEvent(new Event('load'));
    prepare('push');
    resolveFonts();
    await flushPromises();
    flushFrames();

    expect(document.getElementById('projects')!.isConnected).toBe(true);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('cancels a correction already queued in rAF when navigation starts', async () => {
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    emit('astro:page-load');
    resolveFonts();
    await flushPromises();
    expect(frames.size).toBe(1);

    prepare('push');
    flushFrames();

    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('rejects a detached destination even if no swap event was dispatched', async () => {
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    emit('astro:page-load');
    resolveFonts();
    await flushPromises();
    document.getElementById('projects')!.remove();
    flushFrames();

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('corrects a pushed hash without waiting for the initial document load', () => {
    prepare('push');
    emit('astro:page-load');
    flushFrames();

    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1125, left: 0, behavior: 'instant' });
  });

  it('preserves the browser restoration position on history traversal', () => {
    prepare('traverse');
    emit('astro:after-swap');
    emit('astro:page-load');
    flushFrames();

    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('synchronizes a live Lenis instance on swap and applies an immediate hash offset', () => {
    scroll.initLenis();
    const lenis = mocks.Lenis.instances[0];
    const target = document.getElementById('projects');
    prepare('push');
    emit('astro:after-swap');
    emit('astro:page-load');
    flushFrames();

    expect(lenis.stop).toHaveBeenCalledOnce();
    expect(lenis.start).toHaveBeenCalledOnce();
    expect(lenis.resize).toHaveBeenCalledOnce();
    expect(lenis.scrollTo).toHaveBeenCalledExactlyOnceWith(target, {
      offset: -75, immediate: true, force: true,
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('cancels native scroll completions on swap and preserves the history state', () => {
    const onComplete = vi.fn();
    scroll.scrollToTarget('#projects', { onComplete });
    expect(history.state).toEqual({ index: 2, scrollX: 0, scrollY: 400 });

    emit('astro:before-swap');
    vi.advanceTimersByTime(600);

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ignores a late Lenis completion from a previous navigation', () => {
    scroll.initLenis();
    const onComplete = vi.fn();
    scroll.scrollToTarget('#projects', { onComplete });
    const completion = mocks.Lenis.instances[0].scrollTo.mock.calls[0][1].onComplete;

    prepare('push');
    completion();

    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('Lenis motion preference lifecycle', () => {
  it('destroys smooth scrolling, listeners, ticker and splash watchdog immediately on reduced motion', () => {
    document.documentElement.classList.remove('no-splash');
    document.body.insertAdjacentHTML('beforeend', '<div id="splash-screen"></div>');
    scroll.initLenis();
    scroll.initLenis();
    const lenis = mocks.Lenis.instances[0];
    const ticker = mocks.ticker.add.mock.calls[0][0];
    expect(mocks.Lenis.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    motion.change(true);
    ticker(1);
    window.dispatchEvent(new Event('load'));
    window.dispatchEvent(new Event('splash:hero-reveal'));

    expect(scroll.getLenis()).toBeNull();
    expect(lenis.destroy).toHaveBeenCalledOnce();
    expect(lenis.offScroll).toHaveBeenCalledOnce();
    expect(mocks.ticker.remove).toHaveBeenCalledExactlyOnceWith(ticker);
    expect(lenis.raf).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps active lock ownership while replacing an instance at the next page setup', () => {
    scrollLock.acquire('certs');
    scroll.initLenis();
    const previous = mocks.Lenis.instances[0];
    expect(previous.stop).toHaveBeenCalledOnce();

    motion.change(true);
    expect(scrollLock.reasons()).toEqual(['certs']);
    expect(document.documentElement.classList.contains('overflow-hidden')).toBe(true);
    motion.change(false);
    expect(scroll.getLenis()).toBeNull();
    expect(mocks.Lenis.instances).toHaveLength(1);

    scroll.initLenis();
    const current = mocks.Lenis.instances[1];
    expect(current.stop).toHaveBeenCalledOnce();
    scrollLock.release('certs');

    expect(previous.start).not.toHaveBeenCalled();
    expect(current.start).toHaveBeenCalledOnce();
    expect(scrollLock.isLocked()).toBe(false);
  });

  it('starts native when reduced motion is already enabled and can initialize on a later page', () => {
    motion.matches = true;
    expect(scroll.initLenis()).toBeNull();
    expect(mocks.ticker.add).not.toHaveBeenCalled();

    motion.change(false);
    expect(scroll.initLenis()).not.toBeNull();
    expect(mocks.Lenis.instances).toHaveLength(1);
    expect(mocks.ticker.add).toHaveBeenCalledOnce();
  });
});
