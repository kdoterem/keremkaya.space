"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useCallback, useMemo, useRef } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";
import { mulberry32 } from "@/app/components/TerrainScan";

// ── Line-drawn 3D terrain — replacing the solid, lit mesh entirely. That
// approach converged on a ribbed slab no matter how the noise was tuned;
// this is a genuinely different technique: the landform is many thin
// profile lines in 3D space (parallel cross-sections across the depth
// axis), no fill, no material lighting. Depth and form come from
// perspective, line density, and the GPU's own depth buffer letting nearer
// lines occlude farther ones — not from shading.
//
// This pass also fixes three bugs from the previous build, all with one
// architectural change: the canvas used to be a position:fixed,
// full-viewport backdrop with page content layered on top via z-index.
// That's what broke dragging (the foreground UI wrapper's empty space had
// no pointer-events:none, so it silently ate every pointer event before
// the canvas ever saw them) and what let the mesh paint over the button
// (relying on z-index arithmetic between a WebGL canvas and DOM siblings,
// which didn't hold). The terrain is now a normal, bounded, in-flow block
// on the page — nothing else ever spatially overlaps it, so there's
// nothing left to fight over stacking order, and no invisible layer left
// to swallow the drag.
//
// The TAKE THE JOURNEY button is removed from /writing for this pass
// (temporarily, per instruction) so the terrain can be iterated on without
// the occlusion bug in the way. Discovery signs, hover, and BROWSE's
// click-to-month are deprioritized this pass too — get the line-drawn
// shape and the fixed interaction confirmed first. ──

export interface TerrainMonth {
  month: string; // YYYY-MM
  count: number;
  words: number;
}

interface Props {
  months: TerrainMonth[];
  dim?: boolean;                          // recedes visually — BROWSE's list is showing on top
  onMonthClick?: (month: string) => void; // unused this pass — BROWSE is unreachable without the button
}

// ── scene layout — world units, not pixels. The container's on-screen
// pixel size is what changed this pass (bounded instead of full-viewport);
// these proportions are untouched, and the smaller container reframes them
// automatically via the perspective camera's aspect ratio. ──
const SCENE_WIDTH  = 10;
const SCENE_DEPTH  = 7;
const HEIGHT_SCALE = 3.2;

// ── Catmull-Rom across the 19 known points — passes exactly through each
// real value, smoothly curved between them, unlike a linear/segment join. ──
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function heightAt(values: number[], xNorm: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  const clamped = Math.max(0, Math.min(1, xNorm));
  const scaled = clamped * (n - 1);
  const i = Math.floor(scaled);
  const t = scaled - i;
  const p0 = values[Math.max(0, i - 1)];
  const p1 = values[Math.min(n - 1, i)];
  const p2 = values[Math.min(n - 1, i + 1)];
  const p3 = values[Math.min(n - 1, i + 2)];
  return catmullRom(p0, p1, p2, p3, t);
}

