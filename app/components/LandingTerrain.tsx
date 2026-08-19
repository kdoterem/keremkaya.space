"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useCallback, useMemo, useRef, useState } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";
import { mulberry32 } from "@/app/components/TerrainScan";

// ── A genuine 3D landform, not a chart — sitting on a platform, not
// floating in void, spun as a single object on a turntable rather than
// orbited by a camera, its points of interest discovered by approach
// rather than announced permanently. This pass adds those three things;
// the mesh geometry (multi-octave FBM noise, real-data-dominant heights,
// per-region roughness), the camera/light setup, and normals recalculation
// are all confirmed working from prior passes and untouched here. ──

export interface TerrainMonth {
  month: string; // YYYY-MM
  count: number;
  words: number;
}

interface Props {
  months: TerrainMonth[];
  dim?: boolean;                          // recedes visually — BROWSE's list is showing on top
  onMonthClick?: (month: string) => void; // present only in BROWSE mode
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatMonthShort(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

const HUD_MONO = '"SF Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace';

// ── scene layout — world units, not pixels ──
const SCENE_WIDTH  = 10;   // x spans -HALF..HALF — the time axis, Feb 2025 -> present
const SCENE_DEPTH  = 7;    // comparably substantial to width, not depth-as-afterthought
const HEIGHT_SCALE = 3.2;  // world units at the fullest month

// Material colour deviates from strict flat #0a0a0a — a pure-black surface
// under directional light still reads as flat, since black has no headroom
// to visibly lighten. This is the darkest/lightest pair the palette can
// bear while still reading as "black" against the green, per spec.
const SURFACE_COLOR = "#151515";

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

// ── The landform (unchanged from the prior pass) ──
const SEGMENTS_X = 240;
const SEGMENTS_Z = 48;
const MICRO_AMPLITUDE = 0.045;

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

const TAPER_NOISE_FREQ_X = 0.6, TAPER_NOISE_FREQ_Z = 1.1, TAPER_SEED = 5301;
const MICRO_FREQ_X = 3.4, MICRO_FREQ_Z = 4.1, MICRO_SEED = 8807;

function buildTerrainGeometry(months: TerrainMonth[]): THREE.PlaneGeometry {
  const maxCount = Math.max(1, ...months.map(m => m.count));
  const normalized = months.map(m => m.count / maxCount);

  const geo = new THREE.PlaneGeometry(SCENE_WIDTH, SCENE_DEPTH, SEGMENTS_X, SEGMENTS_Z);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const xNorm = x / SCENE_WIDTH + 0.5;
    const zNorm = z / (SCENE_DEPTH / 2);
    const localIntensity = heightAt(normalized, xNorm);

    const centerFalloff = Math.max(0, Math.cos(zNorm * Math.PI / 2));
    const falloffNoise = fbm2D(x * TAPER_NOISE_FREQ_X, z * TAPER_NOISE_FREQ_Z, TAPER_SEED, 3);
    const falloffSharpness = 0.7 + 1.4 * falloffNoise;
    const taper = Math.pow(centerFalloff, falloffSharpness);

    const base = localIntensity * HEIGHT_SCALE * taper;

    const localRoughness = MICRO_AMPLITUDE * (0.35 + 1.3 * localIntensity);
    const micro = (fbm2D(x * MICRO_FREQ_X, z * MICRO_FREQ_Z, MICRO_SEED, 4) - 0.5) * 2 * localRoughness;

    pos.setY(i, Math.max(0, base + micro));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function Terrain({ months }: { months: TerrainMonth[] }) {
  const geometry = useMemo(() => buildTerrainGeometry(months), [months]);
  return (
    <mesh geometry={geometry} receiveShadow castShadow>
      <meshStandardMaterial color={SURFACE_COLOR} roughness={0.82} metalness={0.04} />
    </mesh>
  );
}

// The full-page ambient sonar field — unrelated to the carpet, stays
// outside the rotating assembly, fixed in world space as the page's own
// backdrop texture regardless of how the object spins.
function BackgroundField() {
  const positions = useMemo(() => {
    const rand = mulberry32(4242);
    const n = 1100;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3]     = (rand() - 0.5) * SCENE_WIDTH * 3.4;
      arr[i * 3 + 1] = rand() * HEIGHT_SCALE * 1.6;
      arr[i * 3 + 2] = (rand() - 0.5) * SCENE_DEPTH * 9;
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

// ── The carpet ──
// A platform the mountain sits on — what makes it read as a scanned object
// in a scene rather than a shape floating in void. Extends well beyond the
// terrain's footprint, sits at the terrain's own y=0 baseline (its lowest
// points meet the platform rather than floating above or piercing through
// it), and carries the same dot-field texture as the page background,
// reoriented flat instead of scattered through a volume.
const CARPET_WIDTH = SCENE_WIDTH * 1.9;
const CARPET_DEPTH = SCENE_DEPTH * 2.4;
const CARPET_Y = -0.03;

function CarpetSurface() {
  return (
    <mesh position={[0, CARPET_Y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[CARPET_WIDTH, CARPET_DEPTH]} />
      <meshStandardMaterial color="#0d0f0a" roughness={0.95} metalness={0} transparent opacity={0.55} />
    </mesh>
  );
}

function CarpetField() {
  const positions = useMemo(() => {
    const rand = mulberry32(6161);
    const n = 900;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3]     = (rand() - 0.5) * CARPET_WIDTH;
      arr[i * 3 + 1] = CARPET_Y + (rand() - 0.5) * 0.06; // nearly flat — a surface, not a volume
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
// else. Every 4th tick reads slightly larger/brighter, echoing the fader's
// four reference dots from the 2D build.
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

// ── Discovery signs ──
// Replaces permanently-visible labels. Each point of interest is an almost
// imperceptible mark at rest — registering as "something is there" without
// announcing what — that brightens and reveals its label only on approach
// (hover on desktop, tap on touch), fading back when the reader moves away.
// The terrain becomes something scanned with attention, not captioned.
function DiscoverySign({
  position, label, sublabel, primary,
}: {
  position: [number, number, number];
  label: string;
  sublabel?: string;
  primary: boolean;
}) {
  const [near, setNear] = useState(false);
  const markRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef(0);
  const restOpacity = primary ? 0.42 : 0.2;
  const restScale = primary ? 1 : 0.65;

  useFrame(() => {
    const target = near ? 1 : 0;
    glowRef.current += (target - glowRef.current) * 0.15;
    const mesh = markRef.current;
    if (mesh) {
      const s = restScale * (1 + glowRef.current * 1.7);
      mesh.scale.setScalar(s);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = restOpacity + glowRef.current * (0.95 - restOpacity);
    }
  });

  return (
    <group position={position}>
      {/* generous invisible hit sphere — easy to discover, not just the tiny visible dot */}
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); setNear(true); }}
        onPointerOut={() => setNear(false)}
        onClick={(e) => { e.stopPropagation(); setNear(true); }} // touch: tap to reveal
      >
        <sphereGeometry args={[0.24, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={markRef}>
        <sphereGeometry args={[0.045, 10, 10]} />
        <meshBasicMaterial color="#0a0a0a" transparent opacity={restOpacity} />
      </mesh>
      {near && (
        <Html position={[0, 0, 0]} distanceFactor={7} style={{ pointerEvents: "none", zIndex: 9999 }}>
          <div
            style={{
              fontFamily: HUD_MONO, fontSize: "9px", letterSpacing: "0.06em",
              textTransform: "uppercase", color: "#0a0a0a",
              whiteSpace: "nowrap", lineHeight: 1.4, transform: "translate(8px, -10px)",
              background: "rgba(170,255,0,0.92)",
              border: "1px solid rgba(10,10,10,0.45)",
              padding: "2px 5px",
            }}
          >
            <div>{label}</div>
            {sublabel && <div style={{ opacity: 0.72 }}>{sublabel}</div>}
          </div>
        </Html>
      )}
    </group>
  );
}

// A faint, mostly-still-there seam — much fainter than the previous pass's
// always-bold rod, now a background cue rather than an announcement; the
// actual MILAT date reveal happens through its own DiscoverySign below.
function SeamMarker({ x }: { x: number }) {
  return (
    <mesh position={[x, (HEIGHT_SCALE * 1.3) / 2, 0]}>
      <cylinderGeometry args={[0.014, 0.014, HEIGHT_SCALE * 1.3, 8]} />
      <meshBasicMaterial color="#0a0a0a" transparent opacity={0.14} />
    </mesh>
  );
}

// Local extrema across the real monthly counts — every point where a
// stretch turns from rising to falling (a peak) or falling to rising (a
// valley), not just the single global max/min. Edge months compare against
// an open sentinel so the very first/last month can still register.
function findLocalExtrema(counts: number[], kind: "peak" | "valley"): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    const prev = i > 0 ? counts[i - 1] : (kind === "peak" ? -Infinity : Infinity);
    const next = i < counts.length - 1 ? counts[i + 1] : (kind === "peak" ? -Infinity : Infinity);
    const isExtreme = kind === "peak" ? (counts[i] > prev && counts[i] > next) : (counts[i] < prev && counts[i] < next);
    if (isExtreme) idxs.push(i);
  }
  return idxs;
}

interface MonthMeta { x: number; height: number; count: number; words: number; month: string }

// Invisible, generously-sized hit target per month — raycasting against the
// continuous surface directly would give an ambiguous z-column; this gives
// BROWSE's click-to-month (and hover) a clean, reliable target instead.
// Sits inside the rotating assembly, so clicks resolve correctly against
// the object's current orientation automatically (three.js raycasts in
// world space against the live transform, no manual math needed here).
function MonthHitTarget({
  m, spacing, onHover, onSelect,
}: {
  m: MonthMeta; spacing: number;
  onHover: (m: MonthMeta | null) => void;
  onSelect: (month: string, clientX: number, clientY: number) => void;
}) {
  return (
    <mesh
      position={[m.x, HEIGHT_SCALE * 0.65, 0]}
      onPointerMove={(e) => { e.stopPropagation(); onHover(m); }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onSelect(m.month, e.nativeEvent.clientX, e.nativeEvent.clientY); }}
    >
      <boxGeometry args={[Math.max(spacing * 0.9, 0.2), HEIGHT_SCALE * 1.3, SCENE_DEPTH * 1.6]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// Camera — fixed, always, at the verified angle (elevation ~35°, azimuth
// ~28°, confirmed against a hand-rolled render before shipping in an
// earlier pass). It no longer needs to move for rotation at all now that
// the OBJECT spins instead of the camera orbiting — this is a stricter
// reading of "don't touch the camera" than before, not a looser one: the
// camera never leaves this position except for zoom (distance only, same
// angle always).
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

// Light — unchanged: raking at ~38° elevation, ~65° azimuth, well apart
// from the camera's own azimuth so ridges show a lit face against a
// shadowed one. Stays outside the rotating assembly (fixed in world space)
// — a light that rotated with the object would look like the sun moving
// with it, not light falling on a turntable.
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
// whole turntable assembly (carpet + terrain + signs + click targets) —
// driven by DOM-level drag handlers on LandingTerrain's outer wrapper, not
// by R3F's own pointer events, so "drag anywhere on the canvas" works
// regardless of what's under the cursor. Applies residual spin (inertia)
// on release, decaying smoothly — the same "heavy, decelerating settle"
// physics language the rest of the site already uses.
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
// keeping the exact same fixed elevation/azimuth angle always — only the
// distance from the object changes.
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
  months, clickable, hovered, onHover, onSelect, rotationRef, draggingRef, velocityRef, distanceRef,
}: {
  months: TerrainMonth[]; clickable: boolean;
  hovered: MonthMeta | null;
  onHover: (m: MonthMeta | null) => void;
  onSelect: (month: string, clientX: number, clientY: number) => void;
  rotationRef: React.MutableRefObject<number>;
  draggingRef: React.MutableRefObject<boolean>;
  velocityRef: React.MutableRefObject<number>;
  distanceRef: React.MutableRefObject<number>;
}) {
  const meta = useMemo<MonthMeta[]>(() => {
    const n = months.length;
    const maxCount = Math.max(1, ...months.map(m => m.count));
    return months.map((m, i) => ({
      x: n > 1 ? (i / (n - 1) - 0.5) * SCENE_WIDTH : 0,
      height: (m.count / maxCount) * HEIGHT_SCALE,
      count: m.count, words: m.words, month: m.month,
    }));
  }, [months]);

  const counts = useMemo(() => months.map(m => m.count), [months]);
  const peakIdxs = useMemo(() => findLocalExtrema(counts, "peak"), [counts]);
  const valleyIdxs = useMemo(() => findLocalExtrema(counts, "valley").filter(i => months[i].count > 0), [counts, months]);

  const globalPeakIdx = useMemo(() => {
    if (months.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < months.length; i++) if (months[i].count > months[best].count) best = i;
    return best;
  }, [months]);

  const globalValleyIdx = useMemo(() => {
    const withPosts = months.map((m, i) => ({ m, i })).filter(x => x.m.count > 0);
    if (withPosts.length === 0) return -1;
    let best = withPosts[0];
    for (const x of withPosts) if (x.m.count < best.m.count) best = x;
    return best.i;
  }, [months]);

  const namedPeakIdx = useMemo(() => months.findIndex(m => m.month === "2026-05"), [months]);

  const seam = useMemo(() => seamX(months), [months]);
  const spacing = meta.length > 1 ? meta[1].x - meta[0].x : 1;

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
        <Terrain months={months} />

        {clickable && meta.map((m) => (
          <MonthHitTarget key={m.month} m={m} spacing={spacing} onHover={onHover} onSelect={onSelect} />
        ))}

        {seam != null && <SeamMarker x={seam} />}
        {seam != null && (
          <DiscoverySign
            position={[seam, HEIGHT_SCALE * 1.1, 0]}
            label="MILAT" sublabel={provenanceBoundaryDate() ?? undefined}
            primary
          />
        )}

        {peakIdxs.map(i => (
          <DiscoverySign
            key={`peak-${i}`}
            position={[meta[i].x, meta[i].height, 0]}
            label={formatMonthShort(months[i].month)}
            sublabel={`${months[i].count} poems`}
            primary={i === globalPeakIdx || i === namedPeakIdx}
          />
        ))}
        {valleyIdxs.map(i => (
          <DiscoverySign
            key={`valley-${i}`}
            position={[meta[i].x, meta[i].height, 0]}
            label={formatMonthShort(months[i].month)}
            sublabel={`${months[i].count} poem${months[i].count === 1 ? "" : "s"}`}
            primary={i === globalValleyIdx}
          />
        ))}

        {/* Rendered inside the same rotating group as its target point —
            outside it, this would stay fixed in world space while the
            terrain spun away underneath it. */}
        {hovered && (
          <Html position={[hovered.x, hovered.height, 0]} distanceFactor={7} style={{ pointerEvents: "none", zIndex: 9999 }}>
            <div
              style={{
                fontFamily: HUD_MONO, fontSize: "9px", letterSpacing: "0.06em",
                textTransform: "uppercase", color: "#0a0a0a",
                whiteSpace: "nowrap", lineHeight: 1.4, transform: "translate(8px, -10px)",
                background: "rgba(170,255,0,0.92)",
                border: "1px solid rgba(10,10,10,0.45)",
                padding: "2px 5px",
              }}
            >
              <div>{formatMonthShort(hovered.month)}</div>
              <div style={{ opacity: 0.72 }}>{hovered.count} poem{hovered.count === 1 ? "" : "s"}, {hovered.words.toLocaleString()}w</div>
            </div>
          </Html>
        )}
      </TurntableAssembly>
    </>
  );
}

const ROTATE_SENSITIVITY = 0.0075; // radians per pixel of horizontal drag
const ZOOM_SENSITIVITY = 0.01;

export default function LandingTerrain({ months, dim = false, onMonthClick }: Props) {
  const [hovered, setHovered] = useState<MonthMeta | null>(null);

  // Turntable drag state — lives here (not in Scene) since the drag itself
  // is handled at the DOM level on the outer wrapper below, so "drag
  // anywhere on the canvas" works regardless of what 3D object (if any) is
  // under the cursor, matching how OrbitControls' whole-canvas drag used
  // to feel, just rotating the object now instead of orbiting the camera.
  const rotationRef = useRef(0);
  const velocityRef = useRef(0);
  const draggingRef = useRef(false);
  const distanceRef = useRef(CAM_DISTANCE);
  const lastXRef = useRef(0);

  // Distinguishes a genuine click (BROWSE navigation) from a drag-to-rotate
  // that happens to end over a month's hit target — only a click whose
  // pointer barely moved counts.
  const CLICK_DRAG_TOLERANCE = 6; // px
  const downPos = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
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
    distanceRef.current = Math.max(CAM_MIN_DISTANCE, Math.min(CAM_MAX_DISTANCE, distanceRef.current + e.deltaY * ZOOM_SENSITIVITY));
  }, []);

  const handleSelect = useCallback((month: string, clientX: number, clientY: number) => {
    const d = downPos.current;
    const dist = d ? Math.hypot(clientX - d.x, clientY - d.y) : 0;
    if (dist > CLICK_DRAG_TOLERANCE) return; // that was a drag, not a click
    onMonthClick?.(month);
  }, [onMonthClick]);

  if (months.length === 0) return null;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        opacity: dim ? 0.16 : 1,
        pointerEvents: dim ? "none" : "auto",
        transition: "opacity 400ms",
        touchAction: "none",
      }}
    >
      <Canvas camera={{ position: DEFAULT_CAM_POS, fov: 46 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Scene
          months={months}
          clickable={!!onMonthClick}
          hovered={hovered}
          onHover={setHovered}
          onSelect={handleSelect}
          rotationRef={rotationRef}
          draggingRef={draggingRef}
          velocityRef={velocityRef}
          distanceRef={distanceRef}
        />
      </Canvas>
    </div>
  );
}
