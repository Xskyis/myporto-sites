import { describe, it, expect } from 'vitest';
import {
  stepBalls,
  findHitBallIndex,
  stepBurstParticles,
  FIXED_DT,
  GRAVITY,
  FLOAT_GRAVITY,
  FLOAT_DAMPING,
  FLOAT_WALL_RESTITUTION,
  BALL_RESTITUTION,
  MAX_SPEED,
  type Ball,
  type BurstParticle,
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

  it('separates exactly coincident pairs without producing NaN', () => {
    const a = ball({ x: 0, y: 2 });
    const b = ball({ x: 0, y: 2 });
    stepBalls([a, b], FIXED_DT, BOUNDS);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(a.r + b.r - 1e-6);
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

  it('keeps collision impulses within the speed cap for unequal masses', () => {
    const heavy = ball({ x: -0.8, vx: MAX_SPEED, r: 0.84 });
    const light = ball({ x: 0.35, r: 0.44 });
    stepBalls([heavy, light], FIXED_DT, BOUNDS, 2, {
      gravity: FLOAT_GRAVITY,
      damping: FLOAT_DAMPING,
      wallRestitution: FLOAT_WALL_RESTITUTION,
      ceiling: 5,
    });
    expect(light.vx).toBeGreaterThan(0);
    for (const b of [heavy, light]) {
      expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
    }
  });

  it('supports buoyant floating mode with ceiling rebound', () => {
    const floater = ball({ x: 0, y: 4.8, vy: 4, r: 0.5 });
    stepBalls([floater], FIXED_DT, BOUNDS, 2, {
      gravity: FLOAT_GRAVITY,
      ceiling: 5,
      damping: FLOAT_DAMPING,
      wallRestitution: FLOAT_WALL_RESTITUTION,
    });
    expect(floater.y).toBeCloseTo(4.5, 5);
    expect(floater.vy).toBeLessThan(0);

    const suspended = ball({ x: 1, y: 1, vy: 0, r: 0.5 });
    stepBalls([suspended], FIXED_DT, BOUNDS, 2, {
      gravity: FLOAT_GRAVITY,
      ceiling: 5,
      damping: FLOAT_DAMPING,
      wallRestitution: FLOAT_WALL_RESTITUTION,
    });
    expect(suspended.y).toBeCloseTo(1, 5);
    expect(suspended.vy).toBe(0);
  });

  it('ignores popped balls during integration and collisions', () => {
    const popped = ball({ x: 0, y: 2, popTimer: 0.5 });
    const active = ball({ x: 0.2, y: 2 });
    stepBalls([popped, active], FIXED_DT, BOUNDS, 2);
    expect(popped.x).toBe(0);
    expect(popped.y).toBe(2);
    expect(active.x).toBeCloseTo(0.2, 6);
  });
});

describe('ballpit pop & burst helpers', () => {
  it('picks the front-most active ball under the pointer and skips popped balls', () => {
    const list: Ball[] = [
      ball({ x: 0, y: 0, z: -1, r: 0.8 }),
      ball({ x: 0.1, y: 0.1, z: 1.5, r: 0.8 }),
      ball({ x: 0.05, y: 0.05, z: 3, r: 0.8, popTimer: 0.6 }),
    ];
    expect(findHitBallIndex(list, 0, 0)).toBe(1);
    expect(findHitBallIndex(list, 5, 5)).toBe(-1);
  });

  it('advances burst particles until their life expires', () => {
    const particles: BurstParticle[] = [
      { x: 0, y: 1, z: 0, vx: 4, vy: 5, vz: 0, baseScale: 0.2, life: 1, maxLife: 0.2 },
    ];
    expect(stepBurstParticles(particles, 0.1)).toBe(true);
    expect(particles[0].x).toBeGreaterThan(0);
    expect(particles[0].life).toBeCloseTo(0.5, 5);
    expect(stepBurstParticles(particles, 0.15)).toBe(false);
    expect(particles[0].life).toBe(0);
  });
});
