// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusNavigationTarget, setupMobileMenu } from '../../src/lib/scroll/navbar-menu';
import { scrollLock } from '../../src/lib/scroll/scroll-lock';

const animation = vi.hoisted(() => ({
  complete: [] as Array<() => void>,
  to: vi.fn((_target: unknown, vars: { onComplete?: () => void }) => {
    if (vars.onComplete) animation.complete.push(vars.onComplete);
  }),
  fromTo: vi.fn(),
  set: vi.fn(),
  killTweensOf: vi.fn(),
}));

vi.mock('gsap', () => ({ gsap: animation }));

class MediaQuery extends EventTarget {
  matches = false;
  change(matches: boolean) {
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }
}

let desktop: MediaQuery;
let reduced: MediaQuery;
let abort: AbortController;

beforeEach(() => {
  vi.clearAllMocks();
  animation.complete.length = 0;
  desktop = new MediaQuery();
  reduced = new MediaQuery();
  abort = new AbortController();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => query.includes('min-width') ? desktop : reduced));
  document.body.innerHTML = `
    <button id="menu-button" aria-expanded="false">
      <span class="menu-icon-open"></span><span class="menu-icon-close hidden"></span>
    </button>
    <div id="menu" class="hidden" aria-hidden="true">
      <a href="#about" class="mobile-nav-link" data-section="about">About</a><a href="#projects" class="mobile-nav-link" data-section="projects">Projects</a>
    </div>
    <a href="/#about" class="nav-link" data-section="about">Desktop About</a><a href="/#projects" class="nav-link" data-section="projects">Desktop Projects</a>
    <section id="about"><h2>About</h2><a href="/credential">Credential</a></section>
    <section id="projects" tabindex="0"><h2>Projects</h2></section>`;
});

