"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useCallback, useMemo, useRef } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";
import { mulberry32 } from "@/app/components/TerrainScan";

// ── Line-drawn 3D terrain, now driven by the archive's own text instead of
// a noise function pretending to be one. Every earlier pass used a generic
// FBM/value-noise field to give the linework its jaggedness, roughness, and
// per-depth variation — it looked plausibly mountain-like, but nothing
// about *which* poem was written that month had any bearing on the shape.
// This pass removes that noise entirely. What replaces it:
//
// - Each profile line (one of 48 depth-wise cross-sections) is, at any
//   given month's x-range, assigned one of that month's actual poems
//   (line index mod poem count) — so a busy month's 48 lines each trace a
//   different real poem's rhythm, while a one-poem month has every line
//   reading the same poem (see textMicroAt below).
// - The height texture at each point is that assigned poem's own line-by-
//   line word-count sequence, resampled across the local x-span and
//   z-offset by a small per-line phase so depth still reads as organic —
//   not synthesized, just re-read from a different point in the same real
//   sequence. Short, wildly varying lines (fragmented, punchy poems)
//   produce high-frequency jag because the sequence itself has many small
//   values close together; long, steady lines (flowing prose-like poems)
//   produce broad, slow undulation because the sequence has few, large
//   values. That frequency/amplitude split falls out of the real data with
//   no separate "how jagged" parameter to tune.
// - Real punctuation density (periods, colons, dashes, question marks per
//   word) sets how often a line breaks/restarts — reusing the same
//   per-(line,sample) survival-hash mechanism the previous plains pass
//   used, now keyed to a genuinely different, text-derived quantity.
// - Real word-repetition within a poem draws a faint echo — a second,
//   offset near-duplicate trace of the same run — mirroring the poem's own
//   repeated structure, generically available to any month, not a special
//   case for one.
// - Real ALL-CAPS density boosts a run's opacity/weight, mirroring a
//   poem's own volume shift.
//
// The height CURVE itself (poem count -> elevation via Catmull-Rom) is
// unchanged — that's real data too, and was already correct. This is about
// the texture within and around that curve, not the curve.
//
// Camera, light, carpet, sizing/containment, and the MILAT seam are
// unchanged from the previous pass. The TAKE THE JOURNEY button remains
// removed from /writing for now, per standing instruction. ──

export interface PoemTextProfile {
  words: number;
  lineLens: number[];   // word count per non-empty line, in the poem's own order
  punctDensity: number; // sentence-ending/pausing punctuation per word
  capsRatio: number;    // fraction of words that are ALL-CAPS
  repetition: number;   // 1 - unique/total words, within this one poem
}

