"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useCallback, useMemo, useRef } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";
import { mulberry32 } from "@/app/components/TerrainScan";

// ── An ecosystem, not a terrain-visualisation technique. Every earlier
// pass — noise-driven jag, text-driven jag, vocabulary shifts, dense-
// contour zones — was still one continuous ground surface with varying
// character. However accurate to the data, none of it gave a human
// anything to actually recognise: no lake, no tree, no hill, nothing to
// point at and name. This pass replaces "one surface with regional
// character" with actual discrete, recognisable objects, each still real-
// data-placed and real-data-shaped, assembled into one small landscape:
//
// - A MOUNTAIN sits where the real data is tallest (this archive: Feb
//   2025, 67 poems — the same real Catmull-Rom height curve every pass
//   has used). Its internal texture is still the dense contour-grid
//   technique from the last pass (that part worked); a bold outline pass
//   at the grid's own edges gives it an actual silhouette.
// - HILLS are rounded, receding dome silhouettes wherever the real height
//   is moderately elevated — deliberately smooth (no fine jag), because
//   real hills are rounded, not spiky; a small amount of real per-poem
//   texture keeps them from being perfectly synthetic.
// - A POND sits at the one real point that is both the lowest ground in
//   the whole range AND the calmest real writing (highest punctuation-
//   density-derived stillness) — this archive: Jan 2026, the single
//   month that was already a "basin" by height and separately flagged as
//   maximally still by its own text. A flat shoreline ellipse plus real-
//   repetition-driven ripple rings, sitting in an actual carved
//   depression in the ground, not a height dip standing in for water.
// - LONE TREES stand at real, individually distinctive months — highest
//   real within-poem repetition or ALL-CAPS density, excluding whatever's
//   already claimed by the mountain or the pond, spaced apart by a real
//   minimum separation so they read as scattered, not a hedge. A trunk
//   plus a canopy loop whose own edge is jittered by that specific
//   month's real line-length sequence, the same resampling technique
//   every pass since the text-driven rewrite has used for texture.
// - MEADOW is everything left over — calm, sparse, low-contrast ground,
//   the connective tissue between the four features above, deliberately
//   unremarkable so it doesn't compete with them.
//
// Each feature owns its own patch of ground exclusively (no two systems
// draw over the same x-range, the same discipline the last two passes
// established) and each is still driven by the real per-month/per-poem
// data this project has built up over many passes — this is not a return
// to hand-placed decoration, it's the same real signals given a literal
// rather than abstract shape.
//
// Camera, light, carpet, sizing/containment, and the MILAT seam are
// unchanged. The TAKE THE JOURNEY button remains removed from /writing
// for now, per standing instruction.

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

// ── scene layout — world units, not pixels. ──
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

// The base ground height at any (x, z) — real Catmull-Rom elevation from
// poem count, tapered away from the centreline by a fixed cosine falloff.
// No jag, no per-poem texture — this is the smooth reference surface
// hills/meadow/the pond's rim are built from; the mountain adds its own
// fine texture back on top of this same base (see terrainHeightAt).
function groundHeightAt(normalized: number[], x: number, z: number): number {
  const xNorm = x / SCENE_WIDTH + 0.5;
  const zNorm = z / (SCENE_DEPTH / 2);
  const localIntensity = heightAt(normalized, xNorm);
  const centerFalloff = Math.max(0, Math.cos(zNorm * Math.PI / 2));
  return localIntensity * HEIGHT_SCALE * centerFalloff;
}

// ── real per-poem text signals ──
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
  stillnessIntensity: number;  // real punctuation density, linear normalised — high means calm
  repetitionIntensity: number; // real within-poem word repetition, linear normalised
  capsIntensity: number;       // real ALL-CAPS fraction, linear normalised
}

function computeMonthSignals(months: TerrainMonth[]): MonthSignals[] {
  const punct = months.map(m => weightedAvg(m.poems, "punctDensity"));
  const rep   = months.map(m => weightedAvg(m.poems, "repetition"));
  const caps  = months.map(m => weightedAvg(m.poems, "capsRatio"));
  const stillN = linearMinMax(punct);
  const repN   = linearMinMax(rep);
  const capsN  = linearMinMax(caps);
  return months.map((_, i) => ({ stillnessIntensity: stillN[i], repetitionIntensity: repN[i], capsIntensity: capsN[i] }));
}

