import * as THREE from 'three';
import { gsap } from 'gsap';
import type { PaletteMode, MonoTone } from '../../data/palette';
import { onPaletteChange } from '../palette-events';

/**
 * Interactive ball pit for the footer.
 *
 * Physics is a compact 2D impulse solver (gravity + circle/circle + walls) instead of a full
 * rigid-body engine: the pit is a decorative `aria-hidden` element, the spheres are untextured
 * (rotation is invisible), and `@dimforge/rapier3d-compat` inlined ~3 MB of base64 WASM into the
 * client bundle. This keeps the whole module small while behaving the same on screen.
 */

function getCurrentPaletteState(): { palette: PaletteMode; tone: MonoTone } {
  if (typeof document === 'undefined') {
    return { palette: 'mono', tone: 'light' };
  }
  const html = document.documentElement;
  const palette = (html.getAttribute('data-palette') as PaletteMode) || 'mono';
  const tone = html.classList.contains('dark') ? 'dark' : 'light';
  return { palette, tone };
}

export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  r: number;
}

export interface BallBounds {
  floor: number;
  left: number;
  right: number;
}

// --- module state ------------------------------------------------------------
let threeRenderer: THREE.WebGLRenderer | null = null;
let threeScene: THREE.Scene | null = null;
let threeCamera: THREE.OrthographicCamera | null = null;
let animFrameId: number | null = null;
let resumeLoop: (() => void) | null = null;
let isVisible = false;
let isTabActive = true;

let instancedMesh: THREE.InstancedMesh | null = null;
let sphereGeometry: THREE.SphereGeometry | null = null;
let sphereMaterial: THREE.MeshStandardMaterial | null = null;
let balls: Ball[] = [];
let ballColors: THREE.Color[] = [];
let totalBalls = 90;
let paletteTween: gsap.core.Tween | null = null;
let isColorTweening = false;

// Mouse / Touch Force Field
const mouse = {
  worldX: 9999,
  worldY: 9999,
  targetWorldX: 9999,
  targetWorldY: 9999,
  isActive: false,
};

// Container dimensions in world units
let frustumW = 20;
let frustumH = 10;

// --- solver tuning -----------------------------------------------------------
export const FIXED_DT = 1 / 60;
export const MAX_SUBSTEPS = 3;
export const GRAVITY = -16;
export const BALL_RESTITUTION = 0.45;
export const WALL_RESTITUTION = 0.25;
export const LINEAR_DAMPING = 0.35;
export const MAX_SPEED = 25;
export const REPEL_RADIUS = 2.5;
export const REPEL_ACCEL = 30;
export const TOSS_RADIUS = 4;
export const TOSS_FORCE = 22;

export function setBallPitVisible(visible: boolean) {
  if (visible === isVisible) return;
  isVisible = visible;
  // The loop stops itself when it has nothing to draw; restart it on re-entry.
  if (visible) resumeLoop?.();
}

// Palette definitions for balls
const PALETTE_COLORS = {
  monoLight: [
    new THREE.Color('#0A0A0A'), // near black
    new THREE.Color('#262626'), // dark charcoal
    new THREE.Color('#737373'), // mid gray
    new THREE.Color('#D4D4D4'), // light gray
    new THREE.Color('#FFFFFF'), // crisp white
  ],
  monoDark: [
    new THREE.Color('#FAFAF9'), // off white
    new THREE.Color('#E5E5E5'), // light gray
    new THREE.Color('#A3A3A3'), // mid gray
    new THREE.Color('#404040'), // charcoal
    new THREE.Color('#171717'), // dark
  ],
  color: [
    new THREE.Color('#FDEEA9'), // cream yellow
    new THREE.Color('#D82B2F'), // bright red
    new THREE.Color('#FFF9E6'), // warm ivory highlight
    new THREE.Color('#FF4D4D'), // radiant red
    new THREE.Color('#FFD166'), // warm gold
  ],
};

function getActiveBallPalette(): THREE.Color[] {
  const { palette, tone } = getCurrentPaletteState();
  if (palette === 'color') return PALETTE_COLORS.color;
  return tone === 'dark' ? PALETTE_COLORS.monoDark : PALETTE_COLORS.monoLight;
}

