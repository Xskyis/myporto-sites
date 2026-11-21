interface ThemeTransition {
  ready: Promise<void>;
  finished?: Promise<void>;
  updateCallbackDone?: Promise<void>;
  skipTransition?: () => void;
}

type ThemePointer = { clientX: number; clientY: number; detail?: number };

/** One page owns its theme effects; only the newest requested update may run. */
export function setupThemeTransition(signal: AbortSignal, reduced: MediaQueryList) {
  let current: { apply: () => void; cancel: () => void } | null = null;
  const cancel = () => current?.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  reduced.addEventListener('change', () => {
    if (!reduced.matches || !current) return;
    const pending = current;
    // Skipping a native transition still queues its update callback. Apply once now,
    // then invalidate that callback so the requested theme survives without motion.
    try { pending.apply(); } finally { pending.cancel(); }
  }, { signal });

  return (apply: () => void, event?: ThemePointer) => {
    cancel();
    if (signal.aborted) return;
    const doc = document as Document & {
      startViewTransition?: (update: () => void) => ThemeTransition;
    };
    if (!doc.startViewTransition || reduced.matches) {
      apply();
      return;
    }

    const root = document.documentElement;
    let applied = false;
    let transition: ThemeTransition | null = null;
    let animation: Animation | null = null;
    let timer: number | null = null;
    const owned = () => current === state && !signal.aborted;
    const applyOnce = () => {
      if (!owned() || applied) return;
      applied = true;
      apply();
    };
    const finish = (skip = false) => {
      if (current === state) {
        current = null;
        root.classList.remove('theme-transitioning');
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (skip) {
        try { transition?.skipTransition?.(); } catch {}
      }
      try { animation?.cancel(); } catch {}
      animation = null;
    };
    const state = { apply: applyOnce, cancel: () => finish(true) };
    current = state;
    root.classList.add('theme-transitioning');
    const x = event && event.detail !== 0 ? event.clientX : window.innerWidth / 2;
    const y = event && event.detail !== 0 ? event.clientY : window.innerHeight / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    try {
      transition = doc.startViewTransition(applyOnce);
      transition.updateCallbackDone?.catch(() => { if (owned()) finish(true); });
      transition.finished?.then(() => finish(), () => finish());
      transition.ready.then(() => {
        if (!owned() || reduced.matches) return;
        try {
          animation = root.animate({
            clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
          }, {
            duration: 500,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            pseudoElement: '::view-transition-new(root)',
          });
        } catch { finish(true); }
      }, () => {
        if (!owned()) return;
        try { applyOnce(); } finally { finish(true); }
      }).catch(() => { if (owned()) finish(true); });
      if (!owned()) {
        transition.skipTransition?.();
        return;
      }
      timer = window.setTimeout(() => {
        if (!owned()) return;
        try { applyOnce(); } finally { finish(true); }
      }, 1000);
    } catch {
      try { applyOnce(); } finally { finish(true); }
    }
  };
}