// ── word-density character — a second real data signal (words/count per
// month, i.e. average words per poem, NOT raw word count) that changes how
// the lines are drawn, not just their colour. Log-scaled before normalising
// because the raw range is extreme (Jan 2026: one 1,104-word poem, ~11x the
// next-densest month) — a linear 0..1 normalisation would crush every other
// month to near-zero and make "moderate" indistinguishable from "empty".
// Log-scaling turns that one outlier into a clear, singular high point
// instead of blowing out the whole scale. ──
function smoothstepRange(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function computeDensities(months: TerrainMonth[]): number[] {
  const perPoem = months.map(m => m.count > 0 ? m.words / m.count : 0);
  const logs = perPoem.map(d => d > 0 ? Math.log(d) : 0);
  const valid = months.map((m, i) => (m.count > 0 ? logs[i] : null)).filter((v): v is number => v !== null);
  const minLog = valid.length ? Math.min(...valid) : 0;
  const maxLog = valid.length ? Math.max(...valid) : 1;
  const range = maxLog - minLog || 1;
  return months.map((m, i) => (m.count > 0 ? Math.max(0, Math.min(1, (logs[i] - minLog) / range)) : 0));
}

// Linear (not Catmull-Rom) between adjacent months' density — density reads
// as a per-month character, not a smoothly overshooting curve; linear keeps
// the transition into and out of a water/plains month legible.
function densityAt(densities: number[], xNorm: number): number {
  const n = densities.length;
  if (n === 0) return 0;
  if (n === 1) return densities[0];
  const clamped = Math.max(0, Math.min(1, xNorm));
  const scaled = clamped * (n - 1);
  const i = Math.floor(scaled);
  const t = scaled - i;
  const a = densities[Math.min(n - 1, i)];
  const b = densities[Math.min(n - 1, i + 1)];
  return a + (b - a) * t;
}

// Thresholds tuned against the real 19-month archive (verified numerically,
// not guessed): only Jan 2026 (1 poem, 1,104 words) clears the water band,
// giving one unambiguous water-source point rather than a common state.
// Five months (Feb/Sep '25, Apr/May '26, and near-neighbours) sit in the
// full plains band; two more sit in a soft partial-fade band between.
const WATER_LO = 0.6, WATER_HI = 0.85;
const PLAINS_LO = 0.03, PLAINS_HI = 0.13;
const PLAINS_DRAW_CUTOFF = 0.6;   // beyond this, lines start thinning out
const PLAINS_MIN_SURVIVAL = 0.16; // at maximum plains intensity, this fraction of lines still survive — sparse, not a clean-edged hole

function waterIntensityAt(d: number): number { return smoothstepRange(WATER_LO, WATER_HI, d); }
function plainsIntensityAt(d: number): number { return 1 - smoothstepRange(PLAINS_LO, PLAINS_HI, d); }
// Beyond the cutoff, the chance any given line survives through a plains
// x-range falls off toward PLAINS_MIN_SURVIVAL rather than dropping straight
// to zero — a handful of lines keep going, thinned and patchy, instead of
// every line cutting out at once (which read as a canyon slit, not thin
// ground, when tried at full-cutoff).
function plainsSurviveChance(plains: number): number {
  if (plains < PLAINS_DRAW_CUTOFF) return 1;
  const t = (plains - PLAINS_DRAW_CUTOFF) / (1 - PLAINS_DRAW_CUTOFF);
  return 1 - t * (1 - PLAINS_MIN_SURVIVAL);
}

// MILAT seam x — same day-fraction interpolation as the earlier passes,
// just in scene x-units instead of pixels. Shared boundary-date lookup, not
// re-derived or hardcoded.
function seamX(months: TerrainMonth[]): number | null {
  const boundary = provenanceBoundaryDate();
  if (!boundary) return null;
  const [by, bm, bd] = boundary.split("-").map(Number);
  if (!by || !bm || !bd) return null;
  const boundaryMonth = `${by}-${String(bm).padStart(2, "0")}`;
  const idx = months.findIndex(m => m.month === boundaryMonth);
  if (idx === -1) return null;
  const n = months.length;
  const idxX = n > 1 ? (idx / (n - 1) - 0.5) * SCENE_WIDTH : 0;
  if (idx === 0) return idxX;
  const prevX = n > 1 ? ((idx - 1) / (n - 1) - 0.5) * SCENE_WIDTH : 0;
  const daysInMonth = new Date(by, bm, 0).getDate();
  const frac = Math.max(0, Math.min(1, (bd - 1) / daysInMonth));
  return prevX + (idxX - prevX) * frac;
}

// ── deterministic value noise + FBM (unchanged from the prior pass) ──
function hashNoise2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000000) / 1000000;
}
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }
function valueNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const sx = smoothstep(x - x0), sy = smoothstep(y - y0);
  const n00 = hashNoise2D(x0, y0, seed), n10 = hashNoise2D(x0 + 1, y0, seed);
  const n01 = hashNoise2D(x0, y0 + 1, seed), n11 = hashNoise2D(x0 + 1, y0 + 1, seed);
  const ix0 = n00 + (n10 - n00) * sx, ix1 = n01 + (n11 - n01) * sx;
  return ix0 + (ix1 - ix0) * sy;
}
function fbm2D(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2D(x * freq, y * freq, seed + o * 101) * amp;
    maxAmp += amp;
    amp *= 0.5;
    freq *= 2.15;
  }
  return sum / maxAmp;
}

