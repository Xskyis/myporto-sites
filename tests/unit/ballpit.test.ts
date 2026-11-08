import { describe, it, expect } from 'vitest';
import {
  stepBalls,
  FIXED_DT,
  GRAVITY,
  BALL_RESTITUTION,
  type Ball,
} from '../../src/lib/three/ballpit';

const BOUNDS = { floor: -5, left: -10, right: 10 };

function ball(overrides: Partial<Ball> = {}): Ball {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, r: 0.5, ...overrides };
}

describe('ballpit stepBalls', () => {
  it('applies gravity and damping over one fixed step', () => {
    const b = ball({ y: 5 });
    stepBalls([b], FIXED_DT, BOUNDS);
    // gravity accelerates downward, damping shrinks speed slightly
    expect(b.vy).toBeLessThan(0);
    expect(b.vy).toBeCloseTo(GRAVITY * FIXED_DT * (1 - 0.35 * FIXED_DT), 2);
    expect(b.y).toBeLessThan(5);
  });

  it('clamps ball to floor and bounces with restitution', () => {
    const b = ball({ y: BOUNDS.floor + b_r() - 0.01, vy: -3, r: 0.5 });
    function b_r() {
      return 0.5;
    }
    stepBalls([b], FIXED_DT, BOUNDS);
    expect(b.y).toBeCloseTo(BOUNDS.floor + b.r, 6);
    // vy reflected (negative -> positive scaled by WALL_RESTITUTION)
    expect(b.vy).toBeGreaterThan(0);
  });

  it('clamps ball to left/right walls', () => {
    const left = ball({ x: BOUNDS.left + 0.4, vx: -5 });
    const right = ball({ x: BOUNDS.right - 0.4, vx: 5, y: 3 });
    stepBalls([left, right], FIXED_DT, BOUNDS);
    expect(left.x).toBeCloseTo(BOUNDS.left + left.r, 6);
    expect(right.x).toBeCloseTo(BOUNDS.right - right.r, 6);
  });

  it('separates overlapping balls without overlap after step', () => {
    const a = ball({ x: -0.3, y: 2 });
    const b = ball({ x: 0.3, y: 2 });
    stepBalls([a, b], FIXED_DT, BOUNDS);
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    expect(dist).toBeGreaterThanOrEqual(a.r + b.r - 1e-6);
    // positional correction is symmetric for equal masses
    expect(Math.abs(a.x + b.x) / 2).toBeCloseTo(0, 2);
  });

  it('different radii split correction by mass (r^2)', () => {
    const small = ball({ x: -0.1, y: 2, r: 0.3 });
    const big = ball({ x: 0.1, y: 2, r: 0.9 });
    stepBalls([small, big], FIXED_DT, BOUNDS);
    // Heavier ball moves less than the lighter one
    const moveSmall = Math.abs(small.x - -0.1);
    const moveBig = Math.abs(big.x - 0.1);
    expect(moveSmall).toBeGreaterThan(moveBig);
  });

  it('applies impulse when balls approach each other', () => {
    // Overlap initially (dist 0.6 < r1+r2 1.0) and velocities towards each other
    const a = ball({ x: -0.3, y: 2, vx: 2 });
    const b = ball({ x: 0.3, y: 2, vx: -2 });
    stepBalls([a, b], FIXED_DT, BOUNDS);
    // With restitution 0.45 the relative velocity reverses sign
    const rel = (b.vx - a.vx);
    expect(rel).toBeGreaterThan(0);
    expect(BALL_RESTITUTION).toBe(0.45);
  });

  it('does not apply impulse when already separating', () => {
    const a = ball({ x: -0.4, y: 2, vx: -1 });
    const b = ball({ x: 0.4, y: 2, vx: 1 });
    const before = (b.vx - a.vx);
    stepBalls([a, b], FIXED_DT, BOUNDS);
    const after = (b.vx - a.vx);
    // Only damping shrinks relative velocity, no impulse reversal
    expect(after).toBeLessThanOrEqual(Math.abs(before));
  });

  it('ignores zero-distance pairs (no NaN)', () => {
    const a = ball({ x: 0, y: 2 });
    const b = ball({ x: 0, y: 2 });
    stepBalls([a, b], FIXED_DT, BOUNDS);
    expect(Number.isFinite(a.x)).toBe(true);
    expect(Number.isFinite(b.x)).toBe(true);
    expect(Number.isFinite(a.vx)).toBe(true);
  });

  it('caps speed at MAX_SPEED', () => {
    const b = ball({ vx: 100, vy: 100, y: 3 });
    stepBalls([b], FIXED_DT, BOUNDS);
    const speed = Math.hypot(b.vx, b.vy);
    expect(speed).toBeLessThanOrEqual(25.001);
  });
});
