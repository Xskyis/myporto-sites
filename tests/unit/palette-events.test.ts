// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onPaletteChange } from '../../src/lib/palette-events';

describe('onPaletteChange', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-palette', 'mono');
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes callback on palette-change event when state changes', () => {
    const cb = vi.fn();
    const dispose = onPaletteChange(cb);

    document.documentElement.setAttribute('data-palette', 'color');
    window.dispatchEvent(new CustomEvent('palette-change', { detail: { palette: 'color' } }));

    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('does not invoke when event fires without state change', () => {
    const cb = vi.fn();
    const dispose = onPaletteChange(cb);

    window.dispatchEvent(new CustomEvent('palette-change'));
    expect(cb).not.toHaveBeenCalled();

    dispose();
  });

  it('invokes on MutationObserver attribute change (dark toggle)', () => {
    const cb = vi.fn();
    const dispose = onPaletteChange(cb);

    document.documentElement.classList.add('dark');
    // MutationObserver is async; jsdom delivers it on microtask. The helper
    // reads attribute via observer callback — wait a tick.
    // We trigger synchronously by dispatching the synthetic event as fallback:
    // but the test asserts the observer path works by checking mutation.
    // Give the observer a turn:
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb).toHaveBeenCalled();
        dispose();
        resolve();
      }, 30);
    });
  });

  it('disposer removes listener and observer', () => {
    const cb = vi.fn();
    const dispose = onPaletteChange(cb);
    dispose();
    document.documentElement.setAttribute('data-palette', 'color');
    window.dispatchEvent(new CustomEvent('palette-change'));
    expect(cb).not.toHaveBeenCalled();
  });

  it('AbortSignal disconnects observer', () => {
    const cb = vi.fn();
    const ctrl = new AbortController();
    const dispose = onPaletteChange(cb, ctrl.signal);
    ctrl.abort();
    document.documentElement.setAttribute('data-palette', 'color');
    // Even if observer had a pending callback, abort disconnected it.
    window.dispatchEvent(new CustomEvent('palette-change'));
    // Note: the window listener was registered with {signal} so it is also gone.
    expect(cb).not.toHaveBeenCalled();
    dispose(); // no-op safe call
  });

  it('does not fire twice for same state (dedup by key)', () => {
    const cb = vi.fn();
    const dispose = onPaletteChange(cb);

    document.documentElement.setAttribute('data-palette', 'color');
    document.documentElement.setAttribute('data-palette', 'color'); // same value
    window.dispatchEvent(new CustomEvent('palette-change'));
    window.dispatchEvent(new CustomEvent('palette-change'));

    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
  });
});
