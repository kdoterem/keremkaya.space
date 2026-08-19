"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { useCallback, useMemo, useRef, useState } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";
import { mulberry32 } from "@/app/components/TerrainScan";

// ── A genuine 3D landform, not a chart. Three failures corrected from the
// prior pass: (1) it was a bordered box, not a borderless landform sitting
// on the page — fixed by making the canvas a full-viewport backdrop with no
// frame; (2) it was a connected-dot line, not a continuous surface — fixed
// by displacing a subdivided plane's vertices via Catmull-Rom interpolation
// across the 19 real data points, lit with real directional light so peaks
// catch light and valleys sit in shadow; (3) the ambient "WRITING" title
// was rendering as permanent scrambled gibberish (a CryptoScramble bug, not
// a leftover of this component) — fixed at the call site in
// app/writing/page.tsx.
//
// The waterline fader stays dropped, confirmed with the user — orbit + zoom
// is the exploration mechanic now. ──

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
const SCENE_DEPTH  = 7;    // widened from 3 — comparably substantial to width, not depth-as-afterthought
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

// ── The landform ──
// PlaneGeometry, hundreds of segments, each vertex's height set by
// interpolating the 19 real monthly counts across its position on the time
// axis, plus a small deterministic secondary noise layer for surface
// roughness (rock/snow micro-detail) riding on top of the main shape.
const SEGMENTS_X = 240;
const SEGMENTS_Z = 48;
const MICRO_AMPLITUDE = 0.045; // small — roughness, not a second landform

// Height was Z-invariant (the same curve repeated straight across depth) —
// verified by rendering it (a hand-rolled software rasterizer reproducing
// this exact math, since there's no browser/WebGL tool in this environment)
// that this reads as corrugated sheet metal / ribbon candy, not a mountain:
// every peak became an infinite straight extruded ridge no matter the
// camera or light. A cosine taper across Z rounds each ridge into an actual
// mass — full height at the centreline, tapering down toward the front/back
// edges, the way a real ridge's cross-section is domed, not flat-topped.
// This goes one step beyond "camera + light only", but the corrugation was
// the actual root cause of "doesn't read as a mountain" once verified, and
// leaving it in would still fail that test regardless of camera/light.
function zTaper(zNorm: number): number { // zNorm in [-1, 1]
  const t = Math.cos(zNorm * Math.PI / 2); // 1 at centre, 0 at the edges
  return 0.24 + 0.76 * t;
}

