// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortraitHandle, PortraitOptions } from '../../src/lib/three/portrait';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeHandle(): PortraitHandle {
  return {
    assemble: vi.fn(async () => {}),
    showAssembled: vi.fn(),
    setScatter: vi.fn(),
    setActive: vi.fn(),
    syncPalette: vi.fn(),
    setPointer: vi.fn(),
    dispose: vi.fn(),
  };
}

let motion: MediaQueryList;
let cleanup: (() => void) | undefined;
let killTrigger: ReturnType<typeof vi.fn>;
let disconnect: ReturnType<typeof vi.fn>;

function setReducedMotion(matches: boolean) {
  Object.defineProperty(motion, 'matches', { value: matches, configurable: true });
  motion.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  vi.resetModules();
  document.documentElement.className = 'no-splash';
  document.body.innerHTML = '<section id="hero"><div id="portrait-particles" data-state="fallback"><div class="portrait__static" role="img"></div><canvas class="portrait__canvas" aria-hidden="true"></canvas></div></section>';
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  motion = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn((query: string) =>
    query.includes('prefers-reduced-motion') ? motion : { matches: false },
  ));
  disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect = disconnect;
  });
  killTrigger = vi.fn();
  vi.doMock('gsap', () => ({ gsap: { registerPlugin: vi.fn() } }));
  vi.doMock('gsap/ScrollTrigger', () => ({ ScrollTrigger: { create: vi.fn(() => ({ kill: killTrigger })) } }));
  vi.doMock('../../src/lib/three/webgl-tier', () => ({ detectWebGL: vi.fn(() => 'hardware') }));
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  const handle = makeHandle();
  const initialized = deferred<PortraitHandle>();
  const initPortrait = vi.fn((_canvas: HTMLCanvasElement, _options: PortraitOptions) => initialized.promise);
  const download = deferred<{ initPortrait: typeof initPortrait }>();
  vi.doMock('../../src/lib/three/portrait', () => download.promise);
  const { setupPortrait } = await import('../../src/lib/three/portrait-controller');
  cleanup = setupPortrait();
  return { handle, initialized, initPortrait, download };
}

const flushImports = () => vi.dynamicImportSettled();
const portraitState = () => document.getElementById('portrait-particles')?.dataset.state;

describe('portrait motion preference lifecycle', () => {
  it('cancels a pending import and reenables an assembled portrait on a fresh canvas', async () => {
    const { handle, initialized, initPortrait, download } = await mount();
    const originalCanvas = document.querySelector('.portrait__canvas');
    setReducedMotion(true);
    download.resolve({ initPortrait });
    initialized.resolve(handle);
    await flushImports();
    expect(initPortrait).not.toHaveBeenCalled();
    expect(portraitState()).toBe('fallback');

    setReducedMotion(false);
    expect(document.querySelector('.portrait__canvas')).not.toBe(originalCanvas);
    expect(portraitState()).toBe('placeholder');
    await flushImports();
    expect(initPortrait).toHaveBeenCalledTimes(1);
    expect(handle.showAssembled).toHaveBeenCalledTimes(1);
    expect(handle.assemble).not.toHaveBeenCalled();
    initPortrait.mock.calls[0][1].onReady?.();
    expect(portraitState()).toBe('live');
  });

  it('aborts a pending initialization and disposes a late result without revealing it', async () => {
    const { handle, initialized, initPortrait, download } = await mount();
    download.resolve({ initPortrait });
    await vi.waitFor(() => expect(initPortrait).toHaveBeenCalledTimes(1));
    const options = initPortrait.mock.calls[0][1];
    setReducedMotion(true);
    expect(options.signal?.aborted).toBe(true);
    expect(portraitState()).toBe('fallback');
    initialized.resolve(handle);
    await flushImports();
    options.onReady?.();
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(handle.assemble).not.toHaveBeenCalled();
    expect(handle.setActive).not.toHaveBeenCalled();
    expect(portraitState()).toBe('fallback');
  });

  it('disposes the active portrait immediately and does not repeat its intro after reenabling', async () => {
    const { handle, initialized, initPortrait, download } = await mount();
    download.resolve({ initPortrait });
    initialized.resolve(handle);
    await flushImports();
    const oldOptions = initPortrait.mock.calls[0][1];
    oldOptions.onReady?.();
    expect(handle.assemble).toHaveBeenCalledTimes(1);
    expect(portraitState()).toBe('live');

    setReducedMotion(true);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(oldOptions.signal?.aborted).toBe(true);
    expect(killTrigger).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(portraitState()).toBe('fallback');

    const nextHandle = makeHandle();
    initPortrait.mockResolvedValue(nextHandle);
    setReducedMotion(false);
    await flushImports();
    expect(initPortrait).toHaveBeenCalledTimes(2);
    expect(nextHandle.showAssembled).toHaveBeenCalledTimes(1);
    expect(nextHandle.assemble).not.toHaveBeenCalled();
    oldOptions.onReady?.();
    expect(portraitState()).toBe('placeholder');
    initPortrait.mock.calls[1][1].onReady?.();
    expect(portraitState()).toBe('live');
  });

  it('keeps the static portrait on initial reduced motion and honors save-data on later changes', async () => {
    setReducedMotion(true);
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const { handle, initialized, initPortrait, download } = await mount();
    const { detectWebGL } = await import('../../src/lib/three/webgl-tier');
    expect(detectWebGL).not.toHaveBeenCalled();
    setReducedMotion(false);
    download.resolve({ initPortrait });
    initialized.resolve(handle);
    await flushImports();
    expect(detectWebGL).not.toHaveBeenCalled();
    expect(initPortrait).not.toHaveBeenCalled();
    expect(portraitState()).toBe('fallback');
  });

  it('removes the page motion listener and ignores changes after teardown', async () => {
    const { handle, initialized, initPortrait, download } = await mount();
    const removeListener = vi.spyOn(motion, 'removeEventListener');
    cleanup?.();
    expect(removeListener).toHaveBeenCalledWith('change', expect.any(Function));
    setReducedMotion(true);
    setReducedMotion(false);
    download.resolve({ initPortrait });
    initialized.resolve(handle);
    await flushImports();
    expect(initPortrait).not.toHaveBeenCalled();
  });
});
