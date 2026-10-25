import * as THREE from 'three';
import { gsap } from 'gsap';
import * as RAPIER_MODULE from '@dimforge/rapier3d-compat';
import type { PaletteMode, MonoTone } from '../../data/palette';

const RAPIER = ((RAPIER_MODULE as any).default || RAPIER_MODULE) as typeof import('@dimforge/rapier3d-compat');

function getCurrentPaletteState(): { palette: PaletteMode; tone: MonoTone } {
  if (typeof document === 'undefined') {
    return { palette: 'mono', tone: 'light' };
  }
  const html = document.documentElement;
  const palette = (html.getAttribute('data-palette') as PaletteMode) || 'mono';
  const tone = html.classList.contains('dark') ? 'dark' : 'light';
  return { palette, tone };
}

// Ball Pit State
let rapierInitialized = false;
let physicsWorld: any = null;
let threeRenderer: THREE.WebGLRenderer | null = null;
let threeScene: THREE.Scene | null = null;
let threeCamera: THREE.OrthographicCamera | null = null;
let animFrameId: number | null = null;
let isVisible = false;
let isTabActive = true;

// Instanced Mesh & Physics Bodies
let instancedMesh: THREE.InstancedMesh | null = null;
let sphereGeometry: THREE.SphereGeometry | null = null;
let sphereMaterial: THREE.MeshStandardMaterial | null = null;
let rigidBodies: RAPIER.RigidBody[] = [];
let ballRadii: number[] = [];
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

// Container Dimensions in World Units
let frustumW = 20;
let frustumH = 10;
let floorCollider: RAPIER.Collider | null = null;
let leftWallCollider: RAPIER.Collider | null = null;
let rightWallCollider: RAPIER.Collider | null = null;
let backWallCollider: RAPIER.Collider | null = null;
let frontWallCollider: RAPIER.Collider | null = null;
let ceilingCollider: RAPIER.Collider | null = null;

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