// Linear (not Catmull-Rom) between adjacent months' signal value — reads
// as per-month character, not a smoothly overshooting curve.
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

// Linear resampling over an arbitrary-length real sequence (a poem's own
// line lengths) at fraction t in [0,1] — the literal "play this poem's
// rhythm across this span" operation both ground texture and tree
// canopies rely on.
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

// The archive-wide mean line length — the fixed reference every poem's
// own average gets compared against for its texture's baseline offset.
function computeGlobalMeanLine(months: TerrainMonth[]): number {
  const all: number[] = [];
  for (const m of months) for (const p of m.poems) all.push(...p.lineLens);
  return meanOf(all);
}

const ORIGIN_SCALE = 0.05;
const ORIGIN_CAP = 0.55;
const MICRO_SCALE = 0.018;
const MICRO_CAP = 0.3;
const PHASE_SPREAD = 0.7;
const STILLNESS_DAMPING = 0.88;

function originFor(poem: PoemTextProfile | undefined, globalMeanLine: number): number {
  if (!poem || !poem.lineLens.length) return 0;
  const dev = meanOf(poem.lineLens) - globalMeanLine;
  const compressed = Math.sign(dev) * Math.sqrt(Math.abs(dev));
  return Math.max(-ORIGIN_CAP, Math.min(ORIGIN_CAP, compressed * ORIGIN_SCALE));
}

// The per-point text-derived height offset. `li` selects which of a
// month's real poems this particular line reads; `zi` (0..1, caller-
// supplied — different features have different line counts, so this
// can't be a fixed global constant any more) spreads that reading's phase
// slightly across depth so parallel lines within one feature don't all
// read the identical point of the identical poem.
function textMicroAt(months: TerrainMonth[], globalMeanLine: number, li: number, zi: number, x: number, stillness: number): number {
  const xNorm = x / SCENE_WIDTH + 0.5;
  const n = months.length;
  if (n === 0) return 0;
  const monthFloat = Math.max(0, Math.min(n - 1, xNorm * (n - 1)));
  const monthIdx = Math.round(monthFloat);
  const poems = months[monthIdx].poems;
  if (!poems || poems.length === 0) return 0;
  const poem = poems[li % poems.length];
  if (!poem.lineLens.length) return 0;
  const poemMean = meanOf(poem.lineLens);

  const m0 = Math.floor(monthFloat);
  const m1 = Math.min(n - 1, m0 + 1);
  const frac = monthFloat - m0;
  const poems0 = months[m0].poems, poems1 = months[m1].poems;
  const origin0 = originFor(poems0 && poems0.length ? poems0[li % poems0.length] : undefined, globalMeanLine);
  const origin1 = originFor(poems1 && poems1.length ? poems1[li % poems1.length] : undefined, globalMeanLine);
  const origin = origin0 + (origin1 - origin0) * frac;

  const localT0 = monthFloat - monthIdx + 0.5;
  const localT = Math.max(0, Math.min(1, localT0 + (zi - 0.5) * PHASE_SPREAD));
  const sampled = resampleSequence(poem.lineLens, localT);
  const localDev = sampled - poemMean;
  const localCompressed = Math.sign(localDev) * Math.sqrt(Math.abs(localDev));
  const local = Math.max(-MICRO_CAP, Math.min(MICRO_CAP, localCompressed * MICRO_SCALE));

  return origin + local * (1 - stillness * STILLNESS_DAMPING);
}

// Full-strength textured height — the mountain's own function, real base
// elevation plus real full-amplitude per-poem texture.
function terrainHeightAt(
  normalized: number[], months: TerrainMonth[], globalMeanLine: number,
  li: number, zi: number, x: number, z: number, stillness: number,
): number {
  const base = groundHeightAt(normalized, x, z);
  const micro = textMicroAt(months, globalMeanLine, li, zi, x, stillness);
  return Math.max(0, base + micro);
}

// MILAT seam x — same day-fraction interpolation as the earlier passes.
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

// ── ecosystem zones — mountain/hill/meadow, decided purely by the real
// height curve (poem count -> elevation). Walks the real smoothed curve
// at fine resolution rather than snapping to month indices, so several
// consecutive months of genuinely similar height merge into one
// continuous zone automatically. ──
export type EcosystemMode = "mountain" | "hill" | "meadow";
export interface EcosystemZone { mode: EcosystemMode; xStart: number; xEnd: number; }