const MICRO_AMPLITUDE = 0.045;
const TAPER_NOISE_FREQ_X = 0.6, TAPER_NOISE_FREQ_Z = 1.1, TAPER_SEED = 5301;
const MICRO_FREQ_X = 3.4, MICRO_FREQ_Z = 4.1, MICRO_SEED = 8807;

// The terrain's height at any (x, z) — unchanged math from the solid-mesh
// pass (centreline-guaranteed real data, per-x falloff sharpness, per-point
// roughness scaled by local data intensity), just repackaged as a plain
// sampling function instead of a per-vertex mesh-builder loop, since the
// line renderer below only needs to sample it at chosen points, not build
// a continuous surface out of it.
//
// One addition this pass: roughness is now also damped by local word-
// density (`densities`), independent of height/count. A water-source month
// reads calmer/smoother right at that point — "smoother, less jagged" is
// enacted in the actual height-generation math, not just drawn differently
// on top of unchanged geometry. Plains months don't change height at all
// here; their character is entirely an absence of linework (below).
function terrainHeightAt(normalized: number[], densities: number[], x: number, z: number): number {
  const xNorm = x / SCENE_WIDTH + 0.5;
  const zNorm = z / (SCENE_DEPTH / 2);
  const localIntensity = heightAt(normalized, xNorm);
  const localDensity = densityAt(densities, xNorm);
  const water = waterIntensityAt(localDensity);

  const centerFalloff = Math.max(0, Math.cos(zNorm * Math.PI / 2));
  const falloffNoise = fbm2D(x * TAPER_NOISE_FREQ_X, z * TAPER_NOISE_FREQ_Z, TAPER_SEED, 3);
  const falloffSharpness = 0.7 + 1.4 * falloffNoise;
  const taper = Math.pow(centerFalloff, falloffSharpness);
  const base = localIntensity * HEIGHT_SCALE * taper;

  const localRoughness = MICRO_AMPLITUDE * (0.35 + 1.3 * localIntensity) * (1 - water * 0.7);
  const micro = (fbm2D(x * MICRO_FREQ_X, z * MICRO_FREQ_Z, MICRO_SEED, 4) - 0.5) * 2 * localRoughness;

  return Math.max(0, base + micro);
}

// ── The landform, drawn as lines ──
// Many parallel cross-section silhouettes across the depth axis, each a
// clean line strip, no fill. Nearer lines occlude farther ones through
// ordinary WebGL depth testing (the default for LineBasicMaterial) — no
// custom visibility algorithm needed. A subtle opacity gradient by depth
// reinforces it further. Because falloffNoise above genuinely varies with
// z, adjacent slices show different character for the "same" peak — sharp
// in one line, rounder in the next — which is exactly the multi-scale read
// the solid-mesh version was trying and failing to get from shading alone.
const PROFILE_COUNT = 48;
const PROFILE_SAMPLES = 100;

