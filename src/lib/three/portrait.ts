/**
 * Interactive particle portrait for the Hero.
 *
 * - Data: src/data/portrait-points.bin (uint16 ×4: x, y, z, tone) produced by
 *   scripts/make-portrait-points.mjs, plus a pre-sliced mobile variant. Decoded here into
 *   Float32 attributes.
 * - Rendering: THREE.Points + custom ShaderMaterial. All motion (breathing drift, cursor
 *   repulsion, intro assembly, scroll scatter) lives in the vertex shader; the CPU only
 *   lerps a handful of uniforms per frame.
 * - Lifecycle: created lazily by PortraitParticles.astro, paused when off-screen / tab hidden,
 *   disposed on astro:before-swap.
 */

import * as THREE from 'three';
import { gsap } from 'gsap';
import pointsUrl from '../../data/portrait-points.bin?url';
import pointsUrlMobile from '../../data/portrait-points-mobile.bin?url';
import meta from '../../data/portrait-points.meta.json';
import { createRenderLoop } from './render-loop';

export interface PortraitOptions {
  /** Use the decimated prefix of the point set (mobile / low-end). */
  reduced: boolean;
  /** Disable the mouse tilt (touch devices). */
  tilt: boolean;
  /** Aborts the point download before allocating a WebGL context. */
  signal?: AbortSignal;
  /** Called once the first frame has been rendered. */
  onReady?: () => void;
}

export interface PortraitHandle {
  /** Play the scattered → assembled intro (≈2.2s). Resolves when done. */
  assemble(): Promise<void>;
  /** Jump straight to the assembled state (used when the placeholder was already visible). */
  showAssembled(): void;
  /** 0 = intact, 1 = fully dispersed (driven by Hero scroll progress). */
  setScatter(v: number): void;
  /** Pause/resume the render loop (IntersectionObserver / visibilitychange). */
  setActive(active: boolean): void;
  /** Re-read palette CSS variables and tween the dot colours. */
  syncPalette(animate?: boolean): void;
  /** Pointer position in canvas-relative CSS px (or null when the pointer left). */
  setPointer(x: number | null, y: number | null, strength?: number): void;
  dispose(): void;
}