const MOUNTAIN_THRESHOLD = 0.5;
const HILL_THRESHOLD = 0.2;
const ZONE_SAMPLES = 240;
const MIN_ZONE_WIDTH = 0.25;

function ecosystemModeAt(normalized: number[], xNorm: number): EcosystemMode {
  const h = heightAt(normalized, xNorm);
  if (h >= MOUNTAIN_THRESHOLD) return "mountain";
  if (h >= HILL_THRESHOLD) return "hill";
  return "meadow";
}

function classifyEcosystemZones(normalized: number[]): EcosystemZone[] {
  const zones: EcosystemZone[] = [];
  if (normalized.length === 0) return zones;
  let currentMode = ecosystemModeAt(normalized, 0);
  let startXNorm = 0;
  for (let i = 1; i <= ZONE_SAMPLES; i++) {
    const xNorm = i / ZONE_SAMPLES;
    const mode = ecosystemModeAt(normalized, xNorm);
    if (mode !== currentMode) {
      zones.push({ mode: currentMode, xStart: (startXNorm - 0.5) * SCENE_WIDTH, xEnd: (xNorm - 0.5) * SCENE_WIDTH });
      currentMode = mode;
      startXNorm = xNorm;
    }
  }
  zones.push({ mode: currentMode, xStart: (startXNorm - 0.5) * SCENE_WIDTH, xEnd: (1 - 0.5) * SCENE_WIDTH });
  return mergeTinyZones(zones);
}

// A continuous signal grazing a threshold at a shallow angle can produce a
// hairline sliver zone — real per the classifier's own logic, but too
// thin to read as anything. Fold any zone narrower than MIN_ZONE_WIDTH
// into its predecessor, then merge any now-adjacent same-mode zones.
function mergeTinyZones(zones: EcosystemZone[]): EcosystemZone[] {
  if (zones.length === 0) return zones;
  const folded: EcosystemZone[] = [zones[0]];
  for (let i = 1; i < zones.length; i++) {
    const z = zones[i];
    if (z.xEnd - z.xStart < MIN_ZONE_WIDTH) {
      folded[folded.length - 1] = { ...folded[folded.length - 1], xEnd: z.xEnd };
    } else {
      folded.push(z);
    }
  }
  const merged: EcosystemZone[] = [folded[0]];
  for (let i = 1; i < folded.length; i++) {
    const z = folded[i];
    const last = merged[merged.length - 1];
    if (z.mode === last.mode) {
      merged[merged.length - 1] = { ...last, xEnd: z.xEnd };
    } else {
      merged.push(z);
    }
  }
  return merged;
}

function insideZoneMode(x: number, zones: EcosystemZone[], mode: EcosystemMode): boolean {
  return zones.some(z => z.mode === mode && x >= z.xStart && x <= z.xEnd);
}

// ── point features — the pond and the lone trees. Unlike zones (which
// are about continuous ground character), these are facts about one
// specific real month, so they're decided per month directly rather than
// by walking an interpolated curve. ──
export interface PointFeature { kind: "pond" | "tree"; x: number; monthIdx: number; }

const POND_HEIGHT_MAX = 0.08;
const POND_STILLNESS_MIN = 0.5;
const TREE_SIGNAL_MIN = 0.5;
const TREE_MIN_SEPARATION = 1.0;

// The one real point that is both the lowest ground in the range AND the
// calmest real writing — not every low point, only the one that's also
// genuinely still. A low, restless month stays plain low meadow.
function findPondFeature(normalized: number[], signals: MonthSignals[]): PointFeature | null {
  const n = normalized.length;
  let bestIdx = -1, bestStillness = -1;
  for (let i = 0; i < n; i++) {
    if (normalized[i] <= POND_HEIGHT_MAX && signals[i].stillnessIntensity > bestStillness) {
      bestStillness = signals[i].stillnessIntensity;
      bestIdx = i;
    }
  }
  if (bestIdx === -1 || bestStillness < POND_STILLNESS_MIN) return null;
  const xNorm = n > 1 ? bestIdx / (n - 1) : 0.5;
  return { kind: "pond", x: (xNorm - 0.5) * SCENE_WIDTH, monthIdx: bestIdx };
}