// Each profile line is now built as one or more RUNS instead of one
// continuous strip. Where a stretch of the line crosses a strong-plains
// x-range, its points are dropped from the buffer entirely — the run ends,
// and (if the line resumes past the gap) a new, separate run begins. That
// gap is the plains character: an absence of linework standing in for thin,
// sparse ground, not a fainter version of the same line. Where a run
// crosses a water-source x-range, its opacity is boosted instead — still
// the same technique, just weighted differently, reinforced by the ripple
// rings drawn separately below.
function ProfileLines({ months, normalized, densities }: { months: TerrainMonth[]; normalized: number[]; densities: number[] }) {
  const runs = useMemo(() => {
    const out: { positions: Float32Array; opacity: number }[] = [];
    for (let li = 0; li < PROFILE_COUNT; li++) {
      const zt = PROFILE_COUNT > 1 ? li / (PROFILE_COUNT - 1) : 0.5; // 0..1
      const z = (zt - 0.5) * SCENE_DEPTH;
      const baseOpacity = 0.32 + 0.4 * zt; // nearer slices read slightly brighter

      let current: number[] = []; // flat x,y,z triples
      let currentD: number[] = [];
      const flush = () => {
        if (current.length >= 6) { // at least 2 points
          const avgD = currentD.reduce((a, b) => a + b, 0) / currentD.length;
          const water = waterIntensityAt(avgD);
          const plains = plainsIntensityAt(avgD);
          const opacity = Math.max(0.05, Math.min(1, baseOpacity * (1 - plains * 0.45) * (1 + water * 0.55)));
          out.push({ positions: new Float32Array(current), opacity });
        }
        current = []; currentD = [];
      };

      for (let pi = 0; pi < PROFILE_SAMPLES; pi++) {
        const xNorm = pi / (PROFILE_SAMPLES - 1);
        const d = densityAt(densities, xNorm);
        const plains = plainsIntensityAt(d);
        // Deterministic per-(line, sample) hash decides survival — not a
        // hard cutoff, so a plains stretch thins out patchily across the
        // 48 lines instead of every line dropping the same x-range at once.
        const survives = hashNoise2D(li, pi, 9001) < plainsSurviveChance(plains);
        if (!survives) {
          flush(); // gap — the ground here doesn't get an outline
          continue;
        }
        const x = (xNorm - 0.5) * SCENE_WIDTH;
        const y = terrainHeightAt(normalized, densities, x, z);
        current.push(x, y, z);
        currentD.push(d);
      }
      flush();
    }
    return out;
  }, [months, normalized, densities]);

  return (
    <>
      {runs.map((l, i) => (
        <line key={i}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[l.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={l.opacity} />
        </line>
      ))}
    </>
  );
}

// Water-source character's second half: concentric ripple rings, flat and
// horizontal (not following the ridge's slope) at the local terrain height
// — a pooled-water read, and a genuinely different line pattern from the
// profile silhouettes, not a recoloured version of them. Centred at z=0
// (the real-data centreline) and flattened in z to match the scene's own
// depth compression. Only months clearing the water threshold produce
// anything — for the current archive, that's Jan 2026 alone.
const WATER_RIPPLE_RINGS = 5;
const WATER_RIPPLE_MAX_RADIUS = 1.05;

function WaterRipples({ months, normalized, densities }: { months: TerrainMonth[]; normalized: number[]; densities: number[] }) {
  const ripples = useMemo(() => {
    const n = months.length;
    const out: { positions: Float32Array; opacity: number }[] = [];
    for (let i = 0; i < n; i++) {
      const water = waterIntensityAt(densities[i]);
      if (water < 0.08) continue;
      const xNorm = n > 1 ? i / (n - 1) : 0.5;
      const x = (xNorm - 0.5) * SCENE_WIDTH;
      // A small fixed lift above the local terrain height — Jan 2026 (this
      // archive's one water-source month) is also a very short peak, so
      // pinning the rings exactly at ground height buried them inside the
      // surrounding profile lines. The lift keeps the signature legible as
      // its own marker regardless of how tall the ridge is at that point.
      const y = terrainHeightAt(normalized, densities, x, 0) + 0.09;
      for (let r = 1; r <= WATER_RIPPLE_RINGS; r++) {
        const radius = (r / WATER_RIPPLE_RINGS) * WATER_RIPPLE_MAX_RADIUS * (0.5 + 0.5 * water);
        const segs = 48;
        const arr = new Float32Array((segs + 1) * 3);
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          arr[s * 3]     = x + Math.cos(a) * radius;
          arr[s * 3 + 1] = y - r * 0.012 * water;
          arr[s * 3 + 2] = Math.sin(a) * radius * 0.62; // flattened to match depth compression
        }
        out.push({ positions: arr, opacity: (0.6 - r * 0.06) * water });
      }
    }
    return out;
  }, [months, normalized, densities]);

  return (
    <>
      {ripples.map((rp, i) => (
        <line key={i}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[rp.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={rp.opacity} />
        </line>
      ))}
    </>
  );
}

// The full-page ambient sonar field — unrelated to the carpet, stays
// outside the rotating assembly, fixed in world space regardless of how
// the object spins.
function BackgroundField() {
  const positions = useMemo(() => {
    const rand = mulberry32(4242);
    const n = 700;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3]     = (rand() - 0.5) * SCENE_WIDTH * 3;
      arr[i * 3 + 1] = rand() * HEIGHT_SCALE * 1.5;
      arr[i * 3 + 2] = (rand() - 0.5) * SCENE_DEPTH * 7;
    }
    return arr;
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#0a0a0a" size={0.03} sizeAttenuation transparent opacity={0.12} depthWrite={false} />
    </points>
  );
}

