// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AnimationVars = {
  val?: number;
  onStart?: () => void;
  onUpdate?: () => void;
  onComplete?: () => void;
  [key: string]: unknown;
};

const mocks = vi.hoisted(() => {
  const tweens: Array<{ target: unknown; vars: AnimationVars; kill: ReturnType<typeof vi.fn> }> = [];
  const timelines: Array<{
    vars: AnimationVars;
    steps: Array<{ target: unknown; vars: AnimationVars; position?: number }>;
    callbacks: Array<{ callback: () => void; position: number }>;
    kill: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    tweens,
    timelines,
    acquire: vi.fn(),
    release: vi.fn(),
    to: vi.fn((target: unknown, vars: AnimationVars) => {
      const tween = { target, vars, kill: vi.fn() };
      tweens.push(tween);
      return tween;
    }),
    timeline: vi.fn((vars: AnimationVars) => {
      const timeline = {
        vars,
        steps: [] as Array<{ target: unknown; vars: AnimationVars; position?: number }>,
        callbacks: [] as Array<{ callback: () => void; position: number }>,
        kill: vi.fn(),
        to(target: unknown, stepVars: AnimationVars, position?: number) {
          this.steps.push({ target, vars: stepVars, position });
          return this;
        },
        add(callback: () => void, position: number) {
          this.callbacks.push({ callback, position });
          return this;
        },
      };
      timelines.push(timeline);
      return timeline;
    }),
  };
});