export async function initBallPit(canvas: HTMLCanvasElement): Promise<() => void> {
  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReduced) return () => {};

  // Initialize Rapier WASM
  if (!rapierInitialized) {
    await RAPIER.init();
    rapierInitialized = true;
  }

  const container = canvas.parentElement;
  if (!container) return () => {};

  const rect = container.getBoundingClientRect();
  const width = rect.width || window.innerWidth;
  const height = rect.height || Math.max(350, window.innerHeight * 0.55);

  const isMobile = width < 768;
  totalBalls = isMobile ? 45 : (width > 1200 ? 110 : 85);

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
    100
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

  // 2. Setup Rapier Physics World
  const gravity = { x: 0.0, y: -16.0, z: 0.0 };
  physicsWorld = new RAPIER.World(gravity);

  // Build boundary box (solid, thick walls preventing tunneling)
  const floorHeight = 3.0;
  const wallThickness = 3.0;
  const depth = 6.0;

  floorCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(frustumW * 2, floorHeight, depth * 2)
      .setTranslation(0, -frustumH / 2 - floorHeight + 0.1, 0)
      .setRestitution(0.25)
      .setFriction(0.5)
  );

  leftWallCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(wallThickness, frustumH * 2, depth * 2)
      .setTranslation(-frustumW / 2 - wallThickness + 0.1, 0, 0)
      .setRestitution(0.25)
  );

  rightWallCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(wallThickness, frustumH * 2, depth * 2)
      .setTranslation(frustumW / 2 + wallThickness - 0.1, 0, 0)
      .setRestitution(0.25)
  );

  backWallCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(frustumW * 2, frustumH * 2, wallThickness)
      .setTranslation(0, 0, -depth / 2 - wallThickness)
  );

  frontWallCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(frustumW * 2, frustumH * 2, wallThickness)
      .setTranslation(0, 0, depth / 2 + wallThickness)
  );

  ceilingCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(frustumW * 2, wallThickness, depth * 2)
      .setTranslation(0, frustumH / 2 + 7, 0)
      .setRestitution(0.2)
  );

  // 3. Create InstancedMesh & RigidBodies
  sphereGeometry = new THREE.SphereGeometry(1, 24, 24);
  sphereMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.25,
    metalness: 0.1,
  });

  instancedMesh = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, totalBalls);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  threeScene.add(instancedMesh);

  rigidBodies = [];
  ballRadii = [];
  ballColors = [];

  const initialPalette = getActiveBallPalette();
  const dummyMatrix = new THREE.Matrix4();

  // 3 Varied Radii: 40% small, 40% medium, 20% large
  for (let i = 0; i < totalBalls; i++) {
    let r = 0.45;
    if (i % 5 === 0) r = 0.85;
    else if (i % 2 === 0) r = 0.62;
    ballRadii.push(r);

    // Initial drop position (staggered just above the visible pit)
    const posX = (Math.random() - 0.5) * (frustumW * 0.85);
    const posY = frustumH / 2 + 0.8 + Math.random() * 3.5 + (i / totalBalls) * 4.0;
    const posZ = (Math.random() - 0.5) * (depth * 0.6);

    // Dynamic RigidBody
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(posX, posY, posZ)
      .setLinearDamping(0.35)
      .setAngularDamping(0.45);
    const body = physicsWorld.createRigidBody(rbDesc);

    // Ball Collider
    const colliderDesc = RAPIER.ColliderDesc.ball(r)
      .setRestitution(0.45)
      .setFriction(0.35)
      .setDensity(1.0);
    physicsWorld.createCollider(colliderDesc, body);

    rigidBodies.push(body);

    // Initial matrix
    dummyMatrix.makeScale(r, r, r);
    dummyMatrix.setPosition(posX, posY, posZ);
    instancedMesh.setMatrixAt(i, dummyMatrix);

    // Color
    const c = initialPalette[i % initialPalette.length].clone();
    ballColors.push(c);
    instancedMesh.setColorAt(i, c);
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  if (instancedMesh.instanceColor) {
    instancedMesh.instanceColor.needsUpdate = true;
  }

  // 4. Pointer Interaction (Force Field & Impulse)
  const onPointerMove = (e: PointerEvent) => {
    const canvasRect = canvas.getBoundingClientRect();
    const clientX = e.clientX - canvasRect.left;
    const clientY = e.clientY - canvasRect.top;

    if (clientX >= 0 && clientX <= canvasRect.width && clientY >= 0 && clientY <= canvasRect.height) {
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

    // Apply strong radial impulse to nearby balls
    for (let i = 0; i < totalBalls; i++) {
      const body = rigidBodies[i];
      if (!body) continue;
      const pos = body.translation();
      const dx = pos.x - clickX;
      const dy = pos.y - clickY;
      const dist = Math.hypot(dx, dy);

      if (dist < 4.0) {
        const force = (1 - dist / 4.0) * 22;
        body.applyImpulse(
          {
            x: (dx / (dist || 1)) * force + (Math.random() - 0.5) * 4,
            y: (dy / (dist || 1)) * force + Math.random() * 8 + 4,
            z: (Math.random() - 0.5) * 6,
          },
          true
        );
      }
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
    if (!threeRenderer || !threeCamera || !container) return;
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

    // Update boundary positions
    if (floorCollider) floorCollider.setTranslation({ x: 0, y: -frustumH / 2 - floorHeight + 0.2, z: 0 });
    if (leftWallCollider) leftWallCollider.setTranslation({ x: -frustumW / 2 - wallThickness + 0.1, y: 0, z: 0 });
    if (rightWallCollider) rightWallCollider.setTranslation({ x: frustumW / 2 + wallThickness - 0.1, y: 0, z: 0 });
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

  // 5. Physics & Render Loop
  isVisible = true;
  const dummyMatrixUpdate = new THREE.Matrix4();
  const dummyScale = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const dummyPos = new THREE.Vector3();

  const animate = () => {
    animFrameId = requestAnimationFrame(animate);

    if (!isVisible || !isTabActive || !physicsWorld || !threeRenderer || !threeScene || !threeCamera) {
      return;
    }

    // Lerp mouse force field
    mouse.worldX += (mouse.targetWorldX - mouse.worldX) * 0.15;
    mouse.worldY += (mouse.targetWorldY - mouse.worldY) * 0.15;

    // Apply repulsive force field around cursor / touch
    if (mouse.isActive && Math.abs(mouse.worldX) < frustumW && Math.abs(mouse.worldY) < frustumH) {
      for (let i = 0; i < totalBalls; i++) {
        const body = rigidBodies[i];
        if (!body) continue;
        const pos = body.translation();
        const dx = pos.x - mouse.worldX;
        const dy = pos.y - mouse.worldY;
        const dist = Math.hypot(dx, dy);

        if (dist < 2.5 && dist > 0.01) {
          const force = (1 - dist / 2.5) * 5.5;
          body.applyImpulse(
            {
              x: (dx / dist) * force,
              y: (dy / dist) * force,
              z: 0,
            },
            true
          );
        }
      }
    }

    // Step physics world (fixed 60Hz delta)
    physicsWorld.step();

    // Sync Three.js InstancedMesh with Rapier RigidBodies
    for (let i = 0; i < totalBalls; i++) {
      const body = rigidBodies[i];
      if (!body) continue;

      const t = body.translation();

      // Clamp runaway velocities to prevent penetration
      const lv = body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (speed > 25) {
        body.setLinvel({ x: (lv.x / speed) * 25, y: (lv.y / speed) * 25, z: (lv.z / speed) * 25 }, true);
      }

      // Safety: keep within bounds so balls never disappear
      if (t.y < -frustumH / 2 - 1 || Math.abs(t.x) > frustumW / 2 + 1 || t.y > frustumH / 2 + 7) {
        body.setTranslation(
          {
            x: (Math.random() - 0.5) * (frustumW * 0.7),
            y: frustumH / 2 + 0.5 + Math.random() * 2,
            z: (Math.random() - 0.5) * 2,
          },
          true
        );
        body.setLinvel({ x: 0, y: -2, z: 0 }, true);
      }

      const r = body.rotation();
      const rad = ballRadii[i];

      dummyPos.set(t.x, t.y, t.z);
      dummyQuat.set(r.x, r.y, r.z, r.w);
      dummyScale.set(rad, rad, rad);

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

    if (physicsWorld) {
      physicsWorld.free();
      physicsWorld = null;
    }

    instancedMesh = null;
    sphereGeometry = null;
    sphereMaterial = null;
    threeRenderer = null;
    threeScene = null;
    threeCamera = null;
    rigidBodies = [];
    ballRadii = [];
    ballColors = [];
    isVisible = false;
  };
}