// ── The carpet — a platform the mountain sits on, kept from the prior
// pass. Proportions unchanged (they scale with the container automatically
// via the perspective camera), still extends beyond the terrain's own
// footprint, still meets the terrain's y=0 baseline. ──
const CARPET_WIDTH = SCENE_WIDTH * 1.9;
const CARPET_DEPTH = SCENE_DEPTH * 2.4;
const CARPET_Y = -0.03;

function CarpetSurface() {
  return (
    <mesh position={[0, CARPET_Y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[CARPET_WIDTH, CARPET_DEPTH]} />
      {/* Low opacity — verified via the rasterizer that 0.55 read as a
          solid dark rectangle dominating the frame, not a surface the
          mountain quietly rests on. */}
      <meshStandardMaterial color="#0d0f0a" roughness={0.95} metalness={0} transparent opacity={0.22} />
    </mesh>
  );
}

function CarpetField() {
  const positions = useMemo(() => {
    const rand = mulberry32(6161);
    const n = 600;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3]     = (rand() - 0.5) * CARPET_WIDTH;
      arr[i * 3 + 1] = CARPET_Y + (rand() - 0.5) * 0.06;
      arr[i * 3 + 2] = (rand() - 0.5) * CARPET_DEPTH;
    }
    return arr;
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#0a0a0a" size={0.026} sizeAttenuation transparent opacity={0.15} depthWrite={false} />
    </points>
  );
}

// A ring of small tick marks at the carpet's rim, inside the rotating
// assembly — the visible, minimal, unlabeled affordance that this is a
// turntable: as the reader drags, the ring visibly sweeps with everything
// else.
function TurntableRing() {
  const TICKS = 16;
  const RADIUS = Math.min(CARPET_WIDTH, CARPET_DEPTH) * 0.44;
  const items = useMemo(() => {
    const arr: { x: number; z: number; primary: boolean }[] = [];
    for (let i = 0; i < TICKS; i++) {
      const a = (i / TICKS) * Math.PI * 2;
      arr.push({ x: Math.cos(a) * RADIUS, z: Math.sin(a) * RADIUS, primary: i % 4 === 0 });
    }
    return arr;
  }, []);
  return (
    <>
      {items.map((t, i) => (
        <mesh key={i} position={[t.x, CARPET_Y + 0.015, t.z]}>
          <cylinderGeometry args={[t.primary ? 0.038 : 0.02, t.primary ? 0.038 : 0.02, 0.018, 8]} />
          <meshBasicMaterial color="#0a0a0a" transparent opacity={t.primary ? 0.38 : 0.2} />
        </mesh>
      ))}
    </>
  );
}