// Real months with the highest within-poem repetition or ALL-CAPS density
// — genuinely distinctive individually, not just moderately elevated —
// become lone trees, greedily chosen strongest-first and skipped if too
// close to one already placed, so they read as scattered, not a hedge.
function findTreeFeatures(normalized: number[], signals: MonthSignals[], zones: EcosystemZone[], exclude: Set<number>): PointFeature[] {
  const n = normalized.length;
  const candidates = normalized
    .map((_, i) => ({ i, signal: Math.max(signals[i].repetitionIntensity, signals[i].capsIntensity) }))
    .filter(c => !exclude.has(c.i) && normalized[c.i] < MOUNTAIN_THRESHOLD && c.signal >= TREE_SIGNAL_MIN)
    .sort((a, b) => b.signal - a.signal);
  const chosen: PointFeature[] = [];
  for (const c of candidates) {
    const xNorm = n > 1 ? c.i / (n - 1) : 0.5;
    const x = (xNorm - 0.5) * SCENE_WIDTH;
    // A candidate month's own real height clears the mountain check, but
    // the mountain's ZONE (built from the smoothed curve, not snapped to
    // one month's index) can still extend geometrically past it — a tree
    // planted there would sit inside the mountain's own dense grid rather
    // than standing apart from it. Exclude by position, not just by that
    // month's own value.
    if (insideZoneMode(x, zones, "mountain")) continue;
    if (chosen.some(f => Math.abs(f.x - x) < TREE_MIN_SEPARATION)) continue;
    chosen.push({ kind: "tree", x, monthIdx: c.i });
  }
  return chosen;
}

// ── the mountain — the dense contour-grid technique proven in the last
// pass, kept for its interior texture, now with a bold pass at the grid's
// own outer edges so it reads with an actual silhouette against the
// meadow instead of fading into it. ──
const MOUNTAIN_X_LINES = 84, MOUNTAIN_Z_LINES = 30, MOUNTAIN_SAMPLES = 46;
const MOUNTAIN_OPACITY = 0.5, MOUNTAIN_EDGE_OPACITY = 0.95;

function MountainMass({ months, normalized, globalMeanLine, signals, zones }: {
  months: TerrainMonth[]; normalized: number[]; globalMeanLine: number; signals: MonthSignals[]; zones: EcosystemZone[];
}) {
  const { interior, edges } = useMemo(() => {
    const interior: number[] = [];
    const edges: number[] = [];
    for (const zone of zones) {
      if (zone.mode !== "mountain") continue;
      const width = zone.xEnd - zone.xStart;
      if (width <= 0) continue;

      for (let li = 0; li < MOUNTAIN_X_LINES; li++) {
        const zi = MOUNTAIN_X_LINES > 1 ? li / (MOUNTAIN_X_LINES - 1) : 0.5;
        const z = (zi - 0.5) * SCENE_DEPTH;
        const isEdge = li === 0 || li === MOUNTAIN_X_LINES - 1;
        const target = isEdge ? edges : interior;
        let prevX: number | null = null, prevY = 0, prevZ = 0;
        for (let si = 0; si <= MOUNTAIN_SAMPLES; si++) {
          const t = si / MOUNTAIN_SAMPLES;
          const x = zone.xStart + t * width;
          const xNorm = x / SCENE_WIDTH + 0.5;
          const stillness = signalAt(signals, "stillnessIntensity", xNorm);
          const y = terrainHeightAt(normalized, months, globalMeanLine, li, zi, x, z, stillness);
          if (prevX !== null) target.push(prevX, prevY, prevZ, x, y, z);
          prevX = x; prevY = y; prevZ = z;
        }
      }
      for (let zline = 0; zline < MOUNTAIN_Z_LINES; zline++) {
        const xt = MOUNTAIN_Z_LINES > 1 ? zline / (MOUNTAIN_Z_LINES - 1) : 0.5;
        const x = zone.xStart + xt * width;
        const xNorm = x / SCENE_WIDTH + 0.5;
        const stillness = signalAt(signals, "stillnessIntensity", xNorm);
        const isEdge = zline === 0 || zline === MOUNTAIN_Z_LINES - 1;
        const target = isEdge ? edges : interior;
        let prevZ: number | null = null, prevY = 0, prevX = 0;
        for (let si = 0; si <= MOUNTAIN_SAMPLES; si++) {
          const t = si / MOUNTAIN_SAMPLES;
          const z = (t - 0.5) * SCENE_DEPTH;
          const li = Math.round(t * (MOUNTAIN_X_LINES - 1));
          const zi = li / (MOUNTAIN_X_LINES - 1);
          const y = terrainHeightAt(normalized, months, globalMeanLine, li, zi, x, z, stillness);
          if (prevZ !== null) target.push(prevX, prevY, prevZ, x, y, z);
          prevX = x; prevY = y; prevZ = z;
        }
      }
    }
    return { interior: new Float32Array(interior), edges: new Float32Array(edges) };
  }, [months, normalized, globalMeanLine, signals, zones]);

  return (
    <>
      {interior.length > 0 && (
        <lineSegments>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[interior, 3]} /></bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={MOUNTAIN_OPACITY} />
        </lineSegments>
      )}
      {edges.length > 0 && (
        <lineSegments>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[edges, 3]} /></bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={MOUNTAIN_EDGE_OPACITY} />
        </lineSegments>
      )}
    </>
  );
}

