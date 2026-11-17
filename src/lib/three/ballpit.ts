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
  popTimer?: number;
  spawnScale?: number;
}

export interface BurstParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  baseScale: number;
  life: number;
  maxLife: number;
}

export interface BallBounds {
  floor: number;
  left: number;
  right: number;
}

export interface StepBallOptions {
  gravity?: number;
  ceiling?: number;
  damping?: number;
  wallRestitution?: number;
}

interface PopRing {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  maxLife: number;
  startRadius: number;
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
let sphereMaterial: THREE.Material | null = null;
let burstMesh: THREE.InstancedMesh | null = null;
let burstGeometry: THREE.IcosahedronGeometry | null = null;
let burstMaterial: THREE.MeshBasicMaterial | null = null;
let ringGeometry: THREE.RingGeometry | null = null;
let ringPool: PopRing[] = [];
let balls: Ball[] = [];
let ballColors: THREE.Color[] = [];
let burstParticles: BurstParticle[] = [];
let burstCursor = 0;
let ringCursor = 0;
let totalBalls = 18;
let paletteTween: gsap.core.Tween | null = null;
let isColorTweening = false;
let idleFrames = 0;
let floatEnergy = 1;

// Mouse Force Field (desktop hover only; touch scrolls without waking a hover field)
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
export const FLOAT_GRAVITY = 0;
export const BALL_RESTITUTION = 0.45;
export const WALL_RESTITUTION = 0.25;
export const FLOAT_WALL_RESTITUTION = 0.82;
export const LINEAR_DAMPING = 0.35;
export const FLOAT_DAMPING = 0.55;
export const MAX_SPEED = 25;
export const REPEL_RADIUS = 2.6;
export const REPEL_ACCEL = 14;
export const TOSS_RADIUS = 4;
export const TOSS_FORCE = 22;
export const HIT_SLOP = 1.15;
export const POP_RESPAWN_DELAY = 0.9;
export const POP_SPAWN_DURATION = 0.28;
export const POP_SHOCKWAVE_RADIUS = 3.4;
export const POP_SHOCKWAVE_FORCE = 16;

export function setBallPitVisible(visible: boolean) {
  if (visible === isVisible) return;
  isVisible = visible;
  // The loop stops itself when it has nothing to draw; restart it on re-entry.
  if (visible) {
    floatEnergy = Math.max(floatEnergy, 0.85);
    resumeLoop?.();
  }
}

/**
 * Applies a gentle ambient draft to the floating bubbles when the user
 * scrolls over or into the footer.
 */
export function applyScrollWake(velocity: number) {
  if (!balls.length || !isVisible || !isTabActive) return;
  const speed = Math.min(Math.abs(velocity), 15);
  // Ignore tiny crawling scrolls
  if (speed < 0.6) return;

  const driftStrength = Math.min(speed * 0.24, 2.2);
  const direction = velocity > 0 ? 1 : -1;

  for (let i = 0; i < balls.length; i++) {
    const ball = balls[i];
    if ((ball.popTimer ?? 0) > 0) continue;
    if (Math.random() < 0.55) {
      ball.vy += (Math.random() - 0.35) * driftStrength;
      ball.vx += (Math.random() - 0.5) * driftStrength * 0.6 + direction * 0.18;
    }
  }

  floatEnergy = 1;
  idleFrames = 0;
  resumeLoop?.();
}

/**
 * Find the front-most active ball under `(x, y)` in orthographic world coordinates.
 * Returns `-1` when no ball is hit.
 */
export function findHitBallIndex(
  list: readonly Ball[],
  x: number,
  y: number,
  hitScale = HIT_SLOP,
): number {
  let bestIdx = -1;
  let bestZ = -Infinity;
  let bestDistSq = Infinity;

  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if ((b.popTimer ?? 0) > 0) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    const hitR = b.r * hitScale;
    const distSq = dx * dx + dy * dy;
    if (distSq > hitR * hitR) continue;
    if (b.z > bestZ || (b.z === bestZ && distSq < bestDistSq)) {
      bestIdx = i;
      bestZ = b.z;
      bestDistSq = distSq;
    }
  }
  return bestIdx;
}

/**
 * Advance burst particles from popped balls. Returns true while any particle remains active.
 */
