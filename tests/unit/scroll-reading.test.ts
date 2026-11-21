// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const motion = vi.hoisted(() => ({
  reduced: false,
  profile: null as null | ((context: { conditions: { reduced: boolean; mobile: boolean } }) => void | (() => void)),
  disposeProfile: null as null | (() => void),
  tweens: [] as Array<{ progress: (value: number) => unknown }>,
  sleep: null as null | (() => void),
}));

// Keep the real CSSPlugin, SplitText and context reversion. Only the media-query
// driver and scroll clock are controlled, so these tests exercise actual styles.
vi.mock('gsap', async () => {
  const { gsap: actual } = await vi.importActual<typeof import('gsap')>('gsap');
  motion.sleep = () => actual.ticker.sleep();
  return { gsap: {
    registerPlugin: (...plugins: Parameters<typeof actual.registerPlugin>) => {
      actual.registerPlugin(...plugins.filter((plugin) => 'name' in plugin));
    },
    matchMedia: () => ({
      add: (_queries: unknown, callback: NonNullable<typeof motion.profile>) => {
        motion.profile = callback;
        motion.disposeProfile = callback({ conditions: { reduced: motion.reduced, mobile: false } }) || null;
      },
      revert: () => motion.disposeProfile?.(),
    }),
    context: actual.context,
    set: actual.set,
    to: (target: Parameters<typeof actual.to>[0], vars: Parameters<typeof actual.to>[1]) => {
      const { scrollTrigger: _scrollClock, ...animation } = vars;
      const tween = actual.to(target, { ...animation, paused: true });
      motion.tweens.push(tween);
      return tween;
    },
  } };
});
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }));
vi.mock('../../src/lib/palette-events', () => ({ onPaletteChange: vi.fn() }));
vi.mock('../../src/lib/scroll/lenis', () => ({ getLenis: () => null }));

import { initScrollAnimations } from '../../src/lib/scroll/animations';

describe('readable desktop bio illumination', () => {
  let dispose: (() => void) | undefined;
  let original: string;

  beforeEach(() => {
    motion.reduced = false;
    motion.profile = null;
    motion.disposeProfile = null;
    motion.tweens.length = 0;
    document.body.innerHTML = '<div data-reading-illuminate><p>Readable words at every scroll position.</p><p>Final paragraph stays accessible.</p></div>';
    original = document.body.innerHTML;
    vi.stubGlobal('matchMedia', () => ({ matches: motion.reduced }));
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    motion.sleep?.();
    document.documentElement.removeAttribute('style');
    vi.unstubAllGlobals();
  });

  it('keeps full-opacity text throughout the actual staggered color tween', () => {
    dispose = initScrollAnimations();
    const words = Array.from(document.querySelectorAll<HTMLElement>('.reading-word'));
    expect(words.length).toBeGreaterThan(1);
    expect(motion.tweens).toHaveLength(2);

    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      motion.tweens.forEach((tween) => tween.progress(progress));
      for (const word of words) {
        expect(word.style.opacity || '1').toBe('1');
        expect(word.style.color).toBe('color-mix(in srgb, var(--text-muted), var(--text-primary) var(--reading-highlight, 0%))');
        const highlight = parseFloat(word.style.getPropertyValue('--reading-highlight'));
        expect(highlight).toBeGreaterThanOrEqual(0);
        expect(highlight).toBeLessThanOrEqual(100);
      }
    }
    words.forEach((word) => expect(word.style.getPropertyValue('--reading-highlight')).toBe('100%'));
  });

  it('retains live palette token references at the current scroll progress', () => {
    dispose = initScrollAnimations();
    motion.tweens.forEach((tween) => tween.progress(0.5));
    const word = document.querySelector<HTMLElement>('.reading-word')!;
    const highlight = word.style.getPropertyValue('--reading-highlight');

    document.documentElement.style.setProperty('--text-muted', '#E2D99E');
    document.documentElement.style.setProperty('--text-primary', '#FDEEA9');

    expect(word.style.color).toContain('var(--text-muted)');
    expect(word.style.color).toContain('var(--text-primary)');
    expect(word.style.getPropertyValue('--reading-highlight')).toBe(highlight);
    expect(motion.tweens).toHaveLength(2);
  });

  it('restores the unsplit readable HTML when reduced motion interrupts the profile', () => {
    dispose = initScrollAnimations();
    motion.tweens.forEach((tween) => tween.progress(0.4));
    expect(document.querySelector('.reading-word')).not.toBeNull();

    motion.disposeProfile?.();
    motion.reduced = true;
    motion.disposeProfile = motion.profile!({ conditions: { reduced: true, mobile: false } }) || null;

    expect(document.body.innerHTML).toBe(original);
    expect(document.querySelector('.reading-word')).toBeNull();
  });

  it('leaves the original text intact when the page starts with reduced motion', () => {
    motion.reduced = true;
    dispose = initScrollAnimations();
    expect(document.body.innerHTML).toBe(original);
    expect(motion.tweens).toHaveLength(0);
  });
});