// A faint seam line — the MILAT boundary. No hover-reveal this pass
// (discovery signs are deprioritized); just a quiet vertical crossing,
// consistent with the line-drawn language everything else here now uses.
function SeamMarker({ x }: { x: number }) {
  const positions = useMemo(() => new Float32Array([x, 0, 0, x, HEIGHT_SCALE * 1.3, 0]), [x]);
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#0a0a0a" transparent opacity={0.3} />
    </line>
  );
}

// Camera — fixed, always, at the verified angle (elevation ~35°, azimuth
// ~28°). Never moves for rotation (the object spins instead); only zoom
// (distance along this same fixed angle) can move it.
const CAM_ELEVATION_DEG = 35;
const CAM_AZIMUTH_DEG   = 28;
const CAM_DISTANCE      = SCENE_WIDTH * 1.15;
const CAM_MIN_DISTANCE  = SCENE_WIDTH * 0.55;
const CAM_MAX_DISTANCE  = SCENE_WIDTH * 2.2;
const DEFAULT_TARGET: [number, number, number] = [0, HEIGHT_SCALE * 0.2, 0];
const DEFAULT_CAM_POS: [number, number, number] = (() => {
  const elev = CAM_ELEVATION_DEG * Math.PI / 180;
  const az   = CAM_AZIMUTH_DEG   * Math.PI / 180;
  return [
    DEFAULT_TARGET[0] + CAM_DISTANCE * Math.cos(elev) * Math.sin(az),
    DEFAULT_TARGET[1] + CAM_DISTANCE * Math.sin(elev),
    DEFAULT_TARGET[2] + CAM_DISTANCE * Math.cos(elev) * Math.cos(az),
  ];
})();

// Light — kept for the carpet's benefit (its MeshStandardMaterial still
// responds to it); the terrain itself no longer uses any lit material, so
// this has no effect on the mountain's own lines.
const LIGHT_ELEVATION_DEG = 38;
const LIGHT_AZIMUTH_DEG   = 65;
const LIGHT_DISTANCE      = SCENE_WIDTH * 1.5;
const DIRECTIONAL_LIGHT_POS: [number, number, number] = (() => {
  const elev = LIGHT_ELEVATION_DEG * Math.PI / 180;
  const az   = LIGHT_AZIMUTH_DEG   * Math.PI / 180;
  return [
    LIGHT_DISTANCE * Math.cos(elev) * Math.sin(az),
    LIGHT_DISTANCE * Math.sin(elev),
    LIGHT_DISTANCE * Math.cos(elev) * Math.cos(az),
  ];
})();

// Reads rotationRef every frame and applies it to a group wrapping the
// whole turntable assembly (carpet + terrain lines) — driven by DOM-level
// drag handlers on LandingTerrain's outer wrapper, not R3F's own pointer
// events, so "drag anywhere on the canvas" works regardless of what's
// under the cursor. Applies residual spin (inertia) on release.
function TurntableAssembly({
  rotationRef, draggingRef, velocityRef, children,
}: {
  rotationRef: React.MutableRefObject<number>;
  draggingRef: React.MutableRefObject<boolean>;
  velocityRef: React.MutableRefObject<number>;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!draggingRef.current) {
      rotationRef.current += velocityRef.current;
      velocityRef.current *= 0.92;
    }
    if (groupRef.current) groupRef.current.rotation.y = rotationRef.current;
  });
  return <group ref={groupRef}>{children}</group>;
}

