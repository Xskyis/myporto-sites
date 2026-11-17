// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor() { throw new Error('WebGL context unavailable'); }
    },
  };
});

import { initBallPit } from '../../src/lib/three/ballpit';

afterEach(() => vi.unstubAllGlobals());

it('propagates renderer failure so the component can show its fallback', () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  const wrapper = document.createElement('div');
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  expect(() => initBallPit(canvas)).toThrow('WebGL context unavailable');
});