export function stepBurstParticles(particles: BurstParticle[], dt: number): boolean {
  let anyActive = false;
  const damp = Math.max(0, 1 - 1.8 * dt);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.life <= 0) continue;
    p.life = Math.max(0, p.life - dt / p.maxLife);
    if (p.life <= 0) continue;
    p.vy += -18 * dt;
    p.vx *= damp;
    p.vy *= damp;
    p.vz *= damp;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    anyActive = true;
  }
  return anyActive;
}

// Palette definitions for translucent bubble rims and burst particles
const PALETTE_COLORS = {
  monoLight: [
    new THREE.Color('#0A0A0A'), // near black
    new THREE.Color('#262626'), // dark charcoal
    new THREE.Color('#404040'), // deep slate
    new THREE.Color('#525252'), // medium slate
    new THREE.Color('#737373'), // muted gray
  ],
  monoDark: [
    new THREE.Color('#FAFAF9'), // off white
    new THREE.Color('#E5E5E5'), // silver white
    new THREE.Color('#D4D4D4'), // cool mist
    new THREE.Color('#A3A3A3'), // mid silver
    new THREE.Color('#737373'), // slate frost
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
export function stepBalls(
  list: Ball[],
  dt: number,
  bounds: BallBounds,
  iterations = 4,
  options?: StepBallOptions,
) {
  const { floor, left, right } = bounds;
  const gravity = options?.gravity ?? GRAVITY;
  const ceiling = options?.ceiling;
  const wallRestitution = options?.wallRestitution ?? WALL_RESTITUTION;
  const damping = options?.damping ?? LINEAR_DAMPING;
  const damp = Math.max(0, 1 - damping * dt);

  for (const b of list) {
    if ((b.popTimer ?? 0) > 0) continue;
    b.vy += gravity * dt;
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

  // Resolving the floor/ceiling only once at the end would push outer rows back into neighbors,
  // so the wall pass is interleaved with the relaxation passes.
  const resolveWalls = () => {
    for (const b of list) {
      if ((b.popTimer ?? 0) > 0) continue;
      if (b.y - b.r < floor) {
        b.y = floor + b.r;
        if (b.vy < 0) b.vy = -b.vy * wallRestitution;
        if (ceiling === undefined) b.vx *= 0.98;
      }
      if (ceiling !== undefined && b.y + b.r > ceiling) {
        b.y = ceiling - b.r;
        if (b.vy > 0) b.vy = -b.vy * wallRestitution;
      }
      if (b.x - b.r < left) {
        b.x = left + b.r;
        if (b.vx < 0) b.vx = -b.vx * wallRestitution;
      }
      if (b.x + b.r > right) {
        b.x = right - b.r;
        if (b.vx > 0) b.vx = -b.vx * wallRestitution;
      }
    }
  };

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if ((a.popTimer ?? 0) > 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if ((b.popTimer ?? 0) > 0) continue;
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

export function initBallPit(canvas: HTMLCanvasElement): () => void {
  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReduced) throw new Error('Ball pit motion is disabled');

  const container = canvas.parentElement;
  if (!container) throw new Error('Ball pit canvas has no container');

  const rect = container.getBoundingClientRect();
  const width = rect.width || window.innerWidth;
  const height = rect.height || Math.max(350, window.innerHeight * 0.55);

  const isMobile =
    width < 1024 ||
    window.matchMedia('(pointer: coarse)').matches ||
    (navigator.hardwareConcurrency ?? 8) <= 4;

  totalBalls = isMobile ? 10 : width > 1200 ? 18 : 14;
  const relaxIterations = 2;
  const maxSubsteps = isMobile ? 2 : MAX_SUBSTEPS;
  const minFrameMs = isMobile ? 1000 / 30 - 0.5 : 0;
  const sleepIdleThreshold = isMobile ? 20 : 30;
  const burstPoolSize = isMobile ? 24 : 48;
  const burstPerPop = isMobile ? 6 : 10;
  const ringPoolSize = isMobile ? 2 : 4;

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
      antialias: !isMobile,
      powerPreference: isMobile ? 'default' : 'high-performance',
      precision: isMobile ? 'mediump' : 'highp',
    });
  } catch (err) {
    threeScene = null;
    threeCamera = null;
    throw err;
  }

  threeRenderer.setSize(width, height);
  threeRenderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
  threeRenderer.setClearColor(0x000000, 0);

  // 2. Translucent Fresnel bubbles + lightweight pop burst pool (no scene lights needed)
  const depth = 4.0;

  sphereGeometry = new THREE.SphereGeometry(1, isMobile ? 10 : 18, isMobile ? 8 : 14);
  sphereMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vBubbleColor;

      void main() {
        #ifdef USE_INSTANCING_COLOR
          vBubbleColor = instanceColor;
        #else
          vBubbleColor = vec3(0.5);
        #endif

        vec3 transformedNormal = normal;
        vec4 mvPosition = vec4(position, 1.0);

        #ifdef USE_INSTANCING
          transformedNormal = mat3(instanceMatrix) * transformedNormal;
          mvPosition = instanceMatrix * mvPosition;
        #endif

        vNormalView = normalize(normalMatrix * transformedNormal);
        gl_Position = projectionMatrix * modelViewMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vBubbleColor;

      void main() {
        vec3 n = normalize(vNormalView);
        float ndotv = clamp(n.z, 0.0, 1.0);
        float fresnel = clamp(1.0 - ndotv, 0.0001, 1.0);
        float rim = pow(fresnel, 2.05);

        vec3 keyDir = normalize(vec3(-0.38, 0.56, 0.73));
        vec3 bounceDir = normalize(vec3(0.42, -0.52, 0.74));
        float specKey = pow(max(dot(n, keyDir), 0.0001), 28.0);
        float specBounce = pow(max(dot(n, bounceDir), 0.0001), 10.0) * 0.24;
        float spec = specKey + specBounce;

        float alpha = clamp(0.02 + rim * 0.38 + spec * 0.58, 0.0, 0.78);
        vec3 col = mix(vBubbleColor, vec3(1.0), clamp(spec * 0.88, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    ...(isMobile ? { precision: 'mediump' as const } : {}),
  });

  instancedMesh = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, totalBalls);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  threeScene.add(instancedMesh);

  burstGeometry = new THREE.IcosahedronGeometry(1, 0);
  burstMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  burstMesh = new THREE.InstancedMesh(burstGeometry, burstMaterial, burstPoolSize);
  burstMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  burstMesh.frustumCulled = false;
  threeScene.add(burstMesh);

  ringGeometry = new THREE.RingGeometry(0.962, 1.0, isMobile ? 28 : 40);
  ringPool = [];
  for (let i = 0; i < ringPoolSize; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(ringGeometry, mat);
    mesh.visible = false;
    threeScene.add(mesh);
    ringPool.push({ mesh, life: 0, maxLife: 0.28, startRadius: 0.5 });
  }

  balls = [];
  ballColors = [];
  burstParticles = [];
  burstCursor = 0;
  ringCursor = 0;
  floatEnergy = 1;

  const initialPalette = getActiveBallPalette();
  const dummyMatrix = new THREE.Matrix4();

  // Sparse radii balanced across the footer width so most background breathing room stays open
  for (let i = 0; i < totalBalls; i++) {
    let r = 0.44;
    if (i % 5 === 0) r = 0.84;
    else if (i % 2 === 0) r = 0.62;

    const colNorm = (i + 0.5 + (Math.random() - 0.5) * 0.7) / totalBalls - 0.5;
    const x = colNorm * (frustumW * 0.88);
    const y = (Math.random() - 0.5) * (frustumH * 0.72);
    const z = (Math.random() - 0.5) * (depth * 0.5);
    const vx = (Math.random() - 0.5) * 0.6;
    const vy = (Math.random() - 0.5) * 0.5;

    balls.push({ x, y, z, vx, vy, r, popTimer: 0, spawnScale: 1 });

    dummyMatrix.makeScale(r, r, r);
    dummyMatrix.setPosition(x, y, z);
    instancedMesh.setMatrixAt(i, dummyMatrix);

    const c = initialPalette[i % initialPalette.length].clone();
    ballColors.push(c);
    instancedMesh.setColorAt(i, c);
  }

  // Zero-initialize burst particle pool so instanceColor exists from frame 1
  let burstDirty = false;
  const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < burstPoolSize; i++) {
    burstParticles.push({
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      baseScale: 0,
      life: 0,
      maxLife: 0.4,
    });
    burstMesh.setMatrixAt(i, zeroMatrix);
    burstMesh.setColorAt(i, initialPalette[i % initialPalette.length]);
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;
  burstMesh.instanceMatrix.needsUpdate = true;
  if (burstMesh.instanceColor) burstMesh.instanceColor.needsUpdate = true;

  const popBallAtIndex = (hitIdx: number) => {
    const ball = balls[hitIdx];
    const color = ballColors[hitIdx] ?? initialPalette[0];
    const bx = ball.x;
    const by = ball.y;
    const bz = ball.z;
    const br = ball.r;

    // Hide popped bubble until it gently inflates back in an open spot
    ball.popTimer = POP_RESPAWN_DELAY;
    ball.spawnScale = 0;
    ball.vx = 0;
    ball.vy = 0;
    floatEnergy = 1;

    // Soft radial shockwave on neighboring active bubbles
    for (let i = 0; i < balls.length; i++) {
      if (i === hitIdx) continue;
      const neighbor = balls[i];
      if ((neighbor.popTimer ?? 0) > 0) continue;
      const dx = neighbor.x - bx;
      const dy = neighbor.y - by;
      const dist = Math.hypot(dx, dy);
      if (dist >= POP_SHOCKWAVE_RADIUS) continue;
      const strength = (1 - dist / POP_SHOCKWAVE_RADIUS) * (POP_SHOCKWAVE_FORCE * 0.45);
      const inv = dist > 0.001 ? 1 / dist : 0;
      const angle = Math.random() * Math.PI * 2;
      neighbor.vx += (dist > 0.001 ? dx * inv : Math.cos(angle)) * strength;
      neighbor.vy += (dist > 0.001 ? dy * inv : Math.sin(angle)) * strength;
    }

    // Spawn mist droplets from the popped bubble's rim & color
    if (burstMesh) {
      for (let k = 0; k < burstPerPop; k++) {
        const slot = burstCursor;
        burstCursor = (burstCursor + 1) % burstPoolSize;
        const p = burstParticles[slot];
        const angle = (k / burstPerPop) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
        const speed = 3.2 + Math.random() * 4.0;
        p.x = bx + Math.cos(angle) * br * 0.55;
        p.y = by + Math.sin(angle) * br * 0.55;
        p.z = bz + (Math.random() - 0.5) * 0.25;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed + 1.2 + Math.random() * 2.0;
        p.vz = (Math.random() - 0.5) * 2;
        p.baseScale = br * (0.08 + Math.random() * 0.07);
        p.maxLife = 0.28 + Math.random() * 0.16;
        p.life = 1;
        burstMesh.setColorAt(slot, color);
      }
      if (burstMesh.instanceColor) burstMesh.instanceColor.needsUpdate = true;
      burstDirty = true;
    }

    // Spawn crisp hairline expanding pop halo
    if (ringPool.length > 0) {
      const slot = ringPool[ringCursor];
      ringCursor = (ringCursor + 1) % ringPool.length;
      slot.life = 1;
      slot.maxLife = 0.24;
      slot.startRadius = br;
      slot.mesh.position.set(bx, by, bz + br + 0.15);
      slot.mesh.scale.setScalar(br * 0.78);
      slot.mesh.material.color.copy(color);
      slot.mesh.material.opacity = 0.55;
      slot.mesh.visible = true;
    }
  };

  // 3. Pointer Interaction (Force Field, Click Pop & Radial Toss) with cached bounding rect
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

  idleFrames = 0;
  let lastWidth = width;
  let lastHeight = height;

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
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
      floatEnergy = 1;
      idleFrames = 0;
      resumeLoop?.();
    } else {
      mouse.isActive = false;
    }
  };

  const triggerInteractionAt = (clientPosX: number, clientPosY: number, targetNode: EventTarget | null) => {
    const target = targetNode as HTMLElement | null;
    if (target?.closest('a, button, [role="button"], input, textarea, select')) {
      return;
    }

    const canvasRect = getCanvasRect();
    const clientX = clientPosX - canvasRect.left;
    const clientY = clientPosY - canvasRect.top;

    if (clientX < 0 || clientX > canvasRect.width || clientY < 0 || clientY > canvasRect.height) {
      return;
    }

    const clickX = (clientX / canvasRect.width) * frustumW - frustumW / 2;
    const clickY = -((clientY / canvasRect.height) * frustumH - frustumH / 2);

    const hitIdx = findHitBallIndex(balls, clickX, clickY);
    if (hitIdx !== -1) {
      popBallAtIndex(hitIdx);
    } else {
      for (const ball of balls) {
        if ((ball.popTimer ?? 0) > 0) continue;
        const dx = ball.x - clickX;
        const dy = ball.y - clickY;
        const dist = Math.hypot(dx, dy);
        if (dist >= TOSS_RADIUS) continue;

        const force = (1 - dist / TOSS_RADIUS) * (TOSS_FORCE * 0.35);
        ball.vx += (dx / (dist || 1)) * force + (Math.random() - 0.5) * 1.2;
        ball.vy += (dy / (dist || 1)) * force + (Math.random() - 0.5) * 1.2;
      }
    }

    floatEnergy = 1;
    idleFrames = 0;
    resumeLoop?.();
  };

  let pendingTouch: { id: number; x: number; y: number; time: number } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      pendingTouch = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() };
      return;
    }
    triggerInteractionAt(e.clientX, e.clientY, e.target);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !pendingTouch || e.pointerId !== pendingTouch.id) return;
    const dist = Math.hypot(e.clientX - pendingTouch.x, e.clientY - pendingTouch.y);
    const elapsed = performance.now() - pendingTouch.time;
    pendingTouch = null;
    if (dist < 12 && elapsed < 350) {
      triggerInteractionAt(e.clientX, e.clientY, e.target);
    }
  };

  const onPointerCancel = () => {
    pendingTouch = null;
  };

  const onPointerLeave = () => {
    mouse.isActive = false;
    mouse.targetWorldX = 9999;
    mouse.targetWorldY = 9999;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerCancel, { passive: true });
  window.addEventListener('scroll', markRectDirty, { passive: true });
  canvas.addEventListener('pointerleave', onPointerLeave);

  // Resize handler (ignores tiny mobile URL-bar height jitters < 2px)
  const onResize = () => {
    if (!threeRenderer || !threeCamera) return;
    const r = container.getBoundingClientRect();
    cachedRect = canvas.getBoundingClientRect();
    rectDirty = false;
    const w = r.width || window.innerWidth;
    const h = r.height || Math.max(350, window.innerHeight * 0.55);
    if (Math.abs(w - lastWidth) < 2 && Math.abs(h - lastHeight) < 2) return;
    lastWidth = w;
    lastHeight = h;

    threeRenderer.setSize(w, h);
    threeRenderer.setPixelRatio(isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));

    const asp = w / h;
    frustumH = 10;
    frustumW = frustumH * asp;

    threeCamera.left = -frustumW / 2;
    threeCamera.right = frustumW / 2;
    threeCamera.top = frustumH / 2;
    threeCamera.bottom = -frustumH / 2;
    threeCamera.updateProjectionMatrix();

    floatEnergy = Math.max(floatEnergy, 0.85);
    idleFrames = 0;
    resumeLoop?.();
  };
  window.addEventListener('resize', onResize, { passive: true });

  // Visibility handler
  const onVisibilityChange = () => {
    isTabActive = !document.hidden;
    if (isTabActive && isVisible) {
      floatEnergy = Math.max(floatEnergy, 0.85);
      idleFrames = 0;
      resumeLoop?.();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Palette switch: shared wiring (event + attribute observer) from lib/palette-events.ts
  const disposePaletteListener = onPaletteChange(() => updateBallPitColors());

  // Ensure initial color matches current active palette
  updateBallPitColors(true);

  // 4. Render loop (fixed-step floating bubbles, 30fps cap on mobile, pauses once idle float settles)
  isVisible = false;
  isTabActive = !document.hidden;
  const dummyMatrixUpdate = new THREE.Matrix4();
  const dummyScale = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const dummyPos = new THREE.Vector3();

  let accumulator = 0;
  let floatTime = 0;
  let lastTime = performance.now();
  let lastRenderTime = lastTime;

  const animate = (now: number) => {
    animFrameId = null;
    if (!isVisible || !isTabActive || !threeRenderer || !threeScene || !threeCamera) {
      lastTime = performance.now();
      return;
    }

    if (minFrameMs > 0 && now - lastRenderTime < minFrameMs) {
      animFrameId = requestAnimationFrame(animate);
      return;
    }

    const frameDt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    lastRenderTime = now;
    floatTime += frameDt;
    floatEnergy = Math.max(0, floatEnergy - frameDt / 8.5);

    // Gentle buoyant harmonic drift while active after user interaction or scroll
    if (floatEnergy > 0.02) {
      for (let i = 0; i < balls.length; i++) {
        const ball = balls[i];
        if ((ball.popTimer ?? 0) > 0) continue;
        ball.vx += Math.cos(floatTime * 0.65 + i * 1.9) * 0.55 * floatEnergy * frameDt;
        ball.vy += Math.sin(floatTime * 0.85 + i * 2.3) * 0.65 * floatEnergy * frameDt;
      }
    }

    // Lerp the pointer force field, then glide nearby bubbles away (desktop mouse only).
    if (mouse.isActive) {
      mouse.worldX += (mouse.targetWorldX - mouse.worldX) * 0.15;
      mouse.worldY += (mouse.targetWorldY - mouse.worldY) * 0.15;

      if (Math.abs(mouse.worldX) < frustumW && Math.abs(mouse.worldY) < frustumH) {
        for (const ball of balls) {
          if ((ball.popTimer ?? 0) > 0) continue;
          const dx = ball.x - mouse.worldX;
          const dy = ball.y - mouse.worldY;
          const dist = Math.hypot(dx, dy);
          if (dist >= REPEL_RADIUS || dist <= 0.01) continue;

          const force = (1 - dist / REPEL_RADIUS) * REPEL_ACCEL * frameDt;
          ball.vx += (dx / dist) * force;
          ball.vy += (dy / dist) * force;
        }
      }
    }

    // Advance popped-bubble respawn timers and inflate back cleanly inside the viewport
    let anyPopState = false;
    for (const ball of balls) {
      if ((ball.popTimer ?? 0) > 0) {
        anyPopState = true;
        ball.popTimer = Math.max(0, (ball.popTimer ?? 0) - frameDt);
        if (ball.popTimer <= 0) {
          ball.popTimer = 0;
          ball.spawnScale = 0.01;
          ball.x = (Math.random() - 0.5) * (frustumW * 0.78);
          ball.y = (Math.random() - 0.5) * (frustumH * 0.64);
          ball.vx = (Math.random() - 0.5) * 0.8;
          ball.vy = 0.25 + Math.random() * 0.5;
          floatEnergy = Math.max(floatEnergy, 0.75);
        }
      } else if ((ball.spawnScale ?? 1) < 1) {
        anyPopState = true;
        ball.spawnScale = Math.min(1, (ball.spawnScale ?? 0) + frameDt / POP_SPAWN_DURATION);
      }
    }

    accumulator += frameDt;
    let steps = 0;
    const bounds: BallBounds = {
      floor: -frustumH / 2,
      left: -frustumW / 2,
      right: frustumW / 2,
    };
    const floatOptions: StepBallOptions = {
      gravity: FLOAT_GRAVITY,
      ceiling: frustumH / 2,
      damping: FLOAT_DAMPING,
      wallRestitution: FLOAT_WALL_RESTITUTION,
    };
    while (accumulator >= FIXED_DT && steps < maxSubsteps) {
      stepBalls(balls, FIXED_DT, bounds, relaxIterations, floatOptions);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === maxSubsteps) accumulator = 0; // drop backlog after a long stall

    // Safety: keep runaway active bubbles inside the bounded viewport
    let maxSpeedSq = 0;
    let allInside = true;
    const topBound = frustumH / 2;

    for (const ball of balls) {
      if ((ball.popTimer ?? 0) > 0) continue;
      if (
        ball.y < -frustumH / 2 - 1 ||
        Math.abs(ball.x) > frustumW / 2 + 1 ||
        ball.y > frustumH / 2 + 1
      ) {
        ball.x = (Math.random() - 0.5) * (frustumW * 0.7);
        ball.y = (Math.random() - 0.5) * (frustumH * 0.6);
        ball.vx = (Math.random() - 0.5) * 0.4;
        ball.vy = (Math.random() - 0.5) * 0.4;
      }
      if (ball.y > topBound) allInside = false;
      const speedSq = ball.vx * ball.vx + ball.vy * ball.vy;
      if (speedSq > maxSpeedSq) maxSpeedSq = speedSq;
    }

    // Sync bubble instanced mesh
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      if ((ball.popTimer ?? 0) > 0) {
        instancedMesh!.setMatrixAt(i, zeroMatrix);
        continue;
      }
      const t = ball.spawnScale ?? 1;
      const eased = t >= 1 ? 1 : 1 - (1 - t) * (1 - t);
      const s = ball.r * eased;
      dummyPos.set(ball.x, ball.y, ball.z);
      dummyScale.set(s, s, s);
      dummyMatrixUpdate.compose(dummyPos, dummyQuat, dummyScale);
      instancedMesh!.setMatrixAt(i, dummyMatrixUpdate);
    }
    instancedMesh!.instanceMatrix.needsUpdate = true;

    // Advance & sync burst shards (only upload GPU matrix buffer while bursts are active or clearing)
    const hasBursts = stepBurstParticles(burstParticles, frameDt);
    if (burstMesh && (hasBursts || burstDirty)) {
      for (let i = 0; i < burstParticles.length; i++) {
        const p = burstParticles[i];
        if (p.life <= 0) {
          burstMesh.setMatrixAt(i, zeroMatrix);
          continue;
        }
        const s = p.baseScale * p.life;
        dummyPos.set(p.x, p.y, p.z);
        dummyScale.set(s, s, s);
        dummyMatrixUpdate.compose(dummyPos, dummyQuat, dummyScale);
        burstMesh.setMatrixAt(i, dummyMatrixUpdate);
      }
      burstMesh.instanceMatrix.needsUpdate = true;
      burstDirty = hasBursts;
    }

    // Advance expanding pop rings
    let hasRings = false;
    for (let i = 0; i < ringPool.length; i++) {
      const ring = ringPool[i];
      if (ring.life <= 0) continue;
      ring.life = Math.max(0, ring.life - frameDt / ring.maxLife);
      if (ring.life <= 0) {
        ring.mesh.visible = false;
        continue;
      }
      hasRings = true;
      const progress = 1 - ring.life;
      const eased = 1 - (1 - progress) * (1 - progress);
      ring.mesh.scale.setScalar(ring.startRadius * (0.78 + eased * 1.15));
      ring.mesh.material.opacity = 0.55 * ring.life * ring.life;
    }

    threeRenderer.render(threeScene, threeCamera);

    // Sleep check: pause the rAF loop once gentle float energy, bursts, and rings have settled
    if (
      !mouse.isActive &&
      !isColorTweening &&
      !anyPopState &&
      !hasBursts &&
      !hasRings &&
      floatEnergy <= 0.01 &&
      allInside &&
      maxSpeedSq < 0.0025
    ) {
      idleFrames++;
      if (idleFrames > sleepIdleThreshold) {
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
    lastRenderTime = lastTime - minFrameMs;
    animFrameId = requestAnimationFrame(animate);
  };

  // Teardown function
  return () => {
    if (animFrameId !== null) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    resumeLoop = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('scroll', markRectDirty);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    disposePaletteListener();

    sphereGeometry?.dispose();
    sphereMaterial?.dispose();
    burstGeometry?.dispose();
    burstMaterial?.dispose();
    ringGeometry?.dispose();
    for (const r of ringPool) {
      r.mesh.material.dispose();
    }
    ringPool = [];

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
    burstMesh = null;
    burstGeometry = null;
    burstMaterial = null;
    ringGeometry = null;
    threeRenderer = null;
    threeScene = null;
    threeCamera = null;
    balls = [];
    ballColors = [];
    burstParticles = [];
    mouse.isActive = false;
    pendingTouch = null;
    floatEnergy = 1;
    isVisible = false;
  };
}
