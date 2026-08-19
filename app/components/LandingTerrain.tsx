"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { useCallback, useMemo, useRef, useState } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";
import { mulberry32 } from "@/app/components/TerrainScan";

// ── A genuine 3D scene — three attempts at faking depth in 2D (parallel
// offset lines, a crossing grid, perspective compression) were all the
// wrong tool. This is a real camera in a real three.js scene, orbitable.
// Replaces the SVG/wireframe rendering entirely, not a styling pass.
//
// The waterline fader is dropped (confirmed) — orbit + zoom is now the
// exploration mechanic that used to belong to the fader. Every month is
// directly reachable by rotating/zooming rather than raising a waterline. ──

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
const SCENE_DEPTH  = 2.4;  // z spread per month's point cluster — gives the ridge real mass
const HEIGHT_SCALE = 3.4;  // world units per fully-normalized (max) count

interface MonthPoint {
  x: number; y: number; count: number; words: number; month: string; elevFrac: number;
}

function layoutMonths(months: TerrainMonth[]): MonthPoint[] {
  const n = months.length;
  const maxCount = Math.max(1, ...months.map(m => m.count));
  return months.map((m, i) => {
    const x = n > 1 ? (i / (n - 1) - 0.5) * SCENE_WIDTH : 0;
    const elevFrac = m.count / maxCount;
    const y = elevFrac * HEIGHT_SCALE;
    return { x, y, count: m.count, words: m.words, month: m.month, elevFrac };
  });
}

// MILAT seam x — same day-fraction interpolation as the earlier 2D passes,
// just in scene x-units instead of pixels. Shared boundary-date lookup, not
// re-derived or hardcoded.
function seamX(months: TerrainMonth[], pts: MonthPoint[]): number | null {
  const boundary = provenanceBoundaryDate();
  if (!boundary) return null;
  const [by, bm, bd] = boundary.split("-").map(Number);
  if (!by || !bm || !bd) return null;
  const boundaryMonth = `${by}-${String(bm).padStart(2, "0")}`;
  const idx = months.findIndex(m => m.month === boundaryMonth);
  if (idx === -1) return null;
  if (idx === 0) return pts[0].x;
  const daysInMonth = new Date(by, bm, 0).getDate();
  const frac = Math.max(0, Math.min(1, (bd - 1) / daysInMonth));
  return pts[idx - 1].x + (pts[idx].x - pts[idx - 1].x) * frac;
}

// ── elevation -> point density/size/opacity, same tiered-weight principle
// as the 2D passes, now genuinely spatial: a peak isn't just brighter, it's
// physically more points occupying more of the cluster's depth. ──
const ELEV_TIERS   = [0.25, 0.5, 0.75];
const TIER_ROWS    = [2, 4, 6, 9];    // point rows across z, by tier
const TIER_SIZE    = [0.035, 0.05, 0.065, 0.085];
const TIER_OPACITY = [0.32, 0.5, 0.72, 0.95];

function elevationTier(frac: number): number {
  for (let i = 0; i < ELEV_TIERS.length; i++) if (frac < ELEV_TIERS[i]) return i;
  return ELEV_TIERS.length;
}

// A raw points object — hand-rolled via R3F's intrinsic elements (which map
// 1:1 to core three.js classes) rather than a drei sugar component, so this
// depends only on three.js's own long-stable BufferGeometry/PointsMaterial
// API, not a helper's specific prop shape.
function PointCloud({ positions, size, opacity }: { positions: Float32Array; size: number; opacity: number }) {
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#0a0a0a" size={size} sizeAttenuation transparent opacity={opacity} depthWrite={false} />
    </points>
  );
}

// The terrain itself — each month's real height becomes a small jittered
// cluster of points across z (mass, not a ribbon), grouped into up to 4
// tiered point-cloud objects so density/size/opacity can vary by elevation.
function TerrainPoints({ points }: { points: MonthPoint[] }) {
  const tierArrays = useMemo(() => {
    const buckets: number[][] = [[], [], [], []];
    points.forEach((p, i) => {
      const tier = elevationTier(p.elevFrac);
      const rand = mulberry32(9001 + i);
      const rows = TIER_ROWS[tier];
      for (let r = 0; r < rows; r++) {
        const z = rows > 1 ? (r / (rows - 1) - 0.5) * SCENE_DEPTH : 0;
        const jx = (rand() - 0.5) * 0.1;
        const jy = (rand() - 0.5) * 0.08;
        buckets[tier].push(p.x + jx, Math.max(0.015, p.y + jy), z);
      }
    });
    return buckets.map(b => new Float32Array(b));
  }, [points]);

  return (
    <>
      {tierArrays.map((arr, tier) => (
        arr.length === 0 ? null : (
          <PointCloud key={tier} positions={arr} size={TIER_SIZE[tier]} opacity={TIER_OPACITY[tier]} />
        )
      ))}
    </>
  );
}