// ── hills — a small number of smooth, nested dome silhouettes across
// depth, deliberately undramatic: real hills are rounded, not jagged. The
// real Catmull-Rom curve itself already produces a rounded dome shape for
// an isolated rise in the data, so hills read correctly just by sampling
// it cleanly — a light dose of real per-poem texture (much dimmer than
// the mountain's) keeps them from looking synthetic without competing
// with the meadow or the peak for attention. ──
const HILL_ARCS = 5, HILL_SAMPLES = 50, HILL_TEXTURE_SCALE = 0.4, HILL_OPACITY = 0.4;

function HillMass({ months, normalized, globalMeanLine, signals, zones }: {
  months: TerrainMonth[]; normalized: number[]; globalMeanLine: number; signals: MonthSignals[]; zones: EcosystemZone[];
}) {
  const lines = useMemo(() => {
    const out: Float32Array[] = [];
    for (const zone of zones) {
      if (zone.mode !== "hill") continue;
      const width = zone.xEnd - zone.xStart;
      if (width <= 0) continue;
      for (let a = 0; a < HILL_ARCS; a++) {
        const zi = HILL_ARCS > 1 ? a / (HILL_ARCS - 1) : 0.5;
        const z = (zi - 0.5) * SCENE_DEPTH;
        const pts: number[] = [];
        for (let si = 0; si <= HILL_SAMPLES; si++) {
          const t = si / HILL_SAMPLES;
          const x = zone.xStart + t * width;
          const xNorm = x / SCENE_WIDTH + 0.5;
          const stillness = signalAt(signals, "stillnessIntensity", xNorm);
          const y = groundHeightAt(normalized, x, z) + textMicroAt(months, globalMeanLine, a, zi, x, stillness) * HILL_TEXTURE_SCALE;
          pts.push(x, y, z);
        }
        out.push(new Float32Array(pts));
      }
    }
    return out;
  }, [months, normalized, globalMeanLine, signals, zones]);

  return (
    <>
      {lines.map((positions, i) => (
        <line key={i}>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={HILL_OPACITY} />
        </line>
      ))}
    </>
  );
}

// ── meadow — the calm connective ground, only where nothing else has
// already claimed the width: not the mountain, not a hill, not inside the
// pond's own shoreline. Sparse, low-contrast, deliberately unremarkable —
// real per-poem texture is present but heavily damped, so it doesn't read
// as data-driven jag competing with the features that are meant to stand
// out. ──
const GROUND_LINES = 14, GROUND_SAMPLES = 90, MEADOW_TEXTURE_SCALE = 0.3, MEADOW_OPACITY = 0.2;

