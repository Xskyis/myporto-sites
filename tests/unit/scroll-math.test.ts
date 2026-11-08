import { describe, it, expect } from 'vitest';
import {
  LENIS_EASE,
  LENIS_SCROLL_DURATION,
  durationForDistance,
  headerOffsetFromVar,
  shouldUseLenis,
} from '../../src/lib/scroll/scroll-math';

describe('LENIS_EASE', () => {
  it('starts near 0 (≈0.001 due to 1.001 coef) and ends at 1', () => {
    // Lenis easing: Math.min(1, 1.001 - 2^-10t) → f(0)=0.001, f(1)=1
    expect(LENIS_EASE(0)).toBeCloseTo(0.001, 6);
    expect(LENIS_EASE(1)).toBe(1);
  });

  it('is monotonic increasing', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const v = LENIS_EASE(i / 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('fast start: >50% progress in first 25% of time', () => {
    expect(LENIS_EASE(0.25)).toBeGreaterThan(0.5);
  });
});

describe('durationForDistance', () => {
  it('zero distance equals min, short hops grow from min', () => {
    expect(durationForDistance(0)).toBe(0.7);
    // 200px → 0.7 + 0.2*0.45 = 0.79
    expect(durationForDistance(200)).toBeCloseTo(0.79, 6);
  });

  it('grows with distance', () => {
    const short = durationForDistance(500);
    const long = durationForDistance(2000);
    expect(long).toBeGreaterThan(short);
  });

  it('clamps long jumps to max (1.6)', () => {
    expect(durationForDistance(10000)).toBe(1.6);
  });

  it('known values: 1000px → 1.15s', () => {
    // 0.7 + (1000/1000)*0.45 = 1.15 — matches LENIS_SCROLL_DURATION
    expect(durationForDistance(1000)).toBeCloseTo(1.15, 6);
    expect(durationForDistance(1000)).toBeCloseTo(LENIS_SCROLL_DURATION, 6);
  });

  it('uses absolute distance (direction independent)', () => {
    expect(durationForDistance(-1500)).toBe(durationForDistance(1500));
  });

  it('respects custom min (zero distance) and max (long distance)', () => {
    expect(durationForDistance(0, { min: 0.3, max: 1.0 })).toBe(0.3);
    expect(durationForDistance(99999, { min: 0.3, max: 1.0 })).toBe(1.0);
  });

  it('custom perKilopixel scales slope', () => {
    // 0.7 + 1.0*1.0 = 1.7, clamped to max 1.6
    expect(durationForDistance(1000, { perKilopixel: 1.0 })).toBe(1.6);
    expect(durationForDistance(500, { perKilopixel: 1.0 })).toBeCloseTo(1.2, 6);
  });
});

describe('headerOffsetFromVar', () => {
  it('80px → -75', () => {
    expect(headerOffsetFromVar('80px')).toBe(-75);
  });

  it('null/undefined/empty → fallback -75', () => {
    expect(headerOffsetFromVar(null)).toBe(-75);
    expect(headerOffsetFromVar(undefined)).toBe(-75);
    expect(headerOffsetFromVar('')).toBe(-75);
  });

  it('100px → -95', () => {
    expect(headerOffsetFromVar('100px')).toBe(-95);
  });

  it('non-numeric → fallback -75', () => {
    expect(headerOffsetFromVar('abc')).toBe(-75);
  });

  it('matches LENIS_SCROLL_DURATION sanity (positive durations only)', () => {
    expect(LENIS_SCROLL_DURATION).toBeGreaterThan(0);
    expect(LENIS_SCROLL_DURATION).toBeLessThan(2);
  });
});

describe('shouldUseLenis', () => {
  it('true for desktop fine pointer, no reduced motion', () => {
    expect(shouldUseLenis({ fine: true, coarse: false, reducedMotion: false })).toBe(true);
  });

  it('false for reduced motion even with fine pointer', () => {
    expect(shouldUseLenis({ fine: true, coarse: false, reducedMotion: true })).toBe(false);
  });

  it('false for coarse-only (phone/tablet without mouse)', () => {
    expect(shouldUseLenis({ fine: false, coarse: true, reducedMotion: false })).toBe(false);
  });

  it('true for hybrids (fine + coarse, e.g. touch laptop)', () => {
    expect(shouldUseLenis({ fine: true, coarse: true, reducedMotion: false })).toBe(true);
  });

  it('true for no-pointer signals (SSR / unknown)', () => {
    expect(shouldUseLenis({ fine: false, coarse: false, reducedMotion: false })).toBe(true);
  });
});