// A very light connecting line through each month's true height — so the
// eye still reads it as continuous ground rather than scattered noise, kept
// deliberately faint since the point cloud is the primary read.
function RidgeLine({ points }: { points: MonthPoint[] }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(points.length * 3);
    points.forEach((p, i) => { arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = 0; });
    return arr;
  }, [points]);
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#0a0a0a" transparent opacity={0.16} />
    </line>
  );
}

// The sonar field, genuinely 3D this time — scattered through a volume
// around and behind the terrain rather than painted flat behind it, so the
// ridge reads as emerging out of detected space. Deterministic (mulberry32,
// same PRNG the rest of the terrain work has used all along).
function BackgroundField() {
  const positions = useMemo(() => {
    const rand = mulberry32(4242);
    const n = 380;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3]     = (rand() - 0.5) * SCENE_WIDTH * 1.7;
      arr[i * 3 + 1] = rand() * HEIGHT_SCALE * 1.5;
      arr[i * 3 + 2] = (rand() - 0.5) * SCENE_DEPTH * 3.4;
    }
    return arr;
  }, []);
  return <PointCloud positions={positions} size={0.022} opacity={0.09} />;
}

// The MILAT seam — a thin vertical rod (a cylinder, not a flat line or
// plane) so it stays visible from every rotation angle rather than
// vanishing edge-on the way a 2D line or a flat plane would.
function SeamMarker({ x }: { x: number }) {
  return (
    <mesh position={[x, (HEIGHT_SCALE * 1.25) / 2, 0]}>
      <cylinderGeometry args={[0.022, 0.022, HEIGHT_SCALE * 1.25, 8]} />
      <meshBasicMaterial color="#0a0a0a" transparent opacity={0.32} />
    </mesh>
  );
}

// A 3D-space-anchored label — drei's <Html> projects the given 3D point to
// screen coordinates every frame, so this stays attached to the correct
// spot on the terrain as the camera orbits, rather than being a 2D overlay
// pasted on top.
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
    <Html position={position} distanceFactor={9} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
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