function GroundField({ months, normalized, globalMeanLine, signals, zones, pond }: {
  months: TerrainMonth[]; normalized: number[]; globalMeanLine: number; signals: MonthSignals[]; zones: EcosystemZone[]; pond: PointFeature | null;
}) {
  const lines = useMemo(() => {
    const out: Float32Array[] = [];
    for (let li = 0; li < GROUND_LINES; li++) {
      const zi = GROUND_LINES > 1 ? li / (GROUND_LINES - 1) : 0.5;
      const z = (zi - 0.5) * SCENE_DEPTH;
      let current: number[] = [];
      const flush = () => { if (current.length >= 6) out.push(new Float32Array(current)); current = []; };
      for (let si = 0; si <= GROUND_SAMPLES; si++) {
        const xNorm = si / GROUND_SAMPLES;
        const x = (xNorm - 0.5) * SCENE_WIDTH;
        const inMeadow = insideZoneMode(x, zones, "meadow");
        const inPond = pond ? Math.hypot(x - pond.x, z) < POND_RADIUS : false;
        if (!inMeadow || inPond) { flush(); continue; }
        const stillness = signalAt(signals, "stillnessIntensity", xNorm);
        const y = groundHeightAt(normalized, x, z) + textMicroAt(months, globalMeanLine, li, zi, x, stillness) * MEADOW_TEXTURE_SCALE;
        current.push(x, y, z);
      }
      flush();
    }
    return out;
  }, [months, normalized, globalMeanLine, signals, zones, pond]);

  return (
    <>
      {lines.map((positions, i) => (
        <line key={i}>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={MEADOW_OPACITY} />
        </line>
      ))}
    </>
  );
}

// ── the pond — a flat shoreline ellipse at a fixed water level (real
// ground height at the pond's centre, minus a real depression depth), and
// concentric ripple rings inside it. Ring count is driven by the pond
// month's own real repetition intensity — the more that specific poem
// repeated its own words, the more rings ripple out from the centre, a
// literal rather than abstract echo of the same signal earlier passes
// used for a subtler reflection effect. Flat and level, unlike land,
// which is what reads as water rather than a dip in the ground. ──
const POND_RADIUS = 0.6, POND_DEPTH = 0.32;
const POND_RIPPLE_MIN = 2, POND_RIPPLE_MAX = 5;
const POND_SHORE_SEGS = 40;

function PondFeature({ pond, normalized, signals }: { pond: PointFeature | null; normalized: number[]; signals: MonthSignals[] }) {
  const rings = useMemo(() => {
    if (!pond) return [];
    // Clamped so the water level can never sink below the carpet — Jan
    // 2026's own real ground height is only ~0.05 units above baseline,
    // so a fixed POND_DEPTH subtracted unconditionally pushed the water
    // to -0.27, well beneath the carpet plane (-0.03) and hidden behind
    // it entirely. Caught by checking the actual number, not by
    // eyeballing the render — the zoomed crop just showed empty ground.
    const waterY = Math.max(CARPET_Y + 0.02, groundHeightAt(normalized, pond.x, 0) - POND_DEPTH);
    const rep = signalAt(signals, "repetitionIntensity", pond.x / SCENE_WIDTH + 0.5);
    const ringCount = Math.round(POND_RIPPLE_MIN + (POND_RIPPLE_MAX - POND_RIPPLE_MIN) * rep);
    const out: { positions: Float32Array; opacity: number }[] = [];
    for (let r = 0; r <= ringCount; r++) {
      const radius = r === 0 ? POND_RADIUS : POND_RADIUS * (1 - (r / (ringCount + 1)) * 0.7);
      const pts: number[] = [];
      for (let s = 0; s <= POND_SHORE_SEGS; s++) {
        const a = (s / POND_SHORE_SEGS) * Math.PI * 2;
        pts.push(pond.x + Math.cos(a) * radius, waterY, Math.sin(a) * radius * 0.62);
      }
      out.push({ positions: new Float32Array(pts), opacity: r === 0 ? 0.85 : 0.4 });
    }
    return out;
  }, [pond, normalized, signals]);

  if (!pond) return null;
  return (
    <>
      {rings.map((r, i) => (
        <line key={i}>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[r.positions, 3]} /></bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={r.opacity} />
        </line>
      ))}
    </>
  );
}

// ── lone trees — a trunk plus a canopy loop, sitting at each tree
// feature's real ground height. The canopy's edge is jittered around the
// loop by that specific month's real, concatenated line-length sequence
// (resampled by angle instead of by x-position, the same resampling
// technique the rest of this file uses for texture) — an organically
// uneven canopy outline whose particular unevenness is that one month's
// own real writing, not a generic wobble. ──
// Trunk taller and canopy jag capped tighter than the first pass — verified
// via the rasterizer that the original proportions (short trunk, jag
// uncapped) produced a spiky asterisk with no visible trunk, not a tree.
// A real per-poem line-length sequence can have wide swings (a prose-style
// poem's one long run-on "line" among many short ones), and without a cap
// that swing translated directly into a canopy point flying out past the
// loop's own centre — capping it at a fraction of the radius keeps the
// outline organically uneven without ever producing a self-intersecting
// star.
const TREE_TRUNK_HEIGHT = 0.42, TREE_CANOPY_RADIUS = 0.22, TREE_CANOPY_SEGS = 22;
const TREE_CANOPY_JAG_SCALE = 0.018, TREE_CANOPY_JAG_CAP = 0.4; // cap as a fraction of the radius

