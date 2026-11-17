import { getLenis } from './scroll/lenis';

export const CURSOR_MAX_LEAN_DEG = 6;
export const CURSOR_IDLE_SCALE = 1;
export const CURSOR_HOVER_SCALE = 1.12;
export const CURSOR_PRESS_SCALE = 0.86;
export const CURSOR_HOVER_PRESS_SCALE = 0.92;

const INTERACTIVE_SELECTOR =
  'a, button, [role="button"], [role="tab"], input, textarea, select, .project-card, .project-row, .honor-row, .magnetic-btn';

/**
 * Build the CSS transform for the triangular pointer whose tip is at `(0, 0)`.
 *
 * `translate3d` MUST come before `rotate` and `scale` inside `transform` (and never use the
 * standalone `rotate` CSS property, which applies before `transform`), so `transform-origin: 0 0`
 * pivots around the tip `(x, y)` instead of swinging the cursor around viewport `(0, 0)`.
 */
export function buildCursorTransform(
  x: number,
  y: number,
  scale: number,
  leanDeg = 0,
): string {
  const safeScale = Number(scale.toFixed(4));
  const safeLean = Math.abs(leanDeg) < 0.01 ? 0 : Number(leanDeg.toFixed(2));
  if (safeLean === 0) {
    return `translate3d(${x}px, ${y}px, 0px) scale(${safeScale})`;
  }
  return `translate3d(${x}px, ${y}px, 0px) rotate(${safeLean}deg) scale(${safeScale})`;
}

/**
 * Compute target tilt angle (degrees) from active smooth-scroll velocity.
 * Native scrollbar drags freeze Lenis velocity for 400ms, so only react to smooth scrolling.
 */
export function targetCursorLean(
  velocity: number,
  isSmoothScrolling: boolean,
  reducedMotion: boolean,
): number {
  if (reducedMotion || !isSmoothScrolling || !Number.isFinite(velocity)) return 0;
  const raw = velocity * 0.35;
  return Math.max(-CURSOR_MAX_LEAN_DEG, Math.min(CURSOR_MAX_LEAN_DEG, raw));
}

