import { describe, it, expect, beforeEach } from 'vitest';
import { createScrollLock, type ScrollLockPorts } from '../../src/lib/scroll/scroll-lock';

function mockPorts() {
  const calls = { stop: 0, start: 0, lockDom: 0, unlockDom: 0 };
  const ports: ScrollLockPorts = {
    stop: () => calls.stop++,
    start: () => calls.start++,
    lockDom: () => calls.lockDom++,
    unlockDom: () => calls.unlockDom++,
  };
  return { ports, calls };
}

describe('createScrollLock', () => {
  let ports: ScrollLockPorts;
  let calls: ReturnType<typeof mockPorts>['calls'];

  beforeEach(() => {
    const m = mockPorts();
    ports = m.ports;
    calls = m.calls;
  });

  it('starts unlocked with no side effects', () => {
    const lock = createScrollLock(ports);
    expect(lock.isLocked()).toBe(false);
    expect(lock.size()).toBe(0);
    expect(calls.stop).toBe(0);
    expect(calls.start).toBe(0);
  });

  it('first acquire stops + locks DOM exactly once', () => {
    const lock = createScrollLock(ports);
    lock.acquire('splash');
    expect(lock.isLocked()).toBe(true);
    expect(lock.size()).toBe(1);
    expect(calls.stop).toBe(1);
    expect(calls.lockDom).toBe(1);
  });

  it('duplicate acquire of same reason counts once', () => {
    const lock = createScrollLock(ports);
    lock.acquire('splash');
    lock.acquire('splash');
    lock.acquire('splash');
    expect(lock.size()).toBe(1);
    expect(calls.stop).toBe(1);
    expect(calls.lockDom).toBe(1);
    // Removing once unlocks even after multiple acquires
    lock.release('splash');
    expect(lock.isLocked()).toBe(false);
    expect(calls.start).toBe(1);
  });

  it('second owner keeps lock pinned after first releases', () => {
    const lock = createScrollLock(ports);
    lock.acquire('splash');
    lock.acquire('certs');
    lock.release('splash');
    expect(lock.isLocked()).toBe(true);
    expect(calls.start).toBe(0);
    expect(calls.unlockDom).toBe(0);
    lock.release('certs');
    expect(lock.isLocked()).toBe(false);
    expect(calls.start).toBe(1);
    expect(calls.unlockDom).toBe(1);
  });

  it('release of unknown reason is a no-op (no start)', () => {
    const lock = createScrollLock(ports);
    lock.release('nonexistent');
    expect(lock.isLocked()).toBe(false);
    expect(calls.start).toBe(0);
    expect(calls.unlockDom).toBe(0);
  });

  it('release of unknown reason while locked does not unlock', () => {
    const lock = createScrollLock(ports);
    lock.acquire('splash');
    lock.release('other');
    expect(lock.isLocked()).toBe(true);
    expect(calls.start).toBe(0);
  });

  it('reset clears all reasons and resumes once', () => {
    const lock = createScrollLock(ports);
    lock.acquire('splash');
    lock.acquire('certs');
    lock.acquire('mobile-menu');
    lock.reset();
    expect(lock.isLocked()).toBe(false);
    expect(lock.size()).toBe(0);
    expect(lock.reasons()).toEqual([]);
    expect(calls.start).toBe(1);
    expect(calls.unlockDom).toBe(1);
  });

  it('reset when already unlocked is a no-op', () => {
    const lock = createScrollLock(ports);
    lock.reset();
    expect(calls.start).toBe(0);
    expect(calls.unlockDom).toBe(0);
  });

  it('reasons() returns a copy, not live set', () => {
    const lock = createScrollLock(ports);
    lock.acquire('splash');
    const r = lock.reasons();
    r.push('hacked');
    expect(lock.size()).toBe(1);
    expect(lock.reasons()).toEqual(['splash']);
  });

  it('independent instances do not share state', () => {
    const a = createScrollLock(ports);
    const b = createScrollLock(ports);
    a.acquire('splash');
    expect(b.isLocked()).toBe(false);
    b.acquire('certs');
    expect(a.size()).toBe(1);
    expect(b.size()).toBe(1);
  });
});
