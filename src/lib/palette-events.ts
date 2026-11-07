/**
 * Wire a callback that reacts to palette/tone changes (mono↔color, light↔dark).
 *
 * The Navbar dispatches a `palette-change` CustomEvent on explicit clicks, but the visual
 * state (`html[data-palette]`, `html.dark`) can also flip without that event — the inline
 * bootstrap re-runs after every View Transition swap, and attribute edits from devtools or
 * other code bypass the event entirely. Consumers therefore observe those attributes too.
 * portrait.ts and ballpit.ts used to duplicate this event + MutationObserver pair; this is
 * the single implementation.
 *
 * Returns a disposer. If an `AbortSignal` is passed, the listeners die with it and the
 * disposer becomes a no-op safety call.
 */
export function onPaletteChange(
  callback: () => void,
  signal?: AbortSignal,
): () => void {
  const html = document.documentElement;
  const readStateKey = () =>
    `${html.getAttribute('data-palette') || 'mono'}:${html.classList.contains('dark') ? 'dark' : 'light'}`;

  let lastKey = readStateKey();
  const handleTrigger = () => {
    const nextKey = readStateKey();
    if (nextKey === lastKey) return;
    lastKey = nextKey;
    callback();
  };

  window.addEventListener('palette-change', handleTrigger, { signal });

  const observer = new MutationObserver(handleTrigger);
  observer.observe(html, {
    attributes: true,
    attributeFilter: ['data-palette', 'class'],
  });
  if (signal) {
    signal.addEventListener('abort', () => observer.disconnect());
  }

  return () => {
    window.removeEventListener('palette-change', handleTrigger);
    observer.disconnect();
  };
}
