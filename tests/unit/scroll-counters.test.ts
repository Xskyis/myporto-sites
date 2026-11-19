// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  profile: null as null | ((context: { conditions: { reduced: boolean; mobile: boolean } }) => void | (() => void)),
  disposeProfile: null as null | (() => void),
  reduced: false,
  tweens: [] as Array<{ target: { val: number }; vars: { onUpdate: () => void; onComplete: () => void } }>,
}));

vi.mock('gsap', () => ({
  gsap: {
    registerPlugin: vi.fn(),
    matchMedia: () => ({
      add: (_queries: unknown, callback: NonNullable<typeof mocks.profile>) => {
        mocks.profile = callback;
        mocks.disposeProfile = callback({ conditions: { reduced: mocks.reduced, mobile: false } }) || null;
      },
      revert: () => mocks.disposeProfile?.(),
    }),
    context: (callback: () => void) => { callback(); return { revert: vi.fn() }; },
    to: (target: { val: number }, vars: typeof mocks.tweens[number]['vars']) => {
      mocks.tweens.push({ target, vars });
    },
  },
}));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }));
vi.mock('gsap/SplitText', () => ({ SplitText: {} }));
vi.mock('../../src/lib/palette-events', () => ({ onPaletteChange: vi.fn() }));
vi.mock('../../src/lib/scroll/lenis', () => ({ getLenis: () => null }));

import { initScrollAnimations } from '../../src/lib/scroll/animations';

function values() {
  return Array.from(document.querySelectorAll('[data-counter-target]'), (el) => el.textContent);
}

describe('stat counters and motion profiles', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    mocks.profile = null;
    mocks.disposeProfile = null;
    mocks.reduced = false;
    mocks.tweens.length = 0;
    document.body.innerHTML = '<span data-counter-target="57">57</span><span data-counter-target="1">1</span><span data-counter-target="1">1</span>';
    vi.stubGlobal('matchMedia', () => ({ matches: mocks.reduced }));
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.unstubAllGlobals();
  });

  it('preserves final HTML values without starting counter tweens for reduced motion', () => {
    mocks.reduced = true;
    dispose = initScrollAnimations();
    expect(values()).toEqual(['57', '1', '1']);
    expect(mocks.tweens).toHaveLength(0);
  });

  it('animates from zero for the motion profile and reaches each final value', () => {
    dispose = initScrollAnimations();
    expect(values()).toEqual(['0', '0', '0']);
    const first = mocks.tweens[0];
    first.target.val = 28.5;
    first.vars.onUpdate();
    expect(values()[0]).toBe('29');
    mocks.tweens.forEach(({ vars }) => vars.onComplete());
    expect(values()).toEqual(['57', '1', '1']);
  });

  it('restores final values when reduced motion interrupts unfinished counters', () => {
    dispose = initScrollAnimations();
    mocks.tweens[0].target.val = 12;
    mocks.tweens[0].vars.onUpdate();
    expect(values()[0]).toBe('12');
    mocks.disposeProfile?.();
    mocks.reduced = true;
    mocks.disposeProfile = mocks.profile!({ conditions: { reduced: true, mobile: false } }) || null;
    expect(values()).toEqual(['57', '1', '1']);
    expect(mocks.tweens).toHaveLength(3);
  });
});