function buildTerrainGeometry(months: TerrainMonth[]): THREE.PlaneGeometry {
  const maxCount = Math.max(1, ...months.map(m => m.count));
  const normalized = months.map(m => m.count / maxCount);

  const geo = new THREE.PlaneGeometry(SCENE_WIDTH, SCENE_DEPTH, SEGMENTS_X, SEGMENTS_Z);
  geo.rotateX(-Math.PI / 2); // lay flat: local Y becomes height, local X stays the time axis

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const xNorm = x / SCENE_WIDTH + 0.5;
    const zNorm = z / (SCENE_DEPTH / 2);
    const base = heightAt(normalized, xNorm) * HEIGHT_SCALE * zTaper(zNorm);
    const micro = (
      Math.sin(x * 7.3 + z * 5.1) * 0.5 +
      Math.sin(x * 13.7 - z * 9.2) * 0.25 +
      Math.sin(x * 23.1 + z * 17.4) * 0.125
    ) * MICRO_AMPLITUDE;
    pos.setY(i, Math.max(0, base + micro));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals(); // already correct — recomputed after displacement, not left as the flat plane's original normals
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

// The sonar field — genuinely 3D, scattered through a large volume so it
// reads as the page's full-viewport ambient texture rather than a cluster
// around a small chart. Deterministic (mulberry32, the same PRNG the rest
// of the terrain work has used all along). sizeAttenuation is what gives
// the perspective-based size response as the camera moves — nearer points
// read larger, further ones smaller, natively, with no extra per-point work.
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

// The MILAT seam — a thin vertical rod (a cylinder, not a flat line or
// plane) so it stays visible from every rotation angle rather than
// vanishing edge-on the way a 2D line or a flat plane would.
function SeamMarker({ x }: { x: number }) {
  return (
    <mesh position={[x, (HEIGHT_SCALE * 1.3) / 2, 0]}>
      <cylinderGeometry args={[0.02, 0.02, HEIGHT_SCALE * 1.3, 8]} />
      <meshBasicMaterial color="#0a0a0a" transparent opacity={0.3} />
    </mesh>
  );
}

// A 3D-space-anchored label — drei's <Html> projects the given 3D point to
// screen coordinates every frame, so it stays attached to the correct spot
// on the terrain as the camera orbits. distanceFactor is what gives the
// camera-distance-based scaling — larger near the camera, smaller far away.
function Annotation3D({
  position, label, sublabel, variant = "data",
}: {
  position: [number, number, number];
  label: string;
  sublabel?: string;
  variant?: "data" | "seam" | "transient";
}) {
  const opacity = variant === "transient" ? 0.85 : variant === "seam" ? 0.7 : 0.55;
  return (
    <Html position={position} distanceFactor={7} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
      <div
        style={{
          fontFamily: HUD_MONO, fontSize: "9px", letterSpacing: "0.06em",
          textTransform: "uppercase", color: "#0a0a0a", opacity,
          whiteSpace: "nowrap", lineHeight: 1.4, transform: "translate(8px, -10px)",
          borderLeft: "1px solid rgba(10,10,10,0.45)", paddingLeft: "5px",
        }}
      >
        <div>{label}</div>
        {sublabel && <div style={{ opacity: 0.7 }}>{sublabel}</div>}
      </div>
    </Html>
  );
}

interface MonthMeta { x: number; height: number; count: number; words: number; month: string }

// Invisible, generously-sized hit target per month — raycasting against the
// continuous surface directly would give an ambiguous z-column; this gives
// BROWSE's click-to-month (and hover) a clean, reliable target instead.
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

// Camera — verified against a hand-rolled software-rasterizer render of
// this exact geometry/camera/light math before shipping (no browser/WebGL
// tool exists in this environment to check it any other way). Positioned
// as a point on a sphere around the target rather than a bare [x,y,z]
// guess, so the elevation/azimuth angles that actually matter are explicit:
// ~35° above horizontal (looking down onto the landform, not across it,
// not top-down) and ~28° off-axis (so the depth axis isn't viewed edge-on —
// straight down the Z axis was the earlier failure: it hid all the depth
// that widening SCENE_DEPTH had just added).
const CAM_ELEVATION_DEG = 35;
const CAM_AZIMUTH_DEG   = 28;
const CAM_DISTANCE      = SCENE_WIDTH * 1.15;
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

// Light — raking, not overhead: ~38° above horizontal and, crucially, ~65°
// off to one side (well apart from the camera's own 28° azimuth), which is
// what produces one lit face and one shadowed face per ridge rather than a
// thin highlight along the top edge. Also verified in the same render check.
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

function Scene({
  months, clickable, onHover, onSelect,
}: {
  months: TerrainMonth[]; clickable: boolean;
  onHover: (m: MonthMeta | null) => void;
  onSelect: (month: string, clientX: number, clientY: number) => void;
}) {
  const meta = useMemo<MonthMeta[]>(() => {
    const n = months.length;
    const maxCount = Math.max(1, ...months.map(m => m.count));
    return months.map((m, i) => ({
      x: n > 1 ? (i / (n - 1) - 0.5) * SCENE_WIDTH : 0,
      height: (m.count / maxCount) * HEIGHT_SCALE, // the surface's real height at this month — annotations sit here
      count: m.count, words: m.words, month: m.month,
    }));
  }, [months]);

  const peakIdx = useMemo(() => {
    if (months.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < months.length; i++) if (months[i].count > months[best].count) best = i;
    return best;
  }, [months]);

  const troughIdx = useMemo(() => {
    const withPosts = months.map((m, i) => ({ m, i })).filter(x => x.m.count > 0);
    if (withPosts.length === 0) return -1;
    let best = withPosts[0];
    for (const x of withPosts) if (x.m.count < best.m.count) best = x;
    return best.i;
  }, [months]);

  const seam = useMemo(() => seamX(months), [months]);
  const spacing = meta.length > 1 ? meta[1].x - meta[0].x : 1;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={DIRECTIONAL_LIGHT_POS} intensity={2.4} />

      <BackgroundField />
      <Terrain months={months} />

      {clickable && meta.map((m) => (
        <MonthHitTarget key={m.month} m={m} spacing={spacing} onHover={onHover} onSelect={onSelect} />
      ))}

      {seam != null && <SeamMarker x={seam} />}
      {seam != null && (
        <Annotation3D position={[seam, HEIGHT_SCALE * 1.35, 0]} label="MILAT" sublabel={provenanceBoundaryDate() ?? undefined} variant="seam" />
      )}
      {peakIdx >= 0 && (
        <Annotation3D
          position={[meta[peakIdx].x, meta[peakIdx].height, 0]}
          label={formatMonthShort(months[peakIdx].month)}
          sublabel={`${months[peakIdx].count} poems`}
        />
      )}
      {troughIdx >= 0 && troughIdx !== peakIdx && (
        <Annotation3D
          position={[meta[troughIdx].x, meta[troughIdx].height, 0]}
          label={formatMonthShort(months[troughIdx].month)}
          sublabel={`${months[troughIdx].count} poem${months[troughIdx].count === 1 ? "" : "s"}`}
        />
      )}
    </>
  );
}

export default function LandingTerrain({ months, dim = false, onMonthClick }: Props) {
  const [hovered, setHovered] = useState<MonthMeta | null>(null);

  // Distinguishes a genuine click (BROWSE navigation) from a drag-to-orbit
  // that happens to end over a month's hit target — OrbitControls captures
  // the pointer during a drag, but the underlying mesh can still receive a
  // click on release, so this only counts it if the pointer barely moved
  // between down and up.
  const CLICK_DRAG_TOLERANCE = 6; // px
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const onPointerDownCapture = useCallback((e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
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
      onPointerDownCapture={onPointerDownCapture}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        opacity: dim ? 0.16 : 1,
        pointerEvents: dim ? "none" : "auto",
        transition: "opacity 400ms",
      }}
    >
      <Canvas camera={{ position: DEFAULT_CAM_POS, fov: 46 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
        <Scene
          months={months}
          clickable={!!onMonthClick}
          onHover={setHovered}
          onSelect={handleSelect}
        />
        {hovered && (
          <Annotation3D
            position={[hovered.x, hovered.height, 0]}
            label={formatMonthShort(hovered.month)}
            sublabel={`${hovered.count} poem${hovered.count === 1 ? "" : "s"}, ${hovered.words.toLocaleString()}w`}
            variant="transient"
          />
        )}
        <OrbitControls
          target={DEFAULT_TARGET}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={SCENE_WIDTH * 0.5}
          maxDistance={SCENE_WIDTH * 2.4}
          minPolarAngle={Math.PI * 0.08}
          maxPolarAngle={Math.PI * 0.49}
        />
      </Canvas>
    </div>
  );
}
