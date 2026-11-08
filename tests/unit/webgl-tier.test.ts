import { describe, it, expect, beforeEach } from 'vitest';
import { isSoftwareRenderer, detectWebGL, SOFTWARE_RENDERER } from '../../src/lib/three/webgl-tier';

describe('isSoftwareRenderer', () => {
  it.each([
    'SwiftShader Device (Subzero) 1.4',
    'llvmpipe (LLVM 15.0)',
    'ANGLE (Microsoft Basic Render Driver, D3D11)',
    'Mesa Offscreen',
    'SoftPipe',
    'Software Renderer',
  ])('detects software renderer: %s', (name) => {
    expect(isSoftwareRenderer(name)).toBe(true);
  });

  it.each([
    'NVIDIA GeForce RTX 4070',
    'Apple M2',
    'AMD Radeon RX 7800 XT',
    '',
  ])('does not flag hardware renderer: %s', (name) => {
    expect(isSoftwareRenderer(name)).toBe(false);
  });
});

describe('SOFTWARE_RENDERER regex', () => {
  it('is case-insensitive', () => {
    expect(SOFTWARE_RENDERER.test('SWIFTSHADER')).toBe(true);
  });
});

describe('detectWebGL', () => {
  beforeEach(() => {
    // jsdom has no WebGL; ensure global canvas mock returns null
  });

  it('returns none/software (never hardware) when no WebGL context', () => {
    // In a headless Node environment document.createElement('canvas')
    // still exists (jsdom), getContext returns null → tier must not be hardware.
    const tier = detectWebGL();
    expect(['none', 'software']).toContain(tier);
  });

  it('respects allowSoftware flag shape without throwing', () => {
    expect(() => detectWebGL({ allowSoftware: true })).not.toThrow();
    expect(() => detectWebGL({ allowSoftware: false })).not.toThrow();
  });
});
