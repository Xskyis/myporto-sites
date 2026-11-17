import { afterEach, expect, it, vi } from 'vitest';

const renderer = vi.hoisted(() => vi.fn());
vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: renderer,
}));
import { initPortrait } from '../../src/lib/three/portrait';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('passes cancellation to the point download', async () => {
  const abort = new AbortController();
  const fetchPoints = vi.fn((_url, init) => {
    expect(init.signal).toBe(abort.signal);
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  });
  vi.stubGlobal('fetch', fetchPoints);
  await expect(initPortrait({} as HTMLCanvasElement, {
    reduced: true, tilt: false, signal: abort.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(renderer).not.toHaveBeenCalled();
});

it('does not allocate a renderer if navigation cancels while the body is read', async () => {
  const abort = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => {
      abort.abort();
      return new ArrayBuffer(30000 * 8);
    },
  })));
  await expect(initPortrait({} as HTMLCanvasElement, {
    reduced: true, tilt: false, signal: abort.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(renderer).not.toHaveBeenCalled();
});
