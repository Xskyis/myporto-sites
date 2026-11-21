// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupThemeTransition } from '../../src/lib/theme-transition';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class MotionQuery extends EventTarget {
  matches = false;
  change(matches: boolean) { this.matches = matches; this.dispatchEvent(new Event('change')); }
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('theme transition page ownership', () => {
  let abort: AbortController;
  let reduced: MotionQuery;
  let run: ReturnType<typeof setupThemeTransition>;
  let transitions: Array<{
    update: () => void;
    ready: ReturnType<typeof deferred>;
    finished: ReturnType<typeof deferred>;
    done: ReturnType<typeof deferred>;
    skip: ReturnType<typeof vi.fn>;
  }>;
  let animate: ReturnType<typeof vi.fn>;
  let cancelAnimation: ReturnType<typeof vi.fn>;
  let start: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    abort = new AbortController();
    reduced = new MotionQuery();
    transitions = [];
    document.documentElement.className = '';
    cancelAnimation = vi.fn();
    animate = vi.fn(() => ({ cancel: cancelAnimation }));
    Object.defineProperty(document.documentElement, 'animate', { configurable: true, value: animate });
    start = vi.fn((update: () => void) => {
      const t = { update, ready: deferred(), finished: deferred(), done: deferred(), skip: vi.fn() };
      transitions.push(t);
      return { ready: t.ready.promise, finished: t.finished.promise, updateCallbackDone: t.done.promise, skipTransition: t.skip };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    run = setupThemeTransition(abort.signal, reduced as unknown as MediaQueryList);
  });

  afterEach(() => {
    abort.abort();
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'startViewTransition');
    Reflect.deleteProperty(document.documentElement, 'animate');
  });

  it('blocks deferred update and ready callbacks after a page swap', async () => {
    const apply = vi.fn();
    run(apply);
    abort.abort();
    transitions[0].update();
    transitions[0].ready.resolve();
    transitions[0].finished.resolve();
    await flush();
    expect(apply).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    expect(transitions[0].skip).toHaveBeenCalled();
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    run(apply);
    expect(start).toHaveBeenCalledOnce();
  });

  it('allows only the latest action and keeps older promises from clearing its effect', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    run(first);
    // A native skip is allowed to invoke the old update synchronously.
    transitions[0].skip.mockImplementation(transitions[0].update);
    run(latest);
    transitions[0].ready.resolve();
    transitions[0].finished.reject(new Error('superseded'));
    transitions[1].update();
    transitions[1].ready.resolve();
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true);
    transitions[1].finished.resolve();
    await flush();
    expect(cancelAnimation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies a pending choice once while cancelling motion when the preference changes', async () => {
    const apply = vi.fn();
    run(apply);
    reduced.change(true);
    transitions[0].update();
    transitions[0].ready.resolve();
    await flush();
    expect(apply).toHaveBeenCalledOnce();
    expect(transitions[0].skip).toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false);
  });

  it('cancels an active animation on reduced motion without applying the update twice', async () => {
    const apply = vi.fn();
    run(apply);
    transitions[0].update();
    transitions[0].ready.resolve();
    await flush();
    reduced.change(true);
    expect(apply).toHaveBeenCalledOnce();
    expect(cancelAnimation).toHaveBeenCalledOnce();
    expect(transitions[0].skip).toHaveBeenCalled();
  });

  it('uses a synchronous fallback when native transition startup throws', () => {
    start.mockImplementation(() => { throw new Error('unsupported transition'); });
    const apply = vi.fn();
    run(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('consumes rejected ready, finished, and update promises and cleans up', async () => {
    const apply = vi.fn();
    run(apply);
    transitions[0].ready.reject(new Error('skipped'));
    await flush();
    transitions[0].finished.reject(new Error('finished skipped'));
    transitions[0].done.reject(new Error('update skipped'));
    await flush();
    expect(apply).toHaveBeenCalledOnce();
    expect(transitions[0].skip).toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the keyboard viewport centre and releases a stalled native transition', async () => {
    const apply = vi.fn();
    run(apply, { clientX: 0, clientY: 0, detail: 0 });
    transitions[0].ready.resolve();
    await flush();
    expect(animate.mock.calls[0][0].clipPath[0]).toBe(`circle(0px at ${window.innerWidth / 2}px ${window.innerHeight / 2}px)`);
    vi.advanceTimersByTime(1000);
    transitions[0].update();
    expect(apply).toHaveBeenCalledOnce();
    expect(cancelAnimation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies directly with reduced motion or when the browser has no transition API', () => {
    const apply = vi.fn();
    reduced.matches = true;
    run(apply);
    reduced.matches = false;
    Reflect.deleteProperty(document, 'startViewTransition');
    run(apply);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });
});
