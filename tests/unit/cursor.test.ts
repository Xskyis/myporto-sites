// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let fineMatches = true;
let wideMatches = true;
let reducedMatches = false;
let mockLenis: { velocity: number; isScrolling: boolean | 'native' | 'smooth' } | null = null;
let pendingRaf = new Map<number, FrameRequestCallback>();
let nextRafId = 0;

function flushRaf(time: number) {
  const callbacks = [...pendingRaf.values()];
  pendingRaf.clear();
  callbacks.forEach((cb) => cb(time));
}

function makePointerEvent(
  type: string,
  init: { clientX?: number; clientY?: number; pointerType?: string } = {},
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    pointerType: string;
  };
  ev.clientX = init.clientX ?? 0;
  ev.clientY = init.clientY ?? 0;
  ev.pointerType = init.pointerType ?? 'mouse';
  return ev;
}

describe('CustomCursor reticle', () => {
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    vi.resetModules();
    fineMatches = true;
    wideMatches = true;
    reducedMatches = false;
    mockLenis = { velocity: 0, isScrolling: false };
    pendingRaf = new Map();
    nextRafId = 0;

    document.documentElement.className = '';
    document.body.innerHTML = `
      <div id="cursor-ring" class="cursor-reticle opacity-0"></div>
      <button id="cta" type="button">Action</button>
      <div id="plain">Plain</div>
    `;

    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches:
          query === '(pointer: fine)'
            ? fineMatches
            : query === '(pointer: fine) and (min-width: 768px)'
              ? fineMatches && wideMatches
            : query === '(prefers-reduced-motion: reduce)'
              ? reducedMatches
              : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++nextRafId;
      pendingRaf.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingRaf.delete(id);
    });

    vi.doMock('../../src/lib/scroll/lenis', () => ({
      getLenis: () => mockLenis,
    }));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('orders translate3d before rotate and scale so tip (0, 0) always maps to (x, y)', async () => {
    const { buildCursorTransform } = await import('../../src/lib/cursor');
    const transform = buildCursorTransform(912, 468, 1.12, 6);

    expect(transform).toBe('translate3d(912px, 468px, 0px) rotate(6deg) scale(1.12)');
    expect(transform.indexOf('translate3d')).toBeLessThan(transform.indexOf('rotate'));
    expect(transform.indexOf('rotate')).toBeLessThan(transform.indexOf('scale'));

    // Applying translate3d(x, y, 0) * rotate(theta) * scale(s) to tip (0, 0) yields (x, y).
    const rad = (6 * Math.PI) / 180;
    const tip = { x: 0, y: 0 };
    const scaled = { x: tip.x * 1.12, y: tip.y * 1.12 };
    const rotated = {
      x: scaled.x * Math.cos(rad) - scaled.y * Math.sin(rad),
      y: scaled.x * Math.sin(rad) + scaled.y * Math.cos(rad),
    };
    const translated = { x: rotated.x + 912, y: rotated.y + 468 };
    expect(translated).toEqual({ x: 912, y: 468 });
  });

  it('clamps scroll lean only during active smooth scroll and suppresses it for native or reduced motion', async () => {
    const { CURSOR_MAX_LEAN_DEG, targetCursorLean } = await import('../../src/lib/cursor');

    expect(targetCursorLean(40, true, false)).toBe(CURSOR_MAX_LEAN_DEG);
    expect(targetCursorLean(-40, true, false)).toBe(-CURSOR_MAX_LEAN_DEG);
    expect(targetCursorLean(40, false, false)).toBe(0);
    expect(targetCursorLean(40, true, true)).toBe(0);
    expect(targetCursorLean(Number.NaN, true, false)).toBe(0);
  });

  it('locks the tip at pointer coordinates and avoids standalone rotate while scrolling', async () => {
    const { setupCursor } = await import('../../src/lib/cursor');
    cleanup = setupCursor();

    const ring = document.getElementById('cursor-ring')!;
    expect(document.documentElement.classList.contains('has-custom-cursor')).toBe(true);

    // Pinpoint tracking: first pointermove immediately places tip at (900, 450)
    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 900, clientY: 450 }));
    expect(ring.classList.contains('opacity-100')).toBe(true);
    expect(ring.style.transform).toBe('translate3d(900px, 450px, 0px) scale(1)');
    expect(ring.style.rotate).toBe('');

    // Simulate smooth wheel scrolling while pointer stays stationary
    mockLenis = { velocity: 30, isScrolling: 'smooth' };
    window.dispatchEvent(new Event('scroll'));

    flushRaf(16);
    flushRaf(32);

    expect(ring.style.rotate).toBe('');
    expect(ring.style.transform.startsWith('translate3d(900px, 450px, 0px)')).toBe(true);
    expect(ring.style.transform).toMatch(/translate3d\(900px, 450px, 0px\) rotate\([0-9.]+deg\) scale\(1\)/);

    // Once scrolling settles, lean returns to 0 and rAF loop sleeps
    mockLenis = { velocity: 0, isScrolling: false };
    for (let t = 48; t <= 1200 && pendingRaf.size > 0; t += 16) {
      flushRaf(t);
    }

    expect(pendingRaf.size).toBe(0);
    expect(ring.style.transform).toBe('translate3d(900px, 450px, 0px) scale(1)');
  });

  it('remounts at the last pointer position after an Astro page swap', async () => {
    const { setupCursor } = await import('../../src/lib/cursor');
    cleanup = setupCursor();
    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 740, clientY: 360 }));
    expect(document.getElementById('cursor-ring')?.classList.contains('opacity-100')).toBe(true);

    // astro:before-swap tears down the old ring, then the new body supplies another opacity-0 ring.
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '<div id="cursor-ring" class="cursor-reticle opacity-0"></div>';
    cleanup = setupCursor();

    const ring = document.getElementById('cursor-ring')!;
    expect(ring.classList.contains('opacity-100')).toBe(true);
    expect(ring.style.transform).toBe('translate3d(740px, 360px, 0px) scale(1)');
    expect(pendingRaf.size).toBe(0);
  });

  it('animates hover and press scale around the locked tip without shifting position', async () => {
    const { setupCursor } = await import('../../src/lib/cursor');
    cleanup = setupCursor();

    const ring = document.getElementById('cursor-ring')!;
    const cta = document.getElementById('cta')!;
    const plain = document.getElementById('plain')!;

    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 250, clientY: 320 }));
    cta.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(ring.style.color).toBe('var(--accent-primary)');

    for (let t = 16; t <= 600 && pendingRaf.size > 0; t += 16) {
      flushRaf(t);
    }
    expect(ring.style.transform).toBe('translate3d(250px, 320px, 0px) scale(1.12)');

    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    for (let t = 616; t <= 1200 && pendingRaf.size > 0; t += 16) {
      flushRaf(t);
    }
    expect(ring.style.transform).toBe('translate3d(250px, 320px, 0px) scale(0.92)');

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    plain.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(ring.style.color).toBe('var(--cursor-color)');

    for (let t = 1216; t <= 1800 && pendingRaf.size > 0; t += 16) {
      flushRaf(t);
    }
    expect(ring.style.transform).toBe('translate3d(250px, 320px, 0px) scale(1)');
  });

  it('ignores native scrollbar velocity so lean does not stick for 400ms', async () => {
    const { setupCursor } = await import('../../src/lib/cursor');
    cleanup = setupCursor();

    const ring = document.getElementById('cursor-ring')!;
    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 300, clientY: 200 }));

    mockLenis = { velocity: 25, isScrolling: 'native' };
    window.dispatchEvent(new Event('scroll'));

    expect(pendingRaf.size).toBe(0);
    expect(ring.style.transform).toBe('translate3d(300px, 200px, 0px) scale(1)');
  });

  it('hides on touch input and never mounts on coarse-only devices', async () => {
    const { setupCursor } = await import('../../src/lib/cursor');
    cleanup = setupCursor();
    const ring = document.getElementById('cursor-ring')!;

    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 120, clientY: 140 }));
    expect(ring.classList.contains('opacity-100')).toBe(true);

    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 200, clientY: 240, pointerType: 'touch' }));
    expect(ring.classList.contains('opacity-0')).toBe(true);

    cleanup?.();
    cleanup = null;
    fineMatches = false;
    cleanup = setupCursor();
    expect(cleanup).toBeNull();
    expect(document.documentElement.classList.contains('has-custom-cursor')).toBe(false);
  });

  it('does not mount or bind the custom cursor below its CSS breakpoint', async () => {
    const { setupCursor } = await import('../../src/lib/cursor');
    const ring = document.getElementById('cursor-ring')!;
    const addEventListener = vi.spyOn(window, 'addEventListener');
    fineMatches = true;
    wideMatches = false;

    expect(setupCursor()).toBeNull();
    expect(document.documentElement.classList.contains('has-custom-cursor')).toBe(false);
    expect(addEventListener).not.toHaveBeenCalledWith('pointermove', expect.any(Function), expect.anything());
    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 200, clientY: 120 }));
    expect(ring.classList.contains('opacity-0')).toBe(true);
  });

  it('respects prefers-reduced-motion and cleans up all state on teardown', async () => {
    reducedMatches = true;
    const { setupCursor } = await import('../../src/lib/cursor');
    cleanup = setupCursor();
    const ring = document.getElementById('cursor-ring')!;

    window.dispatchEvent(makePointerEvent('pointermove', { clientX: 400, clientY: 300 }));
    mockLenis = { velocity: 30, isScrolling: 'smooth' };
    window.dispatchEvent(new Event('scroll'));

    expect(pendingRaf.size).toBe(0);
    expect(ring.style.transform).toBe('translate3d(400px, 300px, 0px) scale(1)');

    cleanup?.();
    cleanup = null;
    expect(document.documentElement.classList.contains('has-custom-cursor')).toBe(false);
    expect(ring.style.transform).toBe('');
  });
});