vi.mock('gsap', () => ({ gsap: { to: mocks.to, timeline: mocks.timeline } }));
vi.mock('../../src/lib/scroll/lenis', () => ({ getLenis: () => null }));
vi.mock('../../src/lib/scroll/scroll-lock', () => ({
  scrollLock: { acquire: mocks.acquire, release: mocks.release },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderPage() {
  document.body.innerHTML = `
    <header id="main-header" style="opacity: 0; pointer-events: none"></header>
    <div id="splash-screen">
      <div id="splash-wordmark"><span class="splash-char">n</span></div>
      <div id="splash-bottom"><span id="splash-counter">000</span></div>
      <div id="splash-progress-track"><div id="splash-progress-bar"></div></div>
    </div>
    <main id="main-content" tabindex="-1"></main>
    <button id="page-button">Next page action</button>`;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.tweens.length = 0;
  mocks.timelines.length = 0;
  sessionStorage.clear();
  history.replaceState({}, '', '/');
  document.documentElement.className = '';
  renderPage();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.assign(window, { __heroRevealed: false });
});

afterEach(() => {
  document.dispatchEvent(new Event('astro:before-swap'));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

async function mount() {
  const { initSplashScreen } = await import('../../src/lib/splash/splash');
  initSplashScreen();
  return initSplashScreen;
}

async function finishLoading() {
  await vi.advanceTimersByTimeAsync(1100);
  const phase2 = mocks.tweens.find((tween) => tween.vars.val === 100);
  expect(phase2).toBeDefined();
  phase2!.vars.onComplete?.();
  await vi.advanceTimersByTimeAsync(120);
  expect(mocks.timelines).toHaveLength(1);
  return mocks.timelines[0];
}

describe('splash page lifecycle', () => {
  it('cancels pending load work and leaves the next page focus and state alone', async () => {
    const fonts = deferred();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    await mount();
    await vi.advanceTimersByTimeAsync(1100);

    document.dispatchEvent(new Event('astro:before-swap'));
    renderPage();
    const nextAction = document.getElementById('page-button')!;
    nextAction.focus();
    fonts.resolve();
    window.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(10000);

    expect(mocks.to).toHaveBeenCalledTimes(2);
    expect(mocks.timeline).not.toHaveBeenCalled();
    expect(mocks.tweens.every((tween) => tween.kill.mock.calls.length > 0)).toBe(true);
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('splash');
    expect(document.activeElement).toBe(nextAction);
    expect(document.documentElement.classList.contains('no-splash')).toBe(false);
    expect(sessionStorage.getItem('splash_shown')).toBeNull();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('guards a loading continuation already queued when a navigation begins', async () => {
    await mount();
    vi.advanceTimersByTime(1100);
    document.dispatchEvent(new Event('astro:before-swap'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.to).toHaveBeenCalledTimes(2);
    expect(mocks.timeline).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills the exit timeline and guards its callbacks after a swap', async () => {
    await mount();
    const exit = await finishLoading();
    const reveal = vi.fn();
    window.addEventListener('splash:hero-reveal', reveal, { once: true });
    document.dispatchEvent(new Event('astro:before-swap'));
    renderPage();
    const nextAction = document.getElementById('page-button')!;
    nextAction.focus();

    exit.callbacks.forEach(({ callback }) => callback());
    exit.steps.forEach(({ vars }) => vars.onStart?.());
    exit.vars.onComplete?.();

    expect(exit.kill).toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(nextAction);
    expect(document.getElementById('main-header')?.style.pointerEvents).toBe('none');
    expect(sessionStorage.getItem('splash_shown')).toBeNull();
    expect(mocks.release).toHaveBeenCalledTimes(1);
    window.removeEventListener('splash:hero-reveal', reveal);
  });

  it('keeps the normal reveal timing, releases focus, and initialises one element once', async () => {
    const init = await mount();
    init();
    expect(mocks.acquire).toHaveBeenCalledExactlyOnceWith('splash');
    const exit = await finishLoading();
    const reveal = vi.fn();
    window.addEventListener('splash:hero-reveal', reveal, { once: true });
    const handoff = exit.callbacks.find(({ position }) => position === 0.38)!;
    handoff.callback();
    handoff.callback();
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(mocks.release).not.toHaveBeenCalled();
    expect(exit.steps.every(({ target }) => typeof target !== 'string')).toBe(true);

    exit.vars.onComplete?.();
    expect(sessionStorage.getItem('splash_shown')).toBe('true');
    expect(document.documentElement.classList.contains('no-splash')).toBe(true);
    expect(document.activeElement?.id).toBe('main-content');
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('splash');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    const calls = mocks.to.mock.calls.length;
    init();
    expect(mocks.to).toHaveBeenCalledTimes(calls);
  });

  it('cancels the reduced-motion fade without revealing or focusing the next page', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    await mount();
    const fade = mocks.tweens[0];
    const reveal = vi.fn();
    window.addEventListener('splash:hero-reveal', reveal, { once: true });
    document.dispatchEvent(new Event('astro:before-swap'));
    renderPage();
    document.getElementById('page-button')!.focus();
    fade.vars.onComplete?.();

    expect(fade.kill).toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('page-button');
    expect(document.documentElement.classList.contains('no-splash')).toBe(false);
    expect(sessionStorage.getItem('splash_shown')).toBeNull();
    expect(mocks.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    window.removeEventListener('splash:hero-reveal', reveal);
  });

  it('completes the reduced-motion fade with the same hero handoff and focus release', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    await mount();
    const reveal = vi.fn();
    window.addEventListener('splash:hero-reveal', reveal, { once: true });
    const fade = mocks.tweens[0];
    expect(fade.vars.duration).toBe(0.3);
    expect(fade.vars.delay).toBe(0.15);
    fade.vars.onComplete?.();

    expect(reveal).toHaveBeenCalledTimes(1);
    expect(document.getElementById('main-header')?.style.pointerEvents).toBe('auto');
    expect(document.getElementById('splash-screen')?.style.display).toBe('none');
    expect(document.activeElement?.id).toBe('main-content');
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('splash');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours incoming no-splash state when a session first enters home from a detail page', async () => {
    document.documentElement.classList.add('no-splash');
    document.getElementById('page-button')!.focus();
    await mount();

    expect(mocks.acquire).not.toHaveBeenCalled();
    expect(mocks.to).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('page-button');
    expect(document.getElementById('main-header')?.style.opacity).toBe('1');
    expect(document.getElementById('splash-screen')?.style.display).toBe('none');
  });

  it('reinitialises a fresh element while keeping the old pending scope cancelled', async () => {
    const init = await mount();
    const oldTweens = [...mocks.tweens];
    document.dispatchEvent(new Event('astro:before-swap'));
    renderPage();
    init();
    init();

    expect(mocks.acquire).toHaveBeenCalledTimes(2);
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(oldTweens.every((tween) => tween.kill.mock.calls.length > 0)).toBe(true);
    const exit = await finishLoading();
    exit.vars.onComplete?.();
    expect(mocks.release).toHaveBeenCalledTimes(2);
    expect(document.activeElement?.id).toBe('main-content');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('exits on the loading watchdog once and ignores fonts that resolve later', async () => {
    const fonts = deferred();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: fonts.promise } });
    await mount();
    await vi.advanceTimersByTimeAsync(3800);
    expect(mocks.timelines).toHaveLength(1);
    expect(document.getElementById('splash-counter')?.textContent).toBe('100');
    fonts.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.tweens.some((tween) => tween.vars.val === 100)).toBe(false);
    expect(mocks.timelines).toHaveLength(1);
    mocks.timelines[0].vars.onComplete?.();
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith('splash');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
