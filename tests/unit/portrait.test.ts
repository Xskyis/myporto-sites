import { describe, it, expect } from 'vitest';
import { decodePoints, makeRandoms } from '../../src/lib/three/portrait';
import meta from '../../src/data/portrait-points.meta.json';

describe('portrait decodePoints', () => {
  it('decodes uint16 bounds exactly at extremes', () => {
    // 2 points: min and max of each channel
    const buf = new ArrayBuffer(2 * 4 * 2);
    const u16 = new Uint16Array(buf);
    u16.set([0, 0, 0, 0, 65535, 65535, 65535, 65535]);
    const { positions, tones } = decodePoints(buf, 2);
    expect(positions[0]).toBeCloseTo(meta.bounds.x[0], 6);
    expect(positions[1]).toBeCloseTo(meta.bounds.y[0], 6);
    expect(positions[3]).toBeCloseTo(meta.bounds.x[1], 6);
    expect(tones[0]).toBeCloseTo(meta.bounds.tone[0], 6);
    expect(tones[1]).toBeCloseTo(meta.bounds.tone[1], 6);
  });

  it('applies hair-silhouette cap (y clamped near crown parabola)', () => {
    // x=0.095 maps near center; craft a point far above yCap
    // Use raw values that decode to x≈0.095, y>>yCap
    const count = 1;
    const buf = new ArrayBuffer(count * 4 * 2);
    const u16 = new Uint16Array(buf);
    const [xLo, xHi] = meta.bounds.x as unknown as [number, number];
    const [yLo, yHi] = meta.bounds.y as unknown as [number, number];
    const enc = (v: number, lo: number, hi: number) =>
      Math.round(((v - lo) / (hi - lo)) * 65535);
    // x = 0.095, y = 0.47 (well above yCap ≈ 0.446 at dx=0)
    u16[0] = enc(0.095, xLo, xHi);
    u16[1] = enc(0.47, yLo, yHi);
    u16[2] = enc(0, -0.12, 0.12);
    u16[3] = enc(0.5, 0, 1);
    const { positions } = decodePoints(buf, count);
    const yCap = 0.446 - 1.8 * Math.pow(positions[0] - 0.095, 2);
    expect(positions[1]).toBeLessThanOrEqual(yCap + 1e-9);
    expect(positions[1]).toBeGreaterThan(yCap - 0.02);
  });

  it('returns correct-sized buffers', () => {
    const buf = new ArrayBuffer(10 * 4 * 2);
    const { positions, tones } = decodePoints(buf, 10);
    expect(positions.length).toBe(10 * 3);
    expect(tones.length).toBe(10);
  });
});

describe('portrait makeRandoms', () => {
  it('is deterministic for the same seed', () => {
    const a = makeRandoms(100, 1337);
    const b = makeRandoms(100, 1337);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('produces values in [0, 1)', () => {
    const r = makeRandoms(1000);
    for (const v of r) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs for different seeds', () => {
    const a = makeRandoms(50, 1);
    const b = makeRandoms(50, 2);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('produces count*3 values', () => {
    expect(makeRandoms(7).length).toBe(21);
  });
});

describe('portrait meta invariants', () => {
  it('mobileCount is a prefix slice of count', () => {
    expect(meta.mobileCount).toBeLessThan(meta.count);
    expect(meta.mobileCount).toBeGreaterThan(0);
    expect(meta.count).toBe(69961);
  });

  it('aspect ratio is positive and portrait-like', () => {
    expect(meta.aspect).toBeGreaterThan(0.5);
    expect(meta.aspect).toBeLessThan(2);
  });
});
