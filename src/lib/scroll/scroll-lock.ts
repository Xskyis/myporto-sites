/**
 * Ref-counted scroll lock — single owner for "the page must not scroll".
 *
 * Previously splash, the mobile menu, and the certificates dialog each
 * hand-rolled `lenis.stop()/start()` + `overflow-hidden` toggles. A second
 * owner releasing early would unlock the first owner's modal (or vice versa).
 *
 * This lock tracks string reasons (`'splash'`, `'mobile-menu'`, `'certs'`, …):
 * the first `acquire()` stops scrolling + locks the DOM, the last
 * `release()` resumes. Duplicate acquires of the same reason count once.
 * `reset()` is the navigation escape hatch.
 *
 * Pure core (`createScrollLock`) takes injected ports so it is unit-testable
 * without a DOM or a Lenis instance. The default singleton is wired to the
 * live Lenis + DOM by `wireScrollLock()` in `lenis.ts`.
 */

export interface ScrollLockPorts {
  stop: () => void;
  start: () => void;
  lockDom: () => void;
  unlockDom: () => void;
}

export interface ScrollLock {
  acquire: (reason: string) => void;
  release: (reason: string) => void;
  reset: () => void;
  isLocked: () => boolean;
  reasons: () => string[];
  size: () => number;
}

export function createScrollLock(ports: ScrollLockPorts): ScrollLock {
  const active = new Set<string>();
  return {
    acquire(reason: string) {
      if (active.has(reason)) return;
      active.add(reason);
      if (active.size === 1) {
        ports.lockDom();
        ports.stop();
      }
    },
    release(reason: string) {
      if (!active.has(reason)) return;
      active.delete(reason);
      if (active.size === 0) {
        ports.start();
        ports.unlockDom();
      }
    },
    reset() {
      if (active.size === 0) return;
      active.clear();
      ports.start();
      ports.unlockDom();
    },
    isLocked() {
      return active.size > 0;
    },
    reasons() {
      return [...active];
    },
    size() {
      return active.size;
    },
  };
}

/** Default DOM ports for the live page. Callbacks resolve late (getLenis). */
function defaultPorts(): ScrollLockPorts {
  return {
    stop: () => {
      // Resolved lazily to avoid a circular import with lenis.ts.
      const w = (globalThis as unknown as { __lenisStop?: () => void }).__lenisStop;
      w?.();
    },
    start: () => {
      const w = (globalThis as unknown as { __lenisStart?: () => void }).__lenisStart;
      w?.();
    },
    lockDom: () => {
      if (typeof document === 'undefined') return;
      document.documentElement.classList.add('overflow-hidden');
      document.body.classList.add('overflow-hidden');
    },
    unlockDom: () => {
      if (typeof document === 'undefined') return;
      document.documentElement.classList.remove('overflow-hidden');
      document.body.classList.remove('overflow-hidden');
    },
  };
}

/**
 * Singleton used across the app. Ports delegate through `globalThis.__lenis*`
 * so `lenis.ts` can wire the real instance without importing back here.
 * Tests should use `createScrollLock()` with mock ports instead.
 */
export const scrollLock: ScrollLock = createScrollLock(defaultPorts());

/** Called by lenis.ts after the instance exists (and on swap repair). */
export function wireScrollLock(stop: () => void, start: () => void) {
  (globalThis as unknown as { __lenisStop?: () => void }).__lenisStop = stop;
  (globalThis as unknown as { __lenisStart?: () => void }).__lenisStart = start;
}
