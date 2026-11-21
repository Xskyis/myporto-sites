// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE } from '../../src/data/profile';
import { setupFooter } from '../../src/lib/footer';

const lenis = vi.hoisted(() => ({ scrollTo: vi.fn() }));
vi.mock('../../src/lib/scroll/lenis', () => ({ getLenis: () => lenis }));

let clipboardWrite: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  lenis.scrollTo.mockClear();
  clipboardWrite = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboardWrite } });
  document.body.innerHTML = `
    <main id="main-content" tabindex="-1"></main>
    <a id="back-to-top-btn" href="#main-content">Back to top</a>
    <a href="mailto:${PROFILE.email}">Email</a>
    <button id="copy-email-btn" hidden><svg id="copy-icon"></svg><svg id="copy-check-icon" class="hidden"></svg><span id="copy-text" aria-live="polite" aria-atomic="true">Copy email</span></button>`;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('footer enhancement lifecycle', () => {
  it('keeps the copy control unavailable when Clipboard API is missing', () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const cleanup = setupFooter();

    expect((document.getElementById('copy-email-btn') as HTMLButtonElement).hidden).toBe(true);
    expect(document.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')).not.toBeNull();
    cleanup();
  });

  it('reveals copy only when supported and focuses main when scrolling to top', () => {
    const cleanup = setupFooter();
    const main = document.getElementById('main-content')!;
    const copy = document.getElementById('copy-email-btn') as HTMLButtonElement;
    expect(copy.hidden).toBe(false);

    document.getElementById('back-to-top-btn')!.click();

    expect(document.activeElement).toBe(main);
    expect(lenis.scrollTo).toHaveBeenCalledWith(0, { duration: 1.1 });
    cleanup();
    expect(copy.hidden).toBe(true);
  });

  it('reports clipboard denial and ignores a permission result after teardown', async () => {
    clipboardWrite.mockRejectedValueOnce(new Error('denied'));
    const cleanup = setupFooter();
    const button = document.getElementById('copy-email-btn') as HTMLButtonElement;
    const message = document.getElementById('copy-text')!;
    button.click();
    await vi.waitFor(() => expect(message.textContent).toContain('Copy failed'));

    let resolveWrite!: () => void;
    clipboardWrite.mockReturnValueOnce(new Promise<void>((resolve) => { resolveWrite = resolve; }));
    button.click();
    cleanup();
    resolveWrite();
    await Promise.resolve();

    expect(message.textContent).toBe('Copy email');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('copies the configured email and restores the idle label', async () => {
    const cleanup = setupFooter();
    const button = document.getElementById('copy-email-btn') as HTMLButtonElement;
    const message = document.getElementById('copy-text')!;
    button.click();
    await vi.waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith(PROFILE.email));
    await vi.waitFor(() => expect(message.textContent).toBe('Copied to clipboard!'));
    await vi.advanceTimersByTimeAsync(2500);
    expect(message.textContent).toBe('Copy email');
    cleanup();
  });
});