afterEach(() => {
  abort.abort();
  scrollLock.reset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const menu = document.getElementById('menu')!;
  const button = document.getElementById('menu-button')!;
  const onStateChange = vi.fn();
  const controller = setupMobileMenu({ menu, button, signal: abort.signal, onStateChange });
  return { ...controller, menu, button, onStateChange };
}

describe('mobile navbar lifecycle', () => {
  it('closes and unlocks at the desktop breakpoint without focusing the hidden toggle', () => {
    const { menu, button } = mount();
    button.click();
    expect(scrollLock.isLocked()).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(menu.querySelector('a'));
    const focus = vi.spyOn(button, 'focus');

    desktop.change(true);

    expect(menu.classList.contains('hidden')).toBe(true);
    expect(menu.classList.contains('flex')).toBe(false);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Open Navigation Menu');
    expect(button.querySelector('.menu-icon-open')?.classList.contains('hidden')).toBe(false);
    expect(button.querySelector('.menu-icon-close')?.classList.contains('hidden')).toBe(true);
    expect(scrollLock.isLocked()).toBe(false);
    expect(document.documentElement.classList.contains('overflow-hidden')).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(animation.killTweensOf).toHaveBeenLastCalledWith(menu);
  });

  it('moves focus from the now-hidden mobile link to its matching desktop section link', () => {
    const { menu, button } = mount();
    button.click();
    const mobileProjects = menu.querySelector<HTMLElement>('[data-section="projects"]')!;
    const desktopProjects = document.querySelector<HTMLElement>('.nav-link[data-section="projects"]')!;
    const focus = vi.spyOn(desktopProjects, 'focus');
    mobileProjects.focus();
    expect(document.activeElement).toBe(mobileProjects);

    desktop.change(true);

    expect(menu.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(desktopProjects);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('invalidates an in-flight close completion when the viewport becomes desktop', () => {
    const { close, menu, button } = mount();
    button.click();
    const onComplete = vi.fn();
    close({ onComplete });
    const finish = animation.complete[0];
    const focus = vi.spyOn(button, 'focus');

    desktop.change(true);
    finish();

    expect(menu.classList.contains('hidden')).toBe(true);
    expect(scrollLock.isLocked()).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('does not hide a reopened menu when an older tween completes', () => {
    const { close, menu, button } = mount();
    button.click();
    close();
    const finish = animation.complete[0];
    button.click();
    finish();
    expect(menu.classList.contains('hidden')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(scrollLock.isLocked()).toBe(true);
  });

  it('kills pending animation and listeners on page teardown and rejects late completion', () => {
    const { close, menu, button, onStateChange } = mount();
    button.click();
    const onComplete = vi.fn();
    close({ onComplete });
    const finish = animation.complete[0];
    abort.abort();
    const changesAfterAbort = onStateChange.mock.calls.length;

    finish();
    button.click();
    desktop.change(true);

    expect(animation.killTweensOf).toHaveBeenLastCalledWith(menu);
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(scrollLock.isLocked()).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledTimes(changesAfterAbort);
  });

  it('opens and closes immediately with reduced motion', () => {
    reduced.matches = true;
    const { menu, button } = mount();
    button.click();
    expect(menu.classList.contains('hidden')).toBe(false);
    expect(animation.set).toHaveBeenCalledWith(menu, { opacity: 1, y: 0 });
    button.click();
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(scrollLock.isLocked()).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(animation.fromTo).not.toHaveBeenCalled();
    expect(animation.to).not.toHaveBeenCalled();
  });

  it('finishes an in-flight opening tween when reduced motion becomes active', () => {
    const { menu, button } = mount();
    button.click();
    expect(animation.fromTo).toHaveBeenCalledOnce();
    expect(scrollLock.isLocked()).toBe(true);

    reduced.change(true);

    expect(animation.killTweensOf).toHaveBeenLastCalledWith(menu);
    expect(animation.set).toHaveBeenLastCalledWith(menu, { opacity: 1, y: 0 });
    expect(menu.classList.contains('hidden')).toBe(false);
    expect(menu.getAttribute('aria-hidden')).toBe('false');
    expect(scrollLock.isLocked()).toBe(true);
  });

  it('finishes an in-flight closing tween immediately when reduced motion becomes active', () => {
    const { close, menu, button } = mount();
    button.click();
    close();
    const closingCompletion = animation.complete[0];
    expect(menu.classList.contains('hidden')).toBe(false);

    reduced.change(true);
    closingCompletion();

    expect(menu.classList.contains('hidden')).toBe(true);
    expect(menu.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(scrollLock.isLocked()).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('hands focus to the navigation destination without a competing scroll', () => {
    const { close, menu, button } = mount();
    const target = document.getElementById('about')!;
    const focus = vi.spyOn(target, 'focus');
    const scroll = vi.fn();
    button.click();
    close({ restoreFocus: false, onComplete: () => {
      focusNavigationTarget(target, abort.signal);
      scroll();
    } });
    expect(document.activeElement).toBe(menu.querySelector('a'));

    animation.complete[0]();

    expect(menu.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).toHaveBeenCalledOnce();
    target.querySelector('a')!.focus();
    expect(target.hasAttribute('tabindex')).toBe(false);
  });

  it('preserves authored tabindex and ignores stale or detached destinations', () => {
    const target = document.getElementById('projects')!;
    focusNavigationTarget(target, abort.signal);
    expect(document.activeElement).toBe(target);
    expect(target.getAttribute('tabindex')).toBe('0');
    abort.abort();
    const detached = document.createElement('section');
    const detachedFocus = vi.spyOn(detached, 'focus');
    focusNavigationTarget(detached, new AbortController().signal);
    const other = document.getElementById('about')!;
    const otherFocus = vi.spyOn(other, 'focus');
    focusNavigationTarget(other, abort.signal);
    expect(detachedFocus).not.toHaveBeenCalled();
    expect(otherFocus).not.toHaveBeenCalled();
    expect(other.hasAttribute('tabindex')).toBe(false);
  });

  it('removes a temporary destination tabindex if navigation tears down before blur', () => {
    const target = document.getElementById('about')!;
    focusNavigationTarget(target, abort.signal);
    expect(target.getAttribute('tabindex')).toBe('-1');
    abort.abort();
    expect(target.hasAttribute('tabindex')).toBe(false);
  });
});