export interface TerrainMonth {
  month: string; // YYYY-MM
  count: number;
  words: number;
  poems: PoemTextProfile[];
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

// ── text signals — derived from the actual poems, not from noise ──
function smoothstepRange(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// word-count-weighted average of a per-poem scalar, across one month's
// actual poems — the honest way to combine several poems' properties into
// one month-level reading (a 900-word poem should outweigh a 10-word one).
function weightedAvg(poems: PoemTextProfile[], key: "punctDensity" | "capsRatio" | "repetition"): number {
  const totalWords = poems.reduce((a, p) => a + p.words, 0);
  if (!totalWords) return 0;
  return poems.reduce((a, p) => a + p[key] * p.words, 0) / totalWords;
}

function linearMinMax(values: number[]): number[] {
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => Math.max(0, Math.min(1, (v - min) / range)));
}

interface MonthSignals {
  breakIntensity: number;      // real punctuation density, log+min-max normalised
  repetitionIntensity: number; // real within-poem word repetition, linear normalised
  capsIntensity: number;       // real ALL-CAPS fraction, linear normalised
}

function computeMonthSignals(months: TerrainMonth[]): MonthSignals[] {
  const punct = months.map(m => weightedAvg(m.poems, "punctDensity"));
  const rep   = months.map(m => weightedAvg(m.poems, "repetition"));
  const caps  = months.map(m => weightedAvg(m.poems, "capsRatio"));
  // Linear, not log: unlike raw word-density (an earlier pass's signal,
  // now removed), punctuation density's one real outlier (Jan 2026) isn't
  // extreme enough to need log-compression, and linear scaling actually
  // spreads the other 18 months out better — log clustered nearly all of
  // them into "broken" territory, verified visually before this was fixed.
  const breakN = linearMinMax(punct);
  const repN   = linearMinMax(rep);
  const capsN  = linearMinMax(caps);
  return months.map((_, i) => ({ breakIntensity: breakN[i], repetitionIntensity: repN[i], capsIntensity: capsN[i] }));
}

// Linear (not Catmull-Rom) between adjacent months' signal value — these
// read as per-month character, not a smoothly overshooting curve.
function signalAt(signals: MonthSignals[], key: keyof MonthSignals, xNorm: number): number {
  const n = signals.length;
  if (n === 0) return 0;
  if (n === 1) return signals[0][key];
  const clamped = Math.max(0, Math.min(1, xNorm));
  const scaled = clamped * (n - 1);
  const i = Math.floor(scaled);
  const t = scaled - i;
  const a = signals[Math.min(n - 1, i)][key];
  const b = signals[Math.min(n - 1, i + 1)][key];
  return a + (b - a) * t;
}

// Beyond this break intensity, a line's survival chance falls off toward
// BREAK_MIN_SURVIVAL rather than dropping straight to zero — a poem dense
// with punctuation stutters and restarts the linework, it doesn't erase it.
const BREAK_ONSET = 0.45;
const BREAK_MIN_SURVIVAL = 0.22;
function survivalChance(breakIntensity: number): number {
  const t = smoothstepRange(BREAK_ONSET, 1, breakIntensity);
  return 1 - t * (1 - BREAK_MIN_SURVIVAL);
}

// Linear resampling over an arbitrary-length real sequence (a poem's own
// line lengths) at fraction t in [0,1] — the literal "play this poem's
// rhythm across this span" operation everything below relies on.
function resampleSequence(seq: number[], t: number): number {
  const n = seq.length;
  if (n === 0) return 0;
  if (n === 1) return seq[0];
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (n - 1);
  const i = Math.floor(scaled);
  const frac = scaled - i;
  const a = seq[Math.min(n - 1, i)];
  const b = seq[Math.min(n - 1, i + 1)];
  return a + (b - a) * frac;
}
function meanOf(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// The height micro-texture, read directly off a real poem's line-length
// sequence instead of a noise field. li selects which of that month's
// poems this particular depth-slice reads (wrapping if there are more
// lines than poems); a small per-li phase offset means even a one-poem
// month's 48 lines each read a slightly different span of that same poem,
// rather than all 48 perfectly synchronising on the identical value.
const MICRO_SCALE = 0.018;
const MICRO_CAP = 0.3;
const PHASE_SPREAD = 0.7;

function textMicroAt(months: TerrainMonth[], li: number, x: number): number {
  const xNorm = x / SCENE_WIDTH + 0.5;
  const n = months.length;
  if (n === 0) return 0;
  const monthFloat = Math.max(0, Math.min(n - 1, xNorm * (n - 1)));
  const monthIdx = Math.round(monthFloat);
  const poems = months[monthIdx].poems;
  if (!poems || poems.length === 0) return 0;
  const poem = poems[li % poems.length];
  if (!poem.lineLens.length) return 0;

  const localT0 = monthFloat - monthIdx + 0.5; // 0..1 across this month's own territory
  const zi = PROFILE_COUNT > 1 ? li / (PROFILE_COUNT - 1) : 0.5;
  const localT = Math.max(0, Math.min(1, localT0 + (zi - 0.5) * PHASE_SPREAD));

  const sampled = resampleSequence(poem.lineLens, localT);
  const dev = sampled - meanOf(poem.lineLens);
  const compressed = Math.sign(dev) * Math.sqrt(Math.abs(dev));
  return Math.max(-MICRO_CAP, Math.min(MICRO_CAP, compressed * MICRO_SCALE));
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

// A deterministic hash, kept from the prior pass but repurposed narrowly:
// it no longer shapes anything (no fbm2D, no value-noise field survives
// this pass) — it's used exactly once below, as a fair per-(line, sample)
// coin flip deciding *which* of 48 parallel, otherwise-identical lines
// drops out at a break point. The break RATE comes from real punctuation
// density; this only distributes that rate fairly across the 48 lines
// instead of every line breaking at the exact same sample in lockstep.
function hashNoise2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000000) / 1000000;
}

// The terrain's height at any (x, z) for depth-slice li. The broad taper
// away from centreline is now a plain, fixed cosine falloff — no per-point
// noise varying how sharply it narrows, because that variation was exactly
// the "make it look natural" job this pass reassigns to real text. All of
// this point's texture comes from textMicroAt: the assigned poem's own
// line-length sequence, resampled here. centreline-guaranteed real data is
// still intact (centerFalloff is exactly 1 at z=0 for every x, so the taper
// term can never touch the true Catmull-Rom height there); the poem-derived
// micro term can still nudge it, same as before, because it's real data,
// not decoration.
function terrainHeightAt(normalized: number[], months: TerrainMonth[], li: number, x: number, z: number): number {
  const xNorm = x / SCENE_WIDTH + 0.5;
  const zNorm = z / (SCENE_DEPTH / 2);
  const localIntensity = heightAt(normalized, xNorm);

  const centerFalloff = Math.max(0, Math.cos(zNorm * Math.PI / 2));
  const base = localIntensity * HEIGHT_SCALE * centerFalloff;

  const micro = textMicroAt(months, li, x);

  return Math.max(0, base + micro);
}

// ── The landform, drawn as lines ──
// Many parallel cross-section silhouettes across the depth axis, each a
// clean line strip, no fill. Nearer lines occlude farther ones through
// ordinary WebGL depth testing (the default for LineBasicMaterial) — no
// custom visibility algorithm needed. A subtle opacity gradient by depth
// reinforces it further. Adjacent slices now show different character
// because they're reading different real poems (or different spans of the
// same poem) via textMicroAt — the multi-scale read a noise field used to
// approximate now comes from the archive actually containing many
// differently-shaped poems.
const PROFILE_COUNT = 48;
const PROFILE_SAMPLES = 100;

// Each profile line is built as one or more RUNS. A stretch with real
// punctuation-driven break intensity above BREAK_ONSET starts dropping
// points — the line stutters and restarts, echoing the poem's own syntax
// breaking, rather than fading. A run with high real word-repetition also
// gets a second, offset near-duplicate trace (an echo) alongside it; a run
// with high real ALL-CAPS density gets boosted opacity. All three read off
// the SAME per-month signals object — one mechanism, not a special case
// per month.
const REPETITION_ECHO_THRESHOLD = 0.42;
const REPETITION_ECHO_OFFSET_Y = 0.07;
const REPETITION_ECHO_OFFSET_Z = 0.09;

function ProfileLines({ months, normalized, signals }: { months: TerrainMonth[]; normalized: number[]; signals: MonthSignals[] }) {
  const runs = useMemo(() => {
    const out: { positions: Float32Array; opacity: number }[] = [];
    for (let li = 0; li < PROFILE_COUNT; li++) {
      const zt = PROFILE_COUNT > 1 ? li / (PROFILE_COUNT - 1) : 0.5; // 0..1
      const z = (zt - 0.5) * SCENE_DEPTH;
      const baseOpacity = 0.32 + 0.4 * zt; // nearer slices read slightly brighter

      let current: number[] = []; // flat x,y,z triples
      let sumBreak = 0, sumCaps = 0, sumRep = 0, cnt = 0;
      const flush = () => {
        if (current.length >= 6 && cnt > 0) { // at least 2 points
          const avgCaps = sumCaps / cnt;
          const avgRep = sumRep / cnt;
          const opacity = Math.max(0.05, Math.min(1, baseOpacity * (1 + avgCaps * 0.6)));
          out.push({ positions: new Float32Array(current), opacity });

          // Echo: a real repetition signal draws a second, faint,
          // offset trace of the same run — the poem's own repeated words
          // reflected as a repeated line, not a hand-placed symbol.
          if (avgRep > REPETITION_ECHO_THRESHOLD) {
            const t = (avgRep - REPETITION_ECHO_THRESHOLD) / (1 - REPETITION_ECHO_THRESHOLD);
            const echo = new Float32Array(current.length);
            for (let k = 0; k < current.length; k += 3) {
              echo[k]     = current[k];
              echo[k + 1] = current[k + 1] + REPETITION_ECHO_OFFSET_Y * t;
              echo[k + 2] = current[k + 2] + REPETITION_ECHO_OFFSET_Z * t;
            }
            out.push({ positions: echo, opacity: opacity * 0.42 * t });
          }
        }
        current = []; sumBreak = 0; sumCaps = 0; sumRep = 0; cnt = 0;
      };

      for (let pi = 0; pi < PROFILE_SAMPLES; pi++) {
        const xNorm = pi / (PROFILE_SAMPLES - 1);
        const breakI = signalAt(signals, "breakIntensity", xNorm);
        // Deterministic per-(line, sample) hash decides survival — see
        // hashNoise2D above for why this isn't shape-generating noise.
        const survives = hashNoise2D(li, pi, 9001) < survivalChance(breakI);
        if (!survives) {
          flush(); // break — the poem's own punctuation stutters the line here
          continue;
        }
        const x = (xNorm - 0.5) * SCENE_WIDTH;
        const y = terrainHeightAt(normalized, months, li, x, z);
        current.push(x, y, z);
        sumBreak += breakI;
        sumCaps += signalAt(signals, "capsIntensity", xNorm);
        sumRep += signalAt(signals, "repetitionIntensity", xNorm);
        cnt++;
      }
      flush();
    }
    return out;
  }, [months, normalized, signals]);

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
  const signals = useMemo(() => computeMonthSignals(months), [months]);

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
        <ProfileLines months={months} normalized={normalized} signals={signals} />
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