// Invisible, generously-sized hit target per month — raycasting against the
// sparse, jittered point cloud directly would be a poor target; this gives
// BROWSE's click-to-month (and hover) something reliable to hit, decoupled
// from what's actually drawn.
function MonthHitTarget({
  p, spacing, onHover, onSelect,
}: {
  p: MonthPoint; spacing: number;
  onHover: (p: MonthPoint | null) => void;
  onSelect: (month: string, clientX: number, clientY: number) => void;
}) {
  return (
    <mesh
      position={[p.x, p.y / 2, 0]}
      onPointerMove={(e) => { e.stopPropagation(); onHover(p); }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onSelect(p.month, e.nativeEvent.clientX, e.nativeEvent.clientY); }}
    >
      <boxGeometry args={[Math.max(spacing * 0.9, 0.2), Math.max(p.y, 0.3), SCENE_DEPTH * 1.4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

const DEFAULT_CAM_POS: [number, number, number] = [0, HEIGHT_SCALE * 1.35, SCENE_WIDTH * 0.95];
const DEFAULT_TARGET:  [number, number, number] = [0, HEIGHT_SCALE * 0.2, 0];

function Scene({
  points, months, clickable, onHover, onSelect,
}: {
  points: MonthPoint[]; months: TerrainMonth[]; clickable: boolean;
  onHover: (p: MonthPoint | null) => void;
  onSelect: (month: string, clientX: number, clientY: number) => void;
}) {
  const peakIdx = useMemo(() => {
    if (points.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (points[i].count > points[best].count) best = i;
    return best;
  }, [points]);

  const troughIdx = useMemo(() => {
    const withPosts = points.map((p, i) => ({ p, i })).filter(x => x.p.count > 0);
    if (withPosts.length === 0) return -1;
    let best = withPosts[0];
    for (const x of withPosts) if (x.p.count < best.p.count) best = x;
    return best.i;
  }, [points]);

  const seam = useMemo(() => seamX(months, points), [months, points]);
  const spacing = points.length > 1 ? points[1].x - points[0].x : 1;

  return (
    <>
      <ambientLight intensity={1.4} />
      <BackgroundField />
      <RidgeLine points={points} />
      <TerrainPoints points={points} />

      {clickable && points.map(p => (
        <MonthHitTarget key={p.month} p={p} spacing={spacing} onHover={onHover} onSelect={onSelect} />
      ))}

      {seam != null && <SeamMarker x={seam} />}
      {seam != null && (
        <Annotation3D position={[seam, HEIGHT_SCALE * 1.3, 0]} label="MILAT" sublabel={provenanceBoundaryDate() ?? undefined} variant="seam" />
      )}
      {peakIdx >= 0 && (
        <Annotation3D
          position={[points[peakIdx].x, points[peakIdx].y, 0]}
          label={formatMonthShort(points[peakIdx].month)}
          sublabel={`${points[peakIdx].count} poems`}
        />
      )}
      {troughIdx >= 0 && troughIdx !== peakIdx && (
        <Annotation3D
          position={[points[troughIdx].x, points[troughIdx].y, 0]}
          label={formatMonthShort(points[troughIdx].month)}
          sublabel={`${points[troughIdx].count} poem${points[troughIdx].count === 1 ? "" : "s"}`}
        />
      )}
    </>
  );
}

export default function LandingTerrain({ months, dim = false, onMonthClick }: Props) {
  const points = useMemo(() => layoutMonths(months), [months]);
  const [hovered, setHovered] = useState<MonthPoint | null>(null);
  const controlsRef = useRef<any>(null);

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

  const resetView = useCallback(() => {
    controlsRef.current?.reset?.();
  }, []);

  return (
    <div
      style={{
        opacity: dim ? 0.18 : 1,
        pointerEvents: dim ? "none" : "auto",
        transition: "opacity 400ms",
      }}
    >
      <div
        onPointerDownCapture={onPointerDownCapture}
        style={{
          maxWidth:  "700px",
          margin:    "0 auto",
          aspectRatio: "16 / 10",
          position:  "relative",
          border:    "1px solid rgba(10,10,10,0.18)",
          background: "transparent",
        }}
      >
        {points.length > 0 && (
          <Canvas camera={{ position: DEFAULT_CAM_POS, fov: 42 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
            <Scene
              points={points}
              months={months}
              clickable={!!onMonthClick}
              onHover={setHovered}
              onSelect={handleSelect}
            />
            {hovered && (
              <Annotation3D
                position={[hovered.x, hovered.y, 0]}
                label={formatMonthShort(hovered.month)}
                sublabel={`${hovered.count} poem${hovered.count === 1 ? "" : "s"}, ${hovered.words.toLocaleString()}w`}
                variant="transient"
              />
            )}
            <OrbitControls
              ref={controlsRef}
              target={DEFAULT_TARGET}
              enablePan={false}
              enableDamping
              dampingFactor={0.08}
              minDistance={SCENE_WIDTH * 0.5}
              maxDistance={SCENE_WIDTH * 1.8}
              minPolarAngle={Math.PI * 0.08}
              maxPolarAngle={Math.PI * 0.49}
            />
          </Canvas>
        )}

        {/* right-edge nav affordance — a plain hairline track, not a joystick.
            Purely a visual cue; drag-to-rotate works anywhere on the canvas
            regardless of whether this is noticed. */}
        <div style={{ position: "absolute", right: "10px", top: "14%", bottom: "14%", width: "14px", pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(10,10,10,0.18)", transform: "translateX(-50%)" }} />
          {[0.25, 0.5, 0.75].map(t => (
            <div key={t} style={{
              position: "absolute", left: "50%", top: `${t * 100}%`,
              width: 5, height: 5, borderRadius: "50%",
              border: "1px solid rgba(10,10,10,0.3)", transform: "translate(-50%, -50%)",
            }} />
          ))}
        </div>

        {/* reset — returns the camera to its default position/target */}
        <button
          onClick={resetView}
          style={{
            position: "absolute", left: "10px", bottom: "10px",
            fontFamily: HUD_MONO, fontSize: "0.62rem", fontWeight: 600,
            letterSpacing: "0.1em", textTransform: "uppercase",
            background: "none", border: "1px solid rgba(10,10,10,0.25)",
            color: "#0a0a0a", opacity: 0.6, padding: "0.3rem 0.55rem",
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>

      <div style={{ marginTop: "0.75rem", fontSize: "0.7rem", letterSpacing: "0.08em", color: "rgba(10,10,10,0.4)", textAlign: "center" }}>
        drag to rotate — scroll to zoom
      </div>
    </div>
  );
}
