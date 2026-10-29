import * as THREE from 'three';
import { gsap } from 'gsap';
import type { PaletteMode, MonoTone } from '../../data/palette';

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

interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  r: number;
}

// --- module state ------------------------------------------------------------
let threeRenderer: THREE.WebGLRenderer | null = null;
let threeScene: THREE.Scene | null = null;
let threeCamera: THREE.OrthographicCamera | null = null;
let animFrameId: number | null = null;
let isVisible = false;
let isTabActive = true;

let instancedMesh: THREE.InstancedMesh | null = null;
let sphereGeometry: THREE.SphereGeometry | null = null;
let sphereMaterial: THREE.MeshStandardMaterial | null = null;
let balls: Ball[] = [];
let ballColors: THREE.Color[] = [];
let totalBalls = 90;

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
const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS = 3;
const GRAVITY = -16;
const BALL_RESTITUTION = 0.45;
const WALL_RESTITUTION = 0.25;
const LINEAR_DAMPING = 0.35;
const MAX_SPEED = 25;
const REPEL_RADIUS = 2.5;
const REPEL_ACCEL = 30;
const TOSS_RADIUS = 4;
const TOSS_FORCE = 22;

export function setBallPitVisible(visible: boolean) {
  isVisible = visible;
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

  for (let i = 0; i < count; i++) {
    const targetColor = targetPalette[i % targetPalette.length];
    if (immediate) {
      ballColors[i].copy(targetColor);
      instancedMesh.setColorAt(i, ballColors[i]);
    } else {
      gsap.to(ballColors[i], {
        r: targetColor.r,
        g: targetColor.g,
        b: targetColor.b,
        duration: 0.6,
        ease: 'power2.out',
        overwrite: 'auto',
        onUpdate: () => {
          if (instancedMesh) {
            instancedMesh.setColorAt(i, ballColors[i]);
            if (instancedMesh.instanceColor) {
              instancedMesh.instanceColor.needsUpdate = true;
            }
          }
        },
      });
    }
  }

  if (instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true;
  }
}

/**
 * One fixed physics step: integrate, resolve ball/ball overlaps with a restitution impulse,
 * then clamp against the pit walls.
 */
function stepPhysics(dt: number) {
  const floor = -frustumH / 2;
  const left = -frustumW / 2;
  const right = frustumW / 2;
  const damp = Math.max(0, 1 - LINEAR_DAMPING * dt);

  for (const b of balls) {
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
    for (const b of balls) {
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
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
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

  // 3. Pointer Interaction (Force Field & Impulse)
  const onPointerMove = (e: PointerEvent) => {
    const canvasRect = canvas.getBoundingClientRect();
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

    const canvasRect = canvas.getBoundingClientRect();
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
  };

  const onPointerLeave = () => {
    mouse.isActive = false;
    mouse.targetWorldX = 9999;
    mouse.targetWorldY = 9999;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerleave', onPointerLeave);

  // Resize handler
  const onResize = () => {
    if (!threeRenderer || !threeCamera) return;
    const r = container.getBoundingClientRect();
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
  };
  window.addEventListener('resize', onResize);

  // Visibility handler
  const onVisibilityChange = () => {
    isTabActive = !document.hidden;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Palette switch event listener & MutationObserver
  const onPaletteChange = () => {
    updateBallPitColors();
  };
  window.addEventListener('palette-change', onPaletteChange);

  let mutationObs: MutationObserver | null = new MutationObserver(() => {
    updateBallPitColors();
  });
  mutationObs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-palette', 'class'],
  });

  // Ensure initial color matches current active palette
  updateBallPitColors(true);

  // 4. Render loop (fixed-step physics, render on every frame)
  isVisible = true;
  const dummyMatrixUpdate = new THREE.Matrix4();
  const dummyScale = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const dummyPos = new THREE.Vector3();

  let accumulator = 0;
  let lastTime = performance.now();

  const animate = () => {
    animFrameId = requestAnimationFrame(animate);

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
  };

  animate();

  // Teardown function
  return () => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('palette-change', onPaletteChange);
    if (mutationObs) {
      mutationObs.disconnect();
      mutationObs = null;
    }

    sphereGeometry?.dispose();
    sphereMaterial?.dispose();
    threeRenderer?.dispose();

    // Palette tweens from the previous mount would otherwise keep writing through the
    // module-level `instancedMesh` reference into the next one.
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
