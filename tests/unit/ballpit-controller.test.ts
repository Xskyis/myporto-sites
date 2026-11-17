// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let notify: (entries: Array<{ isIntersecting: boolean }>) => void;
let disconnect = vi.fn();
let cleanup: (() => void) | undefined;
let hidden = false;

beforeEach(() => {
  vi.resetModules();
  hidden = false;
  document.body.innerHTML = '<div id="ball-pit-wrapper"><canvas id="ball-pit-canvas" class="opacity-0"></canvas><div id="ball-pit-fallback" class="hidden"></div></div>';
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof notify) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.doMock('../../src/lib/three/webgl-tier', () => ({ detectWebGL: () => 'hardware' }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const dispose = vi.fn();
  const pit = { initBallPit: vi.fn(() => dispose), setBallPitVisible: vi.fn(), applyScrollWake: vi.fn() };
  const download = deferred<typeof pit>();
  const off = vi.fn();
  const lenis = { velocity: 2, on: vi.fn(() => off) };
  const scrollDownload = deferred<{ getLenis: () => typeof lenis }>();
  vi.doMock('../../src/lib/three/ballpit', () => download.promise);
  vi.doMock('../../src/lib/scroll/lenis', () => scrollDownload.promise);
  const { setupBallPit } = await import('../../src/lib/three/ballpit-controller');
  cleanup = setupBallPit();
  return { pit, dispose, download, off, lenis, scrollDownload };
}

const flushImports = () => vi.dynamicImportSettled();

describe('ball pit page lifecycle', () => {
  it('shows fallback without probing WebGL or loading the renderer on save-data', async () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const detect = vi.fn(() => 'hardware');
    vi.doMock('../../src/lib/three/webgl-tier', () => ({ detectWebGL: detect }));
    const { pit } = await mount();
    expect(detect).not.toHaveBeenCalled();
    expect(pit.initBallPit).not.toHaveBeenCalled();
    expect(document.getElementById('ball-pit-fallback')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('ball-pit-canvas')?.style.display).toBe('none');
  });

  it('defers loading until visible and skips init when the footer leaves during download', async () => {
    const { pit, download, scrollDownload, lenis, off, dispose } = await mount();
    expect(pit.initBallPit).not.toHaveBeenCalled();
    notify([{ isIntersecting: true }]);
    notify([{ isIntersecting: false }]);
    download.resolve(pit);
    scrollDownload.resolve({ getLenis: () => lenis });
    await flushImports();
    expect(pit.initBallPit).not.toHaveBeenCalled();
    expect(lenis.on).not.toHaveBeenCalled();

    notify([{ isIntersecting: true }]);
    await flushImports();
    expect(pit.initBallPit).toHaveBeenCalledTimes(1);
    expect(pit.setBallPitVisible).toHaveBeenLastCalledWith(true);
    expect(lenis.on).toHaveBeenCalledTimes(1);
    notify([{ isIntersecting: false }]);
    expect(pit.setBallPitVisible).toHaveBeenLastCalledWith(false);
    expect(off).toHaveBeenCalledTimes(1);
    cleanup?.();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it('does not initialize a detached page after navigation during download', async () => {
    const { pit, download, scrollDownload, lenis } = await mount();
    notify([{ isIntersecting: true }]);
    cleanup?.();
    download.resolve(pit);
    scrollDownload.resolve({ getLenis: () => lenis });
    await flushImports();
    expect(pit.initBallPit).not.toHaveBeenCalled();
    expect(lenis.on).not.toHaveBeenCalled();
  });

  it('shows the static fallback when renderer creation fails', async () => {
    const { pit, download, scrollDownload, lenis } = await mount();
    pit.initBallPit.mockImplementation(() => { throw new Error('No WebGL context'); });
    notify([{ isIntersecting: true }]);
    download.resolve(pit);
    scrollDownload.resolve({ getLenis: () => lenis });
    await flushImports();
    expect(document.getElementById('ball-pit-fallback')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('ball-pit-canvas')?.style.display).toBe('none');
    expect(pit.setBallPitVisible).not.toHaveBeenCalled();
    expect(lenis.on).not.toHaveBeenCalled();
  });

  it('does not attach a late scroll listener after leaving the viewport', async () => {
    const { pit, download, scrollDownload, lenis } = await mount();
    notify([{ isIntersecting: true }]);
    download.resolve(pit);
    await vi.waitFor(() => expect(pit.initBallPit).toHaveBeenCalledTimes(1));
    notify([{ isIntersecting: false }]);
    scrollDownload.resolve({ getLenis: () => lenis });
    await flushImports();
    expect(lenis.on).not.toHaveBeenCalled();
    expect(pit.setBallPitVisible).toHaveBeenLastCalledWith(false);
  });

  it('pauses on tab hide and resumes without duplicate renderers or listeners', async () => {
    const { pit, download, scrollDownload, lenis, off } = await mount();
    notify([{ isIntersecting: true }]);
    notify([{ isIntersecting: true }]);
    download.resolve(pit);
    scrollDownload.resolve({ getLenis: () => lenis });
    await flushImports();
    expect(pit.initBallPit).toHaveBeenCalledTimes(1);
    expect(lenis.on).toHaveBeenCalledTimes(1);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(pit.setBallPitVisible).toHaveBeenLastCalledWith(false);
    expect(off).toHaveBeenCalledTimes(1);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await flushImports();
    expect(pit.setBallPitVisible).toHaveBeenLastCalledWith(true);
    expect(pit.initBallPit).toHaveBeenCalledTimes(1);
    expect(lenis.on).toHaveBeenCalledTimes(2);
  });
});