export function setupCursor(): (() => void) | null {
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
  const ring = document.getElementById('cursor-ring');

  if (!hasFinePointer || !ring) {
    document.documentElement.classList.remove('has-custom-cursor');
    return null;
  }

  // Hide the OS pointer only while the custom reticle is mounted and wired.
  document.documentElement.classList.add('has-custom-cursor');
  ring.style.removeProperty('rotate');

  const abort = new AbortController();
  const { signal } = abort;
  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  let mouseX = -100;
  let mouseY = -100;
  let currentScale = CURSOR_IDLE_SCALE;
  let currentLean = 0;
  let isHovering = false;
  let isVisible = false;
  let isMouseDown = false;
  let isRunning = false;
  let animFrameId: number | null = null;
  let lastTime = 0;
  let currentInteractive: Element | null = null;

  const getTargetScale = (): number => {
    if (isMouseDown) return isHovering ? CURSOR_HOVER_PRESS_SCALE : CURSOR_PRESS_SCALE;
    return isHovering ? CURSOR_HOVER_SCALE : CURSOR_IDLE_SCALE;
  };

  const applyTransform = () => {
    ring.style.transform = buildCursorTransform(mouseX, mouseY, currentScale, currentLean);
  };

  const stopLoop = () => {
    isRunning = false;
    lastTime = 0;
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  };

  const getTargetLean = (): number => {
    const lenis = getLenis();
    return targetCursorLean(
      lenis ? lenis.velocity : 0,
      lenis?.isScrolling === 'smooth',
      reducedMotionQuery.matches,
    );
  };

  const updateMotion = (now: number) => {
    if (!isRunning) return;

    const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = now;

    const targetScale = getTargetScale();
    const targetLean = getTargetLean();

    if (reducedMotionQuery.matches) {
      currentScale = targetScale;
      currentLean = 0;
      applyTransform();
      stopLoop();
      return;
    }

    const scaleK = 1 - Math.pow(1e-9, dt);
    const leanK = 1 - Math.pow(0.00002, dt);
    currentScale += (targetScale - currentScale) * scaleK;
    currentLean += (targetLean - currentLean) * leanK;

    const scaleSettled = Math.abs(targetScale - currentScale) < 0.002;
    const leanSettled = Math.abs(targetLean - currentLean) < 0.02;

    if (scaleSettled && leanSettled && Math.abs(targetLean) < 0.02) {
      currentScale = targetScale;
      currentLean = 0;
      applyTransform();
      stopLoop();
      return;
    }

    applyTransform();
    animFrameId = requestAnimationFrame(updateMotion);
  };

  const startLoop = () => {
    if (document.hidden || !isVisible) return;
    if (reducedMotionQuery.matches) {
      currentScale = getTargetScale();
      currentLean = 0;
      applyTransform();
      return;
    }
    if (!isRunning) {
      isRunning = true;
      lastTime = 0;
      animFrameId = requestAnimationFrame(updateMotion);
    }
  };

  const showCursor = () => {
    if (isVisible) return;
    ring.classList.remove('opacity-0');
    ring.classList.add('opacity-100');
    isVisible = true;
  };

  const hideCursor = () => {
    ring.classList.add('opacity-0');
    ring.classList.remove('opacity-100');
    isVisible = false;
    isMouseDown = false;
    currentLean = 0;
    currentInteractive = null;
    isHovering = false;
    ring.style.color = 'var(--cursor-color)';
    stopLoop();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (isVisible) hideCursor();
      return;
    }

    mouseX = e.clientX;
    mouseY = e.clientY;

    if (!isVisible) {
      currentScale = getTargetScale();
      currentLean = 0;
      showCursor();
    }

    // Keep the pointer tip pinned 1:1 to the real cursor position with zero trailing lag.
    applyTransform();
  };

  const onMouseEnter = (e: MouseEvent) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    currentScale = getTargetScale();
    currentLean = 0;
    applyTransform();
    showCursor();
  };

  const onMouseDown = () => {
    isMouseDown = true;
    if (!isVisible) return;
    startLoop();
  };

  const onMouseUp = () => {
    isMouseDown = false;
    if (!isVisible) return;
    startLoop();
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      stopLoop();
    } else if (isVisible) {
      const targetScale = getTargetScale();
      if (Math.abs(targetScale - currentScale) >= 0.002 || Math.abs(currentLean) >= 0.02) {
        startLoop();
      }
    }
  };

  const handleMouseOver = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    if (!interactive) {
      if (currentInteractive) {
        currentInteractive = null;
        isHovering = false;
        ring.style.color = 'var(--cursor-color)';
        startLoop();
      }
      return;
    }
    if (interactive !== currentInteractive) {
      currentInteractive = interactive;
      isHovering = true;
      ring.style.color = 'var(--accent-primary)';
      startLoop();
    }
  };

  const handleMouseOut = (e: MouseEvent) => {
    if (!currentInteractive) return;
    const related = e.relatedTarget as Node | null;
    if (related && currentInteractive.contains(related)) return;
    currentInteractive = null;
    isHovering = false;
    ring.style.color = 'var(--cursor-color)';
    startLoop();
  };

  const onScroll = () => {
    if (!isVisible || reducedMotionQuery.matches) return;
    const lenis = getLenis();
    if (!lenis || lenis.isScrolling !== 'smooth') return;
    startLoop();
  };

  const onReducedMotionChange = () => {
    if (!reducedMotionQuery.matches) return;
    currentLean = 0;
    currentScale = getTargetScale();
    applyTransform();
    stopLoop();
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true, signal });
  window.addEventListener('scroll', onScroll, { passive: true, signal });
  window.addEventListener('blur', hideCursor, { signal });
  document.addEventListener('mouseleave', hideCursor, { signal });
  document.addEventListener('mouseenter', onMouseEnter, { signal });
  document.addEventListener('mousedown', onMouseDown, { signal });
  document.addEventListener('mouseup', onMouseUp, { signal });
  document.addEventListener('visibilitychange', onVisibilityChange, { signal });
  document.addEventListener('mouseover', handleMouseOver, { signal });
  document.addEventListener('mouseout', handleMouseOut, { signal });
  reducedMotionQuery.addEventListener('change', onReducedMotionChange, { signal });

  return () => {
    abort.abort();
    stopLoop();
    ring.style.removeProperty('transform');
    ring.style.removeProperty('rotate');
    ring.style.removeProperty('color');
    document.documentElement.classList.remove('has-custom-cursor');
  };
}
