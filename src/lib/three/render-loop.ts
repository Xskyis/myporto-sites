/** A visible-only render clock. Demand mode sleeps after its last invalidation settles. */
export function createRenderLoop(render: (dt: number) => void, options: { fps: number; continuous: boolean }) {
  const interval = 1000 / options.fps;
  let active = false;
  let disposed = false;
  let frameId: number | null = null;
  let previous: number | null = null;
  let renderedAt: number | null = null;
  let dirty = true;
  let settleUntil = 0;

  const schedule = () => {
    if (active && !disposed && frameId === null) frameId = requestAnimationFrame(frame);
  };
  const frame = (now: number) => {
    frameId = null;
    if (!active || disposed) return;
    const elapsed = previous === null ? interval : now - previous;
    if (elapsed >= interval - 0.5) {
      previous = now - (elapsed >= interval ? elapsed % interval : 0);
      // FPS alignment carries a fractional remainder forward. Animation time must
      // use actual render timestamps so that remainder is not counted twice.
      const renderElapsed = renderedAt === null ? interval : now - renderedAt;
      renderedAt = now;
      dirty = false;
      render(Math.min(renderElapsed / 1000, 0.05));
    } else {
      schedule();
      return;
    }
    if (options.continuous || dirty || now < settleUntil) schedule();
  };
  return {
    invalidate(settleMs = 0) {
      dirty = true;
      settleUntil = Math.max(settleUntil, performance.now() + settleMs);
      schedule();
    },
    setActive(next: boolean) {
      if (disposed || active === next) return;
      active = next;
      previous = null;
      renderedAt = null;
      if (active) { dirty = true; schedule(); }
      else if (frameId !== null) { cancelAnimationFrame(frameId); frameId = null; }
    },
    dispose() {
      disposed = true;
      active = false;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
    },
  };
}