export function updateBallPitColors(immediate = false) {
  if (!instancedMesh || ballColors.length === 0) return;
  const targetPalette = getActiveBallPalette();
  const count = Math.min(totalBalls, ballColors.length);

  paletteTween?.kill();
  paletteTween = null;

  if (immediate) {
    isColorTweening = false;
    for (let i = 0; i < count; i++) {
      ballColors[i].copy(targetPalette[i % targetPalette.length]);
      instancedMesh.setColorAt(i, ballColors[i]);
    }
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }
    resumeLoop?.();
    return;
  }

  const startColors = ballColors.slice(0, count).map((c) => c.clone());
  const proxy = { t: 0 };
  isColorTweening = true;
  resumeLoop?.();

  paletteTween = gsap.to(proxy, {
    t: 1,
    duration: 0.6,
    ease: 'power2.out',
    onUpdate: () => {
      if (!instancedMesh) return;
      for (let i = 0; i < count; i++) {
        ballColors[i].lerpColors(startColors[i], targetPalette[i % targetPalette.length], proxy.t);
        instancedMesh.setColorAt(i, ballColors[i]);
      }
      if (instancedMesh.instanceColor) {
        instancedMesh.instanceColor.needsUpdate = true;
      }
      resumeLoop?.();
    },
    onComplete: () => {
      isColorTweening = false;
      paletteTween = null;
    },
  });
}

/**
 * Pure fixed-step solver: integrate, resolve ball/ball overlaps with a restitution impulse,
 * then clamp against the pit walls. Exported for unit tests — operates only on its arguments.
 */
export function stepBalls(list: Ball[], dt: number, bounds: BallBounds) {
  const { floor, left, right } = bounds;
  const damp = Math.max(0, 1 - LINEAR_DAMPING * dt);

  for (const b of list) {
    b.vy += GRAVITY * dt;
    b.vx *= damp;
    b.vy *= damp;

    const speed = Math.hypot(b.vx, b.vy);
    if (speed > MAX_SPEED) {
      const k = MAX_SPEED / speed;
      b.vx *= k;
      b.vy *= k;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  // Resolving the floor only once at the end would push the bottom row back into the pile,
  // so the wall pass is interleaved with the relaxation passes.
  const resolveWalls = () => {
    for (const b of list) {
      if (b.y - b.r < floor) {
        b.y = floor + b.r;
        if (b.vy < 0) b.vy = -b.vy * WALL_RESTITUTION;
        b.vx *= 0.98;
      }
      if (b.x - b.r < left) {
        b.x = left + b.r;
        if (b.vx < 0) b.vx = -b.vx * WALL_RESTITUTION;
      }
      if (b.x + b.r > right) {
        b.x = right - b.r;
        if (b.vx > 0) b.vx = -b.vx * WALL_RESTITUTION;
      }
    }
  };

  // Four passes keep a 110-ball pile from visibly overlapping at rest.
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.r + b.r;
        const distSq = dx * dx + dy * dy;
        if (distSq >= minDist * minDist || distSq === 0) continue;

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        // Mass ∝ r², split the positional correction the same way.
        const massA = a.r * a.r;
        const massB = b.r * b.r;
        const massSum = massA + massB;
        a.x -= nx * overlap * (massB / massSum);
        a.y -= ny * overlap * (massB / massSum);
        b.x += nx * overlap * (massA / massSum);
        b.y += ny * overlap * (massA / massSum);

        const relVn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relVn > 0) continue; // already separating

        const invA = 1 / massA;
        const invB = 1 / massB;
        const impulse = (-(1 + BALL_RESTITUTION) * relVn) / (invA + invB);

        a.vx -= impulse * invA * nx;
        a.vy -= impulse * invA * ny;
        b.vx += impulse * invB * nx;
        b.vy += impulse * invB * ny;
      }
    }

    resolveWalls();
  }
}

function stepPhysics(dt: number) {
  stepBalls(balls, dt, {
    floor: -frustumH / 2,
    left: -frustumW / 2,
    right: frustumW / 2,
  });
}

