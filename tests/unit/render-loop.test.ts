import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRenderLoop } from '../../src/lib/three/render-loop';

let now = 0;
let nextId = 0;
let pending: Map<number, FrameRequestCallback>;
beforeEach(() => {
  now = 0;
  pending = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function tick(time: number) {
  now = time;
  const callbacks = [...pending.values()];
  pending.clear();
  callbacks.forEach((callback) => callback(time));
}

it('sleeps after a demand frame and wakes for a palette, scroll or resize invalidation', () => {
  const render = vi.fn();
  const loop = createRenderLoop(render, { fps: 30, continuous: false });
  loop.setActive(true);
  tick(0);
  expect(render).toHaveBeenCalledTimes(1);
  expect(pending.size).toBe(0);
  loop.invalidate();
  tick(1000);
  expect(render).toHaveBeenCalledTimes(2);
  expect(render.mock.calls[1][0]).toBeLessThanOrEqual(0.05);
  expect(pending.size).toBe(0);
  loop.dispose();
});

it('caps work on a 120 Hz screen and sleeps after pointer easing settles', () => {
  const render = vi.fn();
  const loop = createRenderLoop(render, { fps: 30, continuous: false });
  loop.setActive(true);
  loop.invalidate(1000);
  for (let i = 0; i <= 124; i++) tick(i * 1000 / 120);
  expect(render.mock.calls.length).toBeGreaterThanOrEqual(29);
  expect(render.mock.calls.length).toBeLessThanOrEqual(32);
  expect(pending.size).toBe(0);
  loop.dispose();
});

it('cancels frames while hidden and never wakes after disposal', () => {
  const render = vi.fn();
  const loop = createRenderLoop(render, { fps: 60, continuous: true });
  loop.setActive(true);
  tick(0);
  expect(pending.size).toBe(1);
  loop.setActive(false);
  loop.invalidate();
  tick(1000);
  expect(pending.size).toBe(0);
  expect(render).toHaveBeenCalledTimes(1);
  loop.setActive(true);
  tick(2000);
  expect(render).toHaveBeenCalledTimes(2);
  loop.dispose();
  loop.invalidate();
  loop.setActive(true);
  expect(pending.size).toBe(0);
});
