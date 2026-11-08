/**
 * Pure scroll math — no DOM, no Lenis, no GSAP. Exported for unit tests.
 *
 * Single owner of easing/duration so the wheel instance and programmatic
 * `scrollToTarget()` can never drift apart again.
 */

/** Exponential easeOut (Lenis default shape): fast start, long soft tail. */
export const LENIS_EASE = (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t));

/** Fallback duration for programmatic scrolls (distance-based wins below). */
export const LENIS_SCROLL_DURATION = 1.15;

/** Wheel `lerp` intensity. Frame-rate independent damping, tighter than duration mode. */
export const LENIS_LERP = 0.09;

/** Wheel multiplier — 1 = passthrough, <1 slightly finer for trackpads. */
export const WHEEL_MULTIPLIER = 0.95;

export interface DistanceDurationOptions {
  min?: number;
  max?: number;
  /** Seconds per 1000px of travel. Default keeps short hops snappy. */
  perKilopixel?: number;
}

/**
 * Distance-based programmatic duration. A fixed 1.4s for both a 600px hop
 * and a 3000px jump feels floaty on one end and rushed on the other.
 * Returns a clamped value in `[min, max]`.
 */
export function durationForDistance(
  distancePx: number,
  opts: DistanceDurationOptions = {},
): number {
  const min = opts.min ?? 0.7;
  const max = opts.max ?? 1.6;
  const perKilopixel = opts.perKilopixel ?? 0.45;
  const d = Math.abs(distancePx);
  const raw = min + (d / 1000) * perKilopixel;
  // Below min distance we still honour min so tiny hops don't look instant-jittery.
  return Math.min(max, Math.max(min, raw));
}

/**
 * Parse `--header-height` CSS var value ("80px") into a scroll offset.
 * The offset is negative (land *above* the element, below the fixed header)
 * with a 5px breathing gap, matching historical behaviour.
 * Pure + testable; callers feed it the raw computed-style string.
 */
export function headerOffsetFromVar(raw: string | null | undefined): number {
  const px = parseInt(raw || '80px', 10);
  const height = Number.isFinite(px) ? px : 80;
  return -(height - 5);
}

export interface PointerCaps {
  fine: boolean;
  coarse: boolean;
}

export interface LenisUseInput extends PointerCaps {
  reducedMotion: boolean;
}

/**
 * Decide whether to initialise Lenis at all.
 * - `prefers-reduced-motion` → never hijack scroll.
 * - coarse-only pointers (phones/tablets without a fine pointer) → keep the
 *   native momentum scroll; Lenis on touch is rubber-bandy and costs battery.
 *   Hybrids (touch laptops, iPad + mouse) report `fine`, so they still get Lenis.
 */
export function shouldUseLenis(input: LenisUseInput): boolean {
  if (input.reducedMotion) return false;
  const coarseOnly = input.coarse && !input.fine;
  return !coarseOnly;
}

/**
 * Animation duration for numeric stat counters.
 * Target 1 ("1+ yrs", "1st") has no intermediate integers, so it counts swiftly
 * (0.35s) without lingering awkwardly at 0. Larger numbers scale progressively
 * to showcase fluid counting motion.
 */
export function counterDuration(target: number): number {
  if (target <= 1) return 0.35;
  if (target <= 9) return 0.6;
  if (target <= 99) return 1.2;
  return 1.8;
}