export async function initBallPit(canvas: HTMLCanvasElement): Promise<() => void> {
  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReduced) return () => {};

  const container = canvas.parentElement;
  if (!container) return () => {};

  const rect = container.getBoundingClientRect();
  const width = rect.width || window.innerWidth;
  const height = rect.height || Math.max(350, window.innerHeight * 0.55);

  const isMobile = width < 768;
  totalBalls = isMobile ? 45 : width > 1200 ? 110 : 85;

  // 1. Setup Three.js Scene
  threeScene = new THREE.Scene();

  const aspect = width / height;
  frustumH = 10;
  frustumW = frustumH * aspect;

  threeCamera = new THREE.OrthographicCamera(
    -frustumW / 2,
    frustumW / 2,
    frustumH / 2,
    -frustumH / 2,
    0.1,
    100,
  );
  threeCamera.position.set(0, 0, 20);
  threeCamera.lookAt(0, 0, 0);

  try {
    threeRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch (err) {
    console.warn('WebGL init failed for ball pit:', err);
    return () => {};
  }

  threeRenderer.setSize(width, height);
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  threeRenderer.setClearColor(0x000000, 0);

  // Soft architectural lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
  threeScene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(5, 8, 10);
  threeScene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
  fillLight.position.set(-6, -4, 6);
  threeScene.add(fillLight);

  // 2. Instanced spheres + ball state
  const depth = 6.0;

  sphereGeometry = new THREE.SphereGeometry(1, 24, 24);
  sphereMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.25,
    metalness: 0.1,
  });

  instancedMesh = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, totalBalls);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  threeScene.add(instancedMesh);

  balls = [];
  ballColors = [];

  const initialPalette = getActiveBallPalette();
  const dummyMatrix = new THREE.Matrix4();

  // 3 Varied Radii: 40% small, 40% medium, 20% large
  for (let i = 0; i < totalBalls; i++) {
    let r = 0.45;
    if (i % 5 === 0) r = 0.85;
    else if (i % 2 === 0) r = 0.62;

    // Initial drop position (staggered just above the visible pit)
    const x = (Math.random() - 0.5) * (frustumW * 0.85);
    const y = frustumH / 2 + 0.8 + Math.random() * 3.5 + (i / totalBalls) * 4.0;
    const z = (Math.random() - 0.5) * (depth * 0.6);

    balls.push({ x, y, z, vx: 0, vy: 0, r });

    dummyMatrix.makeScale(r, r, r);
    dummyMatrix.setPosition(x, y, z);
    instancedMesh.setMatrixAt(i, dummyMatrix);

    const c = initialPalette[i % initialPalette.length].clone();
    ballColors.push(c);
    instancedMesh.setColorAt(i, c);
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  if (instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true;
  }

  // 3. Pointer Interaction (Force Field & Impulse) with cached bounding rect
  let cachedRect = canvas.getBoundingClientRect();
  let rectDirty = false;
  const markRectDirty = () => {
    rectDirty = true;
  };
  const getCanvasRect = () => {
    if (rectDirty) {
      cachedRect = canvas.getBoundingClientRect();
      rectDirty = false;
    }
    return cachedRect;
  };

  let idleFrames = 0;

  const onPointerMove = (e: PointerEvent) => {
    const canvasRect = getCanvasRect();
    const clientX = e.clientX - canvasRect.left;
    const clientY = e.clientY - canvasRect.top;

    if (
      clientX >= 0 &&
      clientX <= canvasRect.width &&
      clientY >= 0 &&
      clientY <= canvasRect.height
    ) {
      mouse.targetWorldX = (clientX / canvasRect.width) * frustumW - frustumW / 2;
      mouse.targetWorldY = -((clientY / canvasRect.height) * frustumH - frustumH / 2);
      mouse.isActive = true;
      idleFrames = 0;
      resumeLoop?.();
    } else {
      mouse.isActive = false;
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    // If user clicked an interactive link or button, don't trigger physics toss
    const target = e.target as HTMLElement | null;
    if (target?.closest('a, button, input, textarea, select')) {
      return;
    }

    const canvasRect = getCanvasRect();
    const clientX = e.clientX - canvasRect.left;
    const clientY = e.clientY - canvasRect.top;

    if (clientX < 0 || clientX > canvasRect.width || clientY < 0 || clientY > canvasRect.height) {
      return;
    }

    const clickX = (clientX / canvasRect.width) * frustumW - frustumW / 2;
    const clickY = -((clientY / canvasRect.height) * frustumH - frustumH / 2);

    for (const ball of balls) {
      const dx = ball.x - clickX;
      const dy = ball.y - clickY;
      const dist = Math.hypot(dx, dy);
      if (dist >= TOSS_RADIUS) continue;

      const force = (1 - dist / TOSS_RADIUS) * TOSS_FORCE;
      ball.vx += (dx / (dist || 1)) * force + (Math.random() - 0.5) * 4;
      ball.vy += (dy / (dist || 1)) * force + Math.random() * 8 + 4;
    }
    idleFrames = 0;
    resumeLoop?.();
  };

  const onPointerLeave = () => {
    mouse.isActive = false;
    mouse.targetWorldX = 9999;
    mouse.targetWorldY = 9999;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('scroll', markRectDirty, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave);

  // Resize handler
  const onResize = () => {
    if (!threeRenderer || !threeCamera) return;
    const r = container.getBoundingClientRect();
    cachedRect = canvas.getBoundingClientRect();
    rectDirty = false;
    const w = r.width || window.innerWidth;
    const h = r.height || Math.max(350, window.innerHeight * 0.55);

    threeRenderer.setSize(w, h);
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const asp = w / h;
    frustumH = 10;
    frustumW = frustumH * asp;

    threeCamera.left = -frustumW / 2;
    threeCamera.right = frustumW / 2;
    threeCamera.top = frustumH / 2;
    threeCamera.bottom = -frustumH / 2;
    threeCamera.updateProjectionMatrix();

    idleFrames = 0;
    resumeLoop?.();
  };
  window.addEventListener('resize', onResize, { passive: true });

  // Visibility handler
  const onVisibilityChange = () => {
    isTabActive = !document.hidden;
    if (isTabActive && isVisible) {
      idleFrames = 0;
      resumeLoop?.();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Palette switch: shared wiring (event + attribute observer) from lib/palette-events.ts
  const disposePaletteListener = onPaletteChange(() => updateBallPitColors());

  // Ensure initial color matches current active palette
  updateBallPitColors(true);

  // 4. Render loop (fixed-step physics, pauses automatically once balls settle at rest)
  isVisible = true;
  const dummyMatrixUpdate = new THREE.Matrix4();
  const dummyScale = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const dummyPos = new THREE.Vector3();

  let accumulator = 0;
  let lastTime = performance.now();

  const animate = () => {
    animFrameId = null;
    if (!isVisible || !isTabActive || !threeRenderer || !threeScene || !threeCamera) {
      lastTime = performance.now();
      return;
    }

    const now = performance.now();
    const frameDt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Lerp the pointer force field, then push nearby balls away.
    mouse.worldX += (mouse.targetWorldX - mouse.worldX) * 0.15;
    mouse.worldY += (mouse.targetWorldY - mouse.worldY) * 0.15;

    if (mouse.isActive && Math.abs(mouse.worldX) < frustumW && Math.abs(mouse.worldY) < frustumH) {
      for (const ball of balls) {
        const dx = ball.x - mouse.worldX;
        const dy = ball.y - mouse.worldY;
        const dist = Math.hypot(dx, dy);
        if (dist >= REPEL_RADIUS || dist <= 0.01) continue;

        const force = (1 - dist / REPEL_RADIUS) * REPEL_ACCEL * frameDt;
        ball.vx += (dx / dist) * force;
        ball.vy += (dy / dist) * force;
      }
    }

    accumulator += frameDt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      stepPhysics(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) accumulator = 0; // drop the backlog after a long stall

    // Safety: keep runaway balls inside the pit instead of letting them vanish
    let maxSpeedSq = 0;
    let allInside = true;
    const topBound = frustumH / 2;

    for (const ball of balls) {
      if (
        ball.y < -frustumH / 2 - 1 ||
        Math.abs(ball.x) > frustumW / 2 + 1 ||
        ball.y > frustumH / 2 + 7
      ) {
        ball.x = (Math.random() - 0.5) * (frustumW * 0.7);
        ball.y = frustumH / 2 + 0.5 + Math.random() * 2;
        ball.vx = 0;
        ball.vy = -2;
      }
      if (ball.y > topBound) allInside = false;
      const speedSq = ball.vx * ball.vx + ball.vy * ball.vy;
      if (speedSq > maxSpeedSq) maxSpeedSq = speedSq;
    }

    // Sync the instanced mesh (spheres are untextured, so rotation is invisible → identity)
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      dummyPos.set(ball.x, ball.y, ball.z);
      dummyScale.set(ball.r, ball.r, ball.r);
      dummyMatrixUpdate.compose(dummyPos, dummyQuat, dummyScale);
      instancedMesh!.setMatrixAt(i, dummyMatrixUpdate);
    }

    instancedMesh!.instanceMatrix.needsUpdate = true;
    threeRenderer.render(threeScene, threeCamera);

    // Sleep check: pause the rAF loop when all balls have settled at rest and no interaction/tween is active
    if (!mouse.isActive && !isColorTweening && allInside && maxSpeedSq < 0.0025) {
      idleFrames++;
      if (idleFrames > 35) {
        for (const ball of balls) {
          ball.vx = 0;
          ball.vy = 0;
        }
        return;
      }
    } else {
      idleFrames = 0;
    }

    animFrameId = requestAnimationFrame(animate);
  };

  resumeLoop = () => {
    if (animFrameId !== null) return;
    lastTime = performance.now();
    animFrameId = requestAnimationFrame(animate);
  };

  animate();

  // Teardown function
  return () => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    resumeLoop = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('scroll', markRectDirty);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    disposePaletteListener();

    sphereGeometry?.dispose();
    sphereMaterial?.dispose();
    threeRenderer?.dispose();
    // Every visit to the footer builds a new renderer. Browsers cap the number of live WebGL
    // contexts (~16) and hand back a *lost* context beyond that, which renders a blank canvas
    // for the rest of the session. Hand the context back explicitly – same teardown order as
    // portrait.ts's dispose().
    threeRenderer?.forceContextLoss();

    // Palette tweens from the previous mount would otherwise keep writing through the
    // module-level `instancedMesh` reference into the next one.
    paletteTween?.kill();
    paletteTween = null;
    isColorTweening = false;
    gsap.killTweensOf(ballColors);

    instancedMesh = null;
    sphereGeometry = null;
    sphereMaterial = null;
    threeRenderer = null;
    threeScene = null;
    threeCamera = null;
    balls = [];
    ballColors = [];
    isVisible = false;
  };
}