const VERT = /* glsl */ `
  precision highp float;

  attribute vec3 aRand;      // per-point random (0..1) ×3
  attribute float aTone;     // 0..1 luminance-derived tone

  uniform float uTime;
  uniform float uProgress;   // 0 scattered → 1 assembled
  uniform float uScatter;    // 0 intact → 1 dispersed (scroll)
  uniform vec3  uMouse;      // world-space pointer (x, y), z = active strength 0..1
  uniform float uMouseRadius;
  uniform float uSize;       // base point size in CSS px (already DPR-scaled)
  uniform float uDrift;      // breathing amplitude

  varying float vTone;
  varying float vAlpha;
  varying float vAccent;

  // Cheap periodic "noise" from per-point randoms – good enough for a breathing drift
  vec3 drift(vec3 r, float t) {
    return vec3(
      sin(t * 0.73 + r.x * 6.2831) + 0.5 * sin(t * 1.31 + r.y * 6.2831),
      cos(t * 0.61 + r.y * 6.2831) + 0.5 * cos(t * 1.07 + r.z * 6.2831),
      sin(t * 0.52 + r.z * 6.2831)
    );
  }

  // Exact 2D signed distance to the triangular cursor reticle: polygon(0 0, 0 100%, 100% 66%),
  // converted to world +Y-up coordinates and centered on the triangle centroid.
  float sdCursorTriangle(vec2 p, float h) {
    vec2 p0 = vec2(-0.2667,  0.5533) * h;
    vec2 p1 = vec2(-0.2667, -0.4467) * h;
    vec2 p2 = vec2( 0.5333, -0.1067) * h;
    vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
    vec2 v0 = p - p0,  v1 = p - p1,  v2 = p - p2;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(
      min(
        vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
        vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))
      ),
      vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x))
    );
    return -sqrt(d.x) * sign(d.y);
  }

  void main() {
    vec3 target = position;

    // --- intro: stream/flow from the left side into the portrait
    // Each particle starts shifted to the left, flowing across naturally into position
    float trailDist = 0.50 + 0.45 * aRand.x;
    vec3 flowOffset = vec3(
      -trailDist,
      (aRand.y - 0.5) * 0.22 * (1.0 + trailDist * 0.4),
      (aRand.z - 0.5) * 0.16
    );
    vec3 scatteredStart = target + flowOffset;

    // Stagger wave: particles stream in from left to right with fluid organic pacing.
    // target.x is roughly -0.35 to 0.35. Normalize to 0..1 across portrait width.
    float xNorm = clamp((target.x + 0.35) / 0.70, 0.0, 1.0);
    float stagger = xNorm * 0.24 + (aRand.z - 0.5) * 0.08;

    // Active progress: starts moving IMMEDIATELY on frame 1 (no dead band/delay),
    // with leading particles reaching their positions first, followed by the rest.
    float p = clamp((uProgress * 1.26 - stagger) / max(1.26 - stagger, 0.001), 0.0, 1.0);
    float activeProgress = max(p, uProgress * 0.45);
    float ease = 1.0 - pow(1.0 - activeProgress, 2.5);

    // Position flows from scatteredStart to target, with a subtle fluid curve mid-flight
    vec3 pos = mix(scatteredStart, target, ease);
    float midFlight = sin(ease * 3.14159);
    pos.y += midFlight * 0.05 * (aRand.y - 0.48);
    pos.z += midFlight * 0.04 * (aRand.x - 0.5);

    // --- breathing drift (ramped up as particles arrive so the intro reads cleanly)
    pos += drift(aRand, uTime) * uDrift * ease;

    // --- cursor repulsion matching the triangular pointer reticle
    // SDF shapes a soft triangular clearing centered on the pointer body; radial outward push
    // from the centroid avoids internal Voronoi crease seams, with zero-length guards.
    if (uMouse.z > 0.001) {
      vec2 cursorCenter = uMouse.xy + vec2(0.011, -0.022);
      vec2 toCenter = pos.xy - cursorCenter;
      float triH = uMouseRadius * 0.92;
      float sd = sdCursorTriangle(toCenter, triH);
      float outerPad = uMouseRadius * 0.18;
      float innerCore = -uMouseRadius * 0.16;
      float influence = smoothstep(outerPad, innerCore, sd);
      influence = influence * influence * uMouse.z;
      float centerLen = length(toCenter);
      vec2 pushDir = centerLen > 0.0001 ? (toCenter / centerLen) : vec2(0.0, 1.0);
      pos.xy += pushDir * influence * uMouseRadius * (0.14 + 0.18 * aRand.x);
      pos.z  += influence * 0.025 * (aRand.y - 0.3);
    }

    // --- scroll scatter: stream out organically towards the left side
    // Particles peel away and blow across to the left like dust/mist in the wind
    float streamSpeed = 0.70 + 0.50 * aRand.x;
    float s = pow(uScatter, 1.15) * streamSpeed;
    pos.x -= s * 0.88;
    pos.y += (aRand.y - 0.46) * s * 0.32 + uScatter * 0.06;
    pos.z += (aRand.z - 0.5) * s * 0.20;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vec4 clipPos = projectionMatrix * mv;
    gl_Position = clipPos;

    // Viewport edge falloff in NDC space: guaranteed 0 opacity before canvas boundaries
    vec2 ndc = clipPos.xy / max(clipPos.w, 0.0001);
    float edgeFadeX = 1.0 - smoothstep(0.65, 0.94, abs(ndc.x));
    float edgeFadeY = 1.0 - smoothstep(0.65, 0.94, abs(ndc.y));
    float edgeFade = edgeFadeX * edgeFadeY;

    // Soft dissolve on natural boundaries so raw cutoff edges are never exposed during tilt/motion
    float torsoFade = smoothstep(-0.49, -0.42, position.y);
    float shoulderFade = smoothstep(-0.37, -0.26, position.x);
    float boundaryFade = torsoFade * shoulderFade;

    // Subtly shrink points as they disperse into mist
    float sizeScatter = 1.0 - 0.30 * smoothstep(0.10, 0.75, uScatter);
    float sizeTone = 0.6 + 0.8 * aTone;
    gl_PointSize = uSize * sizeTone * (1.0 / -mv.z) * sizeScatter;

    vTone = aTone;
    vAccent = step(0.92, aRand.z);
    // Intro opacity: smoothly illuminates as flow starts, no static faint ghost delay
    float introAlpha = smoothstep(0.0, 0.18, uProgress) * (0.50 + 0.50 * ease);

    // Organic scroll fade: dissolve mist before points can ever travel to boundary
    float scatterFade = 1.0 - smoothstep(0.04, 0.75, uScatter * (0.80 + 0.45 * aRand.y));

    vAlpha = (0.35 + 0.65 * aTone) * introAlpha * scatterFade * edgeFade * boundaryFade;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3  uColor;
  uniform vec3  uAccentColor;
  uniform float uAccentMix;  // 1 in the colour palette, 0 in mono
  uniform float uOpacity;

  varying float vTone;
  varying float vAlpha;
  varying float vAccent;

  void main() {
    if (vAlpha < 0.005) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.22, d);
    vec3 color = mix(uColor, uAccentColor, vAccent * uAccentMix);
    gl_FragColor = vec4(color, soft * vAlpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

export function decodePoints(buffer: ArrayBuffer, count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || buffer.byteLength % 8 !== 0 || buffer.byteLength / 8 < count) {
    throw new Error('Invalid portrait point data: incomplete uint16 point records');
  }
  const u16 = new Uint16Array(buffer);
  const b = meta.bounds;
  const dec = (q: number, [lo, hi]: readonly number[]) => lo + (q / 65535) * (hi - lo);
  const positions = new Float32Array(count * 3);
  const tones = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = dec(u16[i * 4], b.x);
    let y = dec(u16[i * 4 + 1], b.y);
    const z = dec(u16[i * 4 + 2], b.z);

    // Tidy hair silhouette: smooth down the protruding mound / tuft at the crown (x ≈ 0.095)
    const dx = x - 0.095;
    const yCap = 0.446 - 1.8 * dx * dx;
    if (y > yCap) {
      const over = y - yCap;
      y = yCap - over * 0.05;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    tones[i] = dec(u16[i * 4 + 3], b.tone);
  }
  return { positions, tones };
}

/** Pure CPU mirror of the shader's cursor triangle SDF (`polygon(0 0, 0 100%, 100% 66%)`) for tests. */
export function sdCursorTriangle(px: number, py: number, h: number): number {
  const p0x = -0.2667 * h, p0y = 0.5533 * h;
  const p1x = -0.2667 * h, p1y = -0.4467 * h;
  const p2x = 0.5333 * h, p2y = -0.1067 * h;
  const e0x = p1x - p0x, e0y = p1y - p0y;
  const e1x = p2x - p1x, e1y = p2y - p1y;
  const e2x = p0x - p2x, e2y = p0y - p2y;
  const v0x = px - p0x, v0y = py - p0y;
  const v1x = px - p1x, v1y = py - p1y;
  const v2x = px - p2x, v2y = py - p2y;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const t0 = clamp01((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y));
  const t1 = clamp01((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y));
  const t2 = clamp01((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y));
  const pq0x = v0x - e0x * t0, pq0y = v0y - e0y * t0;
  const pq1x = v1x - e1x * t1, pq1y = v1y - e1y * t1;
  const pq2x = v2x - e2x * t2, pq2y = v2y - e2y * t2;
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0x = pq0x * pq0x + pq0y * pq0y, d0y = s * (v0x * e0y - v0y * e0x);
  const d1x = pq1x * pq1x + pq1y * pq1y, d1y = s * (v1x * e1y - v1y * e1x);
  const d2x = pq2x * pq2x + pq2y * pq2y, d2y = s * (v2x * e2y - v2y * e2x);
  const minDistSq = Math.min(d0x, d1x, d2x);
  const minSigned = Math.min(d0y, d1y, d2y);
  return -Math.sqrt(minDistSq) * Math.sign(minSigned);
}

/** Deterministic per-point randoms (mulberry32) so the intro looks the same on every load. */
export function makeRandoms(count: number, seed = 1337) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(count * 3);
  for (let i = 0; i < out.length; i++) out[i] = next();
  return out;
}

function readPalette() {
  const html = document.documentElement;
  const cs = getComputedStyle(html);
  const dots = cs.getPropertyValue('--text-primary').trim() || '#FAFAF9';
  const accent = cs.getPropertyValue('--accent-primary').trim() || dots;
  const isColor = html.getAttribute('data-palette') === 'color';
  return { dots, accent, accentMix: isColor ? 1 : 0 };
}

/**
 * The canvas uses 200% vertical overscan on desktop (140% in reduced mode, matching
 * `--portrait-inset` / `--portrait-size` in PortraitParticles.astro) so scattered / repelled
 * points have room before hitting the edge. The camera is pulled back by the same factor so the
 * portrait itself still fills the visible box.
 */
export async function initPortrait(canvas: HTMLCanvasElement, options: PortraitOptions): Promise<PortraitHandle> {
  const count = options.reduced ? meta.mobileCount : meta.count;
  const overscan = options.reduced ? 1.4 : 2.0;

  // --- data ------------------------------------------------------------------
  // `reduced` (mobile / low-end) fetches a smaller pre-sliced buffer instead of downloading
  // the desktop payload and discarding everything past the prefix.
  const abortError = () => new DOMException('Aborted', 'AbortError');
  if (options.signal?.aborted) throw abortError();
  const res = await fetch(options.reduced ? pointsUrlMobile : pointsUrl, {
    signal: options.signal,
  });
  if (!res.ok) throw new Error(`portrait points: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  if (options.signal?.aborted) throw abortError();
  const { positions, tones } = decodePoints(buffer, count);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(makeRandoms(count), 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1.6); // skip recompute; never culled

  // --- renderer / camera -----------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
    premultipliedAlpha: true,
  });
  const dpr = Math.min(window.devicePixelRatio || 1, options.reduced ? 1.25 : 2);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  // Portrait height is ~1 world unit; frame it so the bust sits flush at the bottom boundary
  const cameraY = 0.025;
  const fitDistance = (0.5 / Math.tan((camera.fov * Math.PI) / 360)) * 1.02 * overscan;
  camera.position.set(0, cameraY, fitDistance);
  camera.lookAt(0, cameraY, 0);

  const palette = readPalette();
  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uScatter: { value: 0 },
    uMouse: { value: new THREE.Vector3(10, 10, 0) },
    uMouseRadius: { value: 0.09 },
    uSize: { value: 1 },
    uDrift: { value: options.reduced ? 0 : 0.0035 },
    uColor: { value: new THREE.Color(palette.dots) },
    uAccentColor: { value: new THREE.Color(palette.accent) },
    uAccentMix: { value: palette.accentMix },
    uOpacity: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  // --- interaction state -----------------------------------------------------
  const pointerTarget = new THREE.Vector3(10, 10, 0); // x, y world; z = strength
  const tiltTarget = new THREE.Vector2(0, 0);
  const tiltCurrent = new THREE.Vector2(0, 0);
  const MAX_TILT_X = THREE.MathUtils.degToRad(1.5);
  const MAX_TILT_Y = THREE.MathUtils.degToRad(2.2);

  // --- render loop -----------------------------------------------------------
  let ready = false;
  const loop = createRenderLoop(
    (dt) => {
      if (!options.reduced) uniforms.uTime.value += dt;

      // Ease pointer position & strength (spring-back when the pointer leaves)
      const m = uniforms.uMouse.value;
      const k = 1 - Math.pow(0.001, dt); // frame-rate independent lerp (~fast)
      m.x += (pointerTarget.x - m.x) * k;
      m.y += (pointerTarget.y - m.y) * k;
      const kz = 1 - Math.pow(pointerTarget.z > m.z ? 0.0005 : 0.02, dt);
      m.z += (pointerTarget.z - m.z) * kz;

      // Tilt towards the mouse
      const kt = 1 - Math.pow(0.01, dt);
      tiltCurrent.x += (tiltTarget.x - tiltCurrent.x) * kt;
      tiltCurrent.y += (tiltTarget.y - tiltCurrent.y) * kt;
      group.rotation.y = tiltCurrent.x * MAX_TILT_Y;
      group.rotation.x = -tiltCurrent.y * MAX_TILT_X;

      renderer.render(scene, camera);

      if (!ready) {
        ready = true;
        options.onReady?.();
      }
    },
    { fps: options.reduced ? 30 : 60, continuous: !options.reduced },
  );

  // --- sizing ----------------------------------------------------------------
  let width = 1;
  let height = 1;
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Point size in device px: scale with the *portrait* height so density looks constant.
    // (gl_PointSize is multiplied by 1/-mv.z in the shader, hence × fitDistance here)
    const portraitPx = height / overscan;
    const base = (portraitPx / 820) * (options.reduced ? 2.3 : 1.75);
    uniforms.uSize.value = base * dpr * fitDistance;
    loop.invalidate();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const setPointer: PortraitHandle['setPointer'] = (x, y, strength = 1) => {
    if (x === null || y === null) {
      pointerTarget.z = 0;
      tiltTarget.set(0, 0);
      loop.invalidate(1100);
      return;
    }
    // CSS px → world units (portrait height = 1, centred). Visible world height at z=0:
    const worldH = 2 * fitDistance * Math.tan((camera.fov * Math.PI) / 360);
    const worldW = worldH * camera.aspect;
    const nx = x / width - 0.5;
    const ny = 0.5 - y / height;
    pointerTarget.set(nx * worldW, ny * worldH + cameraY, strength);
    if (options.tilt) {
      // Gentle, restrained tilt range so dissolve boundaries remain completely clean
      tiltTarget.set(THREE.MathUtils.clamp(nx * 0.8, -1, 1), THREE.MathUtils.clamp(ny * 0.7, -1, 1));
    }
    loop.invalidate(1100);
  };

  const setActive = (next: boolean) => {
    loop.setActive(next);
  };

  // --- palette ---------------------------------------------------------------
  let paletteTween: gsap.core.Tween | null = null;
  const syncPalette = (animate = true) => {
    const p = readPalette();
    const dots = new THREE.Color(p.dots);
    const accent = new THREE.Color(p.accent);
    paletteTween?.kill();
    if (!animate) {
      uniforms.uColor.value.copy(dots);
      uniforms.uAccentColor.value.copy(accent);
      uniforms.uAccentMix.value = p.accentMix;
      loop.invalidate();
      return;
    }
    const c = uniforms.uColor.value;
    const a = uniforms.uAccentColor.value;
    loop.invalidate(650);
    paletteTween = gsap.to(
      { cr: c.r, cg: c.g, cb: c.b, ar: a.r, ag: a.g, ab: a.b, mix: uniforms.uAccentMix.value },
      {
        cr: dots.r, cg: dots.g, cb: dots.b, ar: accent.r, ag: accent.g, ab: accent.b, mix: p.accentMix,
        duration: 0.6,
        ease: 'power2.out',
        onUpdate() {
          const t = this.targets()[0] as Record<string, number>;
          c.setRGB(t.cr, t.cg, t.cb);
          a.setRGB(t.ar, t.ag, t.ab);
          uniforms.uAccentMix.value = t.mix;
          loop.invalidate();
        },
      }
    );
  };

  // --- intro -------------------------------------------------------------------
  let disposed = false;
  let introTween: gsap.core.Tween | null = null;
  const assemble = () =>
    new Promise<void>((resolve) => {
      introTween?.kill();
      uniforms.uProgress.value = 0;
      loop.invalidate(1700);
      introTween = gsap.to(uniforms.uProgress, {
        value: 1,
        duration: 1.6,
        ease: 'power2.out',
        onUpdate: () => loop.invalidate(),
        onComplete: resolve,
      });
    });
  const showAssembled = () => {
    introTween?.kill();
    uniforms.uProgress.value = 1;
    loop.invalidate();
  };

  const setScatter = (v: number) => {
    uniforms.uScatter.value = THREE.MathUtils.clamp(v, 0, 1);
    loop.invalidate();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    loop.dispose();
    ro.disconnect();
    introTween?.kill();
    paletteTween?.kill();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };

  return { assemble, showAssembled, setScatter, setActive, syncPalette, setPointer, dispose };
}