// Applies distanceRef (driven by wheel/pinch) to the camera every frame,
// keeping the exact same fixed elevation/azimuth angle always.
function CameraRig({ distanceRef }: { distanceRef: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  useFrame(() => {
    const elev = CAM_ELEVATION_DEG * Math.PI / 180;
    const az   = CAM_AZIMUTH_DEG   * Math.PI / 180;
    const d = distanceRef.current;
    camera.position.set(
      DEFAULT_TARGET[0] + d * Math.cos(elev) * Math.sin(az),
      DEFAULT_TARGET[1] + d * Math.sin(elev),
      DEFAULT_TARGET[2] + d * Math.cos(elev) * Math.cos(az),
    );
    camera.lookAt(DEFAULT_TARGET[0], DEFAULT_TARGET[1], DEFAULT_TARGET[2]);
  });
  return null;
}

function Scene({
  months, rotationRef, draggingRef, velocityRef, distanceRef,
}: {
  months: TerrainMonth[];
  rotationRef: React.MutableRefObject<number>;
  draggingRef: React.MutableRefObject<boolean>;
  velocityRef: React.MutableRefObject<number>;
  distanceRef: React.MutableRefObject<number>;
}) {
  const seam = useMemo(() => seamX(months), [months]);
  const normalized = useMemo(() => {
    const maxCount = Math.max(1, ...months.map(m => m.count));
    return months.map(m => m.count / maxCount);
  }, [months]);
  const densities = useMemo(() => computeDensities(months), [months]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={DIRECTIONAL_LIGHT_POS} intensity={2.4} />
      <CameraRig distanceRef={distanceRef} />

      <BackgroundField />

      <TurntableAssembly rotationRef={rotationRef} draggingRef={draggingRef} velocityRef={velocityRef}>
        <CarpetSurface />
        <CarpetField />
        <TurntableRing />
        <ProfileLines months={months} normalized={normalized} densities={densities} />
        <WaterRipples months={months} normalized={normalized} densities={densities} />
        {seam != null && <SeamMarker x={seam} />}
      </TurntableAssembly>
    </>
  );
}

const ROTATE_SENSITIVITY = 0.0075; // radians per pixel of horizontal drag
const ZOOM_SENSITIVITY = 0.01;

export default function LandingTerrain({ months, dim = false }: Props) {
  // Turntable drag state — lives here (not in Scene) since the drag itself
  // is handled at the DOM level on the outer wrapper below, so "drag
  // anywhere on the canvas" works regardless of what 3D object (if any) is
  // under the cursor.
  const rotationRef = useRef(0);
  const velocityRef = useRef(0);
  const draggingRef = useRef(false);
  const distanceRef = useRef(CAM_DISTANCE);
  const lastXRef = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    velocityRef.current = 0;
    lastXRef.current = e.clientX;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastXRef.current;
    lastXRef.current = e.clientX;
    const delta = dx * ROTATE_SENSITIVITY;
    rotationRef.current += delta;
    velocityRef.current = delta;
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }, []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    distanceRef.current = Math.max(CAM_MIN_DISTANCE, Math.min(CAM_MAX_DISTANCE, distanceRef.current + e.deltaY * ZOOM_SENSITIVITY));
  }, []);

  if (months.length === 0) return null;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{
        // A normal, bounded, in-flow block — not a full-viewport fixed
        // backdrop. Nothing else on the page spatially overlaps this box,
        // which is what actually fixes both the occlusion bug and the
        // "canvas eating events meant for it" bug: there's no longer a
        // foreground layer sitting on top of it at all.
        width: "100%",
        maxWidth: "880px",
        height: "clamp(340px, 52vh, 540px)",
        margin: "3rem auto 0",
        position: "relative",
        opacity: dim ? 0.16 : 1,
        pointerEvents: dim ? "none" : "auto",
        transition: "opacity 400ms",
        touchAction: "none",
        cursor: "grab",
      }}
    >
      <Canvas camera={{ position: DEFAULT_CAM_POS, fov: 46 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Scene
          months={months}
          rotationRef={rotationRef}
          draggingRef={draggingRef}
          velocityRef={velocityRef}
          distanceRef={distanceRef}
        />
      </Canvas>
    </div>
  );
}