function LoneTrees({ trees, months, normalized }: { trees: PointFeature[]; months: TerrainMonth[]; normalized: number[] }) {
  const items = useMemo(() => {
    const out: { positions: Float32Array; opacity: number }[] = [];
    for (const t of trees) {
      const groundY = groundHeightAt(normalized, t.x, 0);
      const trunkTop = groundY + TREE_TRUNK_HEIGHT;
      out.push({ positions: new Float32Array([t.x, groundY, 0, t.x, trunkTop, 0]), opacity: 0.75 });

      const lens: number[] = [];
      for (const p of months[t.monthIdx].poems) lens.push(...p.lineLens);
      const seq = lens.length ? lens : [1];
      const mean = meanOf(seq);
      const jagCap = TREE_CANOPY_RADIUS * TREE_CANOPY_JAG_CAP;
      const canopyCenterY = trunkTop + TREE_CANOPY_RADIUS; // sits fully above the trunk top, no overlap
      const pts: number[] = [];
      for (let s = 0; s <= TREE_CANOPY_SEGS; s++) {
        const tt = s / TREE_CANOPY_SEGS;
        const a = tt * Math.PI * 2;
        const sampled = resampleSequence(seq, tt);
        const dev = sampled - mean;
        const jagRaw = Math.sign(dev) * Math.sqrt(Math.abs(dev)) * TREE_CANOPY_JAG_SCALE;
        const jag = Math.max(-jagCap, Math.min(jagCap, jagRaw));
        const r = TREE_CANOPY_RADIUS + jag;
        pts.push(t.x + Math.cos(a) * r, canopyCenterY + Math.sin(a) * r * 0.8, Math.sin(a) * r * 0.4);
      }
      out.push({ positions: new Float32Array(pts), opacity: 0.65 });
    }
    return out;
  }, [trees, months, normalized]);

  return (
    <>
      {items.map((it, i) => (
        <line key={i}>
          <bufferGeometry><bufferAttribute attach="attributes-position" args={[it.positions, 3]} /></bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={it.opacity} />
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

// ── The carpet — a platform the landscape sits on, kept from the prior
// pass. ──
const CARPET_WIDTH = SCENE_WIDTH * 1.9;
const CARPET_DEPTH = SCENE_DEPTH * 2.4;
const CARPET_Y = -0.03;

function CarpetSurface() {
  return (
    <mesh position={[0, CARPET_Y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[CARPET_WIDTH, CARPET_DEPTH]} />
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
// turntable.
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

// A faint seam line — the MILAT boundary.
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

// Light — kept for the carpet's benefit; the terrain itself uses no lit
// material, so this has no effect on the landscape's own lines.
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
// whole turntable assembly — driven by DOM-level drag handlers on
// LandingTerrain's outer wrapper, not R3F's own pointer events, so "drag
// anywhere on the canvas" works regardless of what's under the cursor.
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
  const globalMeanLine = useMemo(() => computeGlobalMeanLine(months), [months]);
  const zones = useMemo(() => classifyEcosystemZones(normalized), [normalized]);
  const pond = useMemo(() => findPondFeature(normalized, signals), [normalized, signals]);
  const trees = useMemo(() => {
    const exclude = new Set<number>();
    if (pond) exclude.add(pond.monthIdx);
    return findTreeFeatures(normalized, signals, zones, exclude);
  }, [normalized, signals, zones, pond]);

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
        <GroundField months={months} normalized={normalized} globalMeanLine={globalMeanLine} signals={signals} zones={zones} pond={pond} />
        <HillMass months={months} normalized={normalized} globalMeanLine={globalMeanLine} signals={signals} zones={zones} />
        <MountainMass months={months} normalized={normalized} globalMeanLine={globalMeanLine} signals={signals} zones={zones} />
        <PondFeature pond={pond} normalized={normalized} signals={signals} />
        <LoneTrees trees={trees} months={months} normalized={normalized} />
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
