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

// A deterministic hash — reintroduced for this pass, but for a narrowly
// different job than any earlier use: placing individual thicket strokes
// within a region (which candidate slot gets a stroke, its jitter, its
// lean direction). This is layout scatter, the same category as the
// mulberry32 dot-field scatter BackgroundField/CarpetField already use —
// not shape-generating noise. The shape-generating jaggedness this file
// removed a pass ago (fbm2D/value-noise driving height/character) stays
// removed; nothing here decides height, jag amplitude, or frequency.
function hash2D(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000000) / 1000000;
}

// ── thicket regions — contiguous x-ranges where the real elevation curve
// (poem count -> height, already Catmull-Rom smoothed) stays above a
// density threshold. Reusing that exact curve as the density signal ties
// "which stretches get the thicket treatment" directly to the same real
// data already driving height — a tall stretch IS a busy stretch. Because
// this walks the smooth curve rather than snapping to month indices,
// several consecutive high-density months merge into one continuous
// region automatically when the data stays high across all of them, and
// the region's start/end are the real threshold-crossing points, not
// month boundaries — similarity in the data produces continuity in the
// terrain, the way it should.
export interface ThicketRegion { xStart: number; xEnd: number; }

const THICKET_THRESHOLD = 0.3;
const THICKET_SAMPLES = 240;

function findThicketRegions(normalized: number[]): ThicketRegion[] {
  const regions: ThicketRegion[] = [];
  if (normalized.length === 0) return regions;
  let prevXNorm = 0;
  let prevVal = heightAt(normalized, 0);
  // If the curve is already above threshold at x=0 (a busy first month,
  // as this archive's Feb 2025 is), the region starts at the very edge —
  // there's no real crossing to find there. Missing this case made the
  // scan treat the first above-threshold SAMPLE as an "entry" and
  // extrapolate a crossing point from two values that were both already
  // above the line, producing a nonsensical reversed region (xStart >
  // xEnd). Caught by the rasterizer before shipping.
  let inRegion = prevVal >= THICKET_THRESHOLD;
  let startXNorm = 0;
  const crossing = (x0: number, v0: number, x1: number, v1: number) =>
    v1 === v0 ? x1 : x0 + (x1 - x0) * (THICKET_THRESHOLD - v0) / (v1 - v0);

  for (let i = 1; i <= THICKET_SAMPLES; i++) {
    const xNorm = i / THICKET_SAMPLES;
    const val = heightAt(normalized, xNorm);
    const above = val >= THICKET_THRESHOLD;
    if (above && !inRegion) {
      startXNorm = Math.max(0, Math.min(1, crossing(prevXNorm, prevVal, xNorm, val)));
      inRegion = true;
    } else if (!above && inRegion) {
      const endXNorm = Math.max(0, Math.min(1, crossing(prevXNorm, prevVal, xNorm, val)));
      regions.push({ xStart: (startXNorm - 0.5) * SCENE_WIDTH, xEnd: (endXNorm - 0.5) * SCENE_WIDTH });
      inRegion = false;
    }
    prevXNorm = xNorm; prevVal = val;
  }
  if (inRegion) regions.push({ xStart: (startXNorm - 0.5) * SCENE_WIDTH, xEnd: (1 - 0.5) * SCENE_WIDTH });
  return regions;
}

function insideAnyRegion(x: number, regions: ThicketRegion[]): boolean {
  return regions.some(r => x >= r.xStart && x <= r.xEnd);
}

// ── text signals — derived from the actual poems, not from noise ──
//
// Second pass on the vocabulary these signals render into. The first text-
// driven pass was accurate to the data but read as an instrument — a
// seismograph, a core sample, a wound — because "high intensity" always
// meant damage: a hash-gated dropout literally erased points from the
// line at high punctuation density, and the repetition echo floated free
// above the run like a glitch. Same real numbers this pass, different
// physical consequence: what used to gate whether a point gets DRAWN AT
// ALL now only gates how STILL the line is — the line never disappears.
// A punctuation-dense, repetitive month (this archive's Jan 2026) reads as
// a calm, quiet basin with a faint reflection in it, not a tear in the
// ground. A many-poem month (Feb 2025) reads as a thicket — many real
// growth-lines at genuinely different heights, because they ARE genuinely
// different poems — not one tightly combed surface.

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
  stillnessIntensity: number;  // real punctuation density, linear normalised — high means calm, not broken
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

// The archive-wide mean line length — the one fixed reference every poem's
// own average gets compared against to produce its "growth-line height"
// (see textMicroAt). Computed once from all real poems, not tuned by hand.
function computeGlobalMeanLine(months: TerrainMonth[]): number {
  const all: number[] = [];
  for (const m of months) for (const p of m.poems) all.push(...p.lineLens);
  return meanOf(all);
}

// The height texture at a point, now built from two real, separately
// motivated components instead of one:
//
// - origin: how this SPECIFIC poem's own average line length compares to
//   the archive-wide average. A wordier-lined poem's growth-line sits
//   higher than a terser one's, as its own fixed baseline — this is what
//   makes a many-poem month look like a thicket of individually-placed
//   growth-lines (48 lines, up to that many different real poems, each at
//   its own real height) instead of one combed surface all rising from
//   the same floor. A one-poem month has no scatter here at all, by
//   construction — every line reads the same poem, so they share one
//   origin, which is exactly the "still, uniform basin" read Jan 2026
//   needs.
// - local: this poem's own internal rhythm (deviation from ITS OWN mean,
//   resampled across the local span), same as before — the wiggle.
//
// `stillness` (real punctuation density, per month) damps ONLY the local
// wiggle, toward calm rather than toward absence. It never removes a
// point from the line — a still month is smoother ground, not a hole in
// it.
const ORIGIN_SCALE = 0.05;
const ORIGIN_CAP = 0.55;
const MICRO_SCALE = 0.018;
const MICRO_CAP = 0.3;
const PHASE_SPREAD = 0.7;
const STILLNESS_DAMPING = 0.88; // at maximum stillness, wiggle drops to 12% of its usual amplitude — calm, not glassy-dead

// A poem's own mean line length, translated into an origin offset — capped
// and sqrt-compressed the same way the local wiggle is below.
function originFor(poem: PoemTextProfile | undefined, globalMeanLine: number): number {
  if (!poem || !poem.lineLens.length) return 0;
  const dev = meanOf(poem.lineLens) - globalMeanLine;
  const compressed = Math.sign(dev) * Math.sqrt(Math.abs(dev));
  return Math.max(-ORIGIN_CAP, Math.min(ORIGIN_CAP, compressed * ORIGIN_SCALE));
}

function textMicroAt(months: TerrainMonth[], globalMeanLine: number, li: number, x: number, stillness: number): number {
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

  // Origin is blended smoothly across the month boundary (the neighbouring
  // month's own assigned poem, crossfaded by fractional position) rather
  // than switching in one step at the midpoint — a hard switch produced a
  // sharp vertical snap right at the boundary (an isolated poem with an
  // extreme mean line length would yank one growth-line straight up),
  // which read as a glitch, not a place. Smoothing it keeps the "each
  // poem sits at its own real height" idea without the jump.
  const m0 = Math.floor(monthFloat);
  const m1 = Math.min(n - 1, m0 + 1);
  const frac = monthFloat - m0;
  const poems0 = months[m0].poems, poems1 = months[m1].poems;
  const origin0 = originFor(poems0 && poems0.length ? poems0[li % poems0.length] : undefined, globalMeanLine);
  const origin1 = originFor(poems1 && poems1.length ? poems1[li % poems1.length] : undefined, globalMeanLine);
  const origin = origin0 + (origin1 - origin0) * frac;

  const localT0 = monthFloat - monthIdx + 0.5; // 0..1 across this month's own territory
  const zi = PROFILE_COUNT > 1 ? li / (PROFILE_COUNT - 1) : 0.5;
  const localT = Math.max(0, Math.min(1, localT0 + (zi - 0.5) * PHASE_SPREAD));
  const sampled = resampleSequence(poem.lineLens, localT);
  const localDev = sampled - poemMean;
  const localCompressed = Math.sign(localDev) * Math.sqrt(Math.abs(localDev));
  const local = Math.max(-MICRO_CAP, Math.min(MICRO_CAP, localCompressed * MICRO_SCALE));

  return origin + local * (1 - stillness * STILLNESS_DAMPING);
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

// The terrain's height at any (x, z) for depth-slice li. The broad taper
// away from centreline is a plain, fixed cosine falloff — no per-point
// noise varying how sharply it narrows, because that variation is exactly
// the "make it look natural" job this pass reassigns to real text. All of
// this point's texture comes from textMicroAt. Centreline-guaranteed real
// data is still intact (centerFalloff is exactly 1 at z=0 for every x, so
// the taper term can never touch the true Catmull-Rom height there); the
// poem-derived micro term can still nudge it, because it's real data, not
// decoration.
function terrainHeightAt(
  normalized: number[], months: TerrainMonth[], globalMeanLine: number,
  li: number, x: number, z: number, stillness: number,
): number {
  const xNorm = x / SCENE_WIDTH + 0.5;
  const zNorm = z / (SCENE_DEPTH / 2);
  const localIntensity = heightAt(normalized, xNorm);

  const centerFalloff = Math.max(0, Math.cos(zNorm * Math.PI / 2));
  const base = localIntensity * HEIGHT_SCALE * centerFalloff;

  const micro = textMicroAt(months, globalMeanLine, li, x, stillness);

  return Math.max(0, base + micro);
}

// ── The thicket — a genuinely different generation technique for dense
// stretches, not a retuned version of the curve technique. A continuous
// profile curve, however textured, is still one surface combed in one
// direction; it can't read as "many individual things at different
// depths" no matter how its height varies. So a thicket region is instead
// filled with many short, independent strokes — not full-width curves —
// each with its own position, depth, and lean angle, some skipped
// entirely to leave real sightlines through. Ordinary WebGL depth testing
// does the rest: strokes placed at genuinely scattered z, not a regular
// 48-slice grid, correctly occlude each other exactly as objects at
// different distances should.
//
// Still entirely text-driven: stroke COUNT scales with the real number of
// poems the region spans (busier -> more strokes); stroke ANGLE variance
// scales with the real line-length variance of those poems' own text
// (more internally erratic poems -> more erratic lean); LENGTH and
// placement use a deterministic hash purely for layout scatter (the same
// role mulberry32 already plays for the background/carpet dot fields) —
// it decides WHERE among the data-sized budget a stroke sits, never how
// tall, jagged, or frequent the ground itself is.
function monthsOverlappingRegion(months: TerrainMonth[], region: ThicketRegion): TerrainMonth[] {
  const n = months.length;
  const out: TerrainMonth[] = [];
  for (let i = 0; i < n; i++) {
    const xNorm = n > 1 ? i / (n - 1) : 0.5;
    const x = (xNorm - 0.5) * SCENE_WIDTH;
    if (x >= region.xStart - 1e-6 && x <= region.xEnd + 1e-6) out.push(months[i]);
  }
  return out;
}

function regionLineVariance(months: TerrainMonth[], region: ThicketRegion): number {
  const overlap = monthsOverlappingRegion(months, region);
  const all: number[] = [];
  for (const m of overlap) for (const p of m.poems) all.push(...p.lineLens);
  if (all.length < 2) return 0;
  const mean = meanOf(all);
  return all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length;
}

const STROKES_PER_POEM = 3;
const MIN_STROKES = 36;
const MAX_STROKES = 260;
const STROKE_SKIP_RATE = 0.32;   // fraction of candidate slots left empty — real sightlines through
const ANGLE_VARIANCE_SCALE = 40; // divides sqrt(line-length variance) down to a radians range
const ANGLE_MIN = 0.12, ANGLE_MAX_CAP = 0.85;
const STALK_MIN = 0.12, STALK_MAX = 0.42; // fraction of HEIGHT_SCALE
const OPACITY_TIERS = 4;

function angleMaxFor(variance: number): number {
  const compressed = Math.sqrt(variance);
  return Math.max(ANGLE_MIN, Math.min(ANGLE_MAX_CAP, compressed / ANGLE_VARIANCE_SCALE));
}

function groundHeightAt(normalized: number[], x: number, z: number): number {
  const xNorm = x / SCENE_WIDTH + 0.5;
  const zNorm = z / (SCENE_DEPTH / 2);
  const localIntensity = heightAt(normalized, xNorm);
  const centerFalloff = Math.max(0, Math.cos(zNorm * Math.PI / 2));
  return localIntensity * HEIGHT_SCALE * centerFalloff;
}

function ThicketField({ months, normalized, regions }: { months: TerrainMonth[]; normalized: number[]; regions: ThicketRegion[] }) {
  const tierPositions = useMemo(() => {
    const buckets: number[][] = Array.from({ length: OPACITY_TIERS }, () => []);
    regions.forEach((region, ri) => {
      const overlap = monthsOverlappingRegion(months, region);
      const totalPoems = overlap.reduce((a, m) => a + m.count, 0);
      const strokeCount = Math.max(MIN_STROKES, Math.min(MAX_STROKES, Math.round(totalPoems * STROKES_PER_POEM)));
      const angleMax = angleMaxFor(regionLineVariance(months, region));
      const width = region.xEnd - region.xStart;
      if (width <= 0) return;

      for (let s = 0; s < strokeCount; s++) {
        const seedBase = ri * 100000 + s;
        const hKeep   = hash2D(seedBase, 1, 5101);
        if (hKeep < STROKE_SKIP_RATE) continue; // an empty slot — a sightline through

        const hx     = hash2D(seedBase, 2, 5102);
        const hz     = hash2D(seedBase, 3, 5103);
        const hLean  = hash2D(seedBase, 4, 5104);
        const hAngle = hash2D(seedBase, 5, 5105);
        const hLen   = hash2D(seedBase, 6, 5106);
        const hJit   = hash2D(seedBase, 7, 5107);

        const x = region.xStart + hx * width;
        const z = (hz - 0.5) * SCENE_DEPTH;
        const groundY = groundHeightAt(normalized, x, z) + hJit * 0.04;

        const localIntensity = heightAt(normalized, x / SCENE_WIDTH + 0.5);
        const stalkFrac = STALK_MIN + (STALK_MAX - STALK_MIN) * hLen;
        const length = stalkFrac * HEIGHT_SCALE * (0.4 + 0.6 * localIntensity);
        const angle = (hAngle * 2 - 1) * angleMax; // tilt from vertical, both directions
        const leanDir = hLean * Math.PI * 2;       // which way it leans, not just how much

        const dx = Math.sin(angle) * Math.cos(leanDir) * length;
        const dz = Math.sin(angle) * Math.sin(leanDir) * length;
        const dy = Math.cos(angle) * length;

        const zNorm = z / (SCENE_DEPTH / 2);
        const zt = Math.max(0, Math.min(1, (zNorm + 1) / 2)); // 0..1 across depth, far -> near
        const tier = Math.max(0, Math.min(OPACITY_TIERS - 1, Math.floor(zt * OPACITY_TIERS)));
        buckets[tier].push(x, groundY, z, x + dx, groundY + dy, z + dz);
      }
    });
    return buckets.map(b => new Float32Array(b));
  }, [months, normalized, regions]);

  return (
    <>
      {tierPositions.map((positions, tier) => positions.length > 0 && (
        <lineSegments key={tier}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={0.24 + 0.16 * tier} />
        </lineSegments>
      ))}
    </>
  );
}

// ── The landform, drawn as lines ──
// Many parallel cross-section silhouettes across the depth axis, each a
// single continuous strip — no gaps, no dropped points. Nearer lines
// occlude farther ones through ordinary WebGL depth testing, reinforced by
// a subtle opacity gradient by depth. Adjacent slices show different
// character because they're reading different real poems (or different
// spans of the same poem, at different real baseline heights) via
// textMicroAt — many-poem months read as a thicket of individually placed
// growth-lines; a real ALL-CAPS density boosts a line's opacity/weight; a
// real repetition signal draws a faint mirrored reflection beneath a line,
// not a floating duplicate above it. All generic functions of the same
// per-month signals object — no special case for any one month.
const PROFILE_COUNT = 48;
const PROFILE_SAMPLES = 100;

const REPETITION_ECHO_THRESHOLD = 0.42;
const REPETITION_ECHO_OFFSET_Y = -0.05; // below the line — a reflection, not a duplicate floating above it
const REPETITION_ECHO_OFFSET_Z = 0.03;

function ProfileLines({ months, normalized, signals, globalMeanLine, regions }: { months: TerrainMonth[]; normalized: number[]; signals: MonthSignals[]; globalMeanLine: number; regions: ThicketRegion[] }) {
  const lines = useMemo(() => {
    const out: { positions: Float32Array; opacity: number }[] = [];
    const n = months.length;
    const monthIdxAt = (pi: number) => {
      const xNorm = pi / (PROFILE_SAMPLES - 1);
      return n > 1 ? Math.round(Math.max(0, Math.min(n - 1, xNorm * (n - 1)))) : 0;
    };
    const xAt = (pi: number) => (pi / (PROFILE_SAMPLES - 1) - 0.5) * SCENE_WIDTH;

    for (let li = 0; li < PROFILE_COUNT; li++) {
      const zt = PROFILE_COUNT > 1 ? li / (PROFILE_COUNT - 1) : 0.5; // 0..1
      const z = (zt - 0.5) * SCENE_DEPTH;
      const baseOpacity = 0.32 + 0.4 * zt; // nearer slices read slightly brighter

      // Thicket regions are rendered entirely by ThicketField instead — a
      // genuinely different technique, not this curve retextured. `keep`
      // marks which samples the curve is allowed to draw; thicket-region
      // samples are simply not part of this line at all (ThicketField owns
      // that width), which is different from the old punctuation-driven
      // dropout — this is a clean hand-off between two rendering systems
      // at a real data boundary, not damage.
      const pts: { x: number; y: number; z: number }[] = [];
      const caps: number[] = [];
      const reps: number[] = [];
      const keep: boolean[] = [];
      for (let pi = 0; pi < PROFILE_SAMPLES; pi++) {
        const xNorm = pi / (PROFILE_SAMPLES - 1);
        const x = xAt(pi);
        const stillness = signalAt(signals, "stillnessIntensity", xNorm);
        const y = terrainHeightAt(normalized, months, globalMeanLine, li, x, z, stillness);
        pts.push({ x, y, z });
        caps.push(signalAt(signals, "capsIntensity", xNorm));
        reps.push(signalAt(signals, "repetitionIntensity", xNorm));
        keep.push(!insideAnyRegion(x, regions));
      }

      // The line is one continuous strip end to end — but opacity and the
      // reflection trigger need to read LOCALLY (this specific month's real
      // caps/repetition), not as one average across all 19 months, which
      // would wash any single month's peak down to the archive mean. So the
      // draw calls are segmented at month boundaries — each segment's own
      // local average drives its own opacity/reflection — while adjacent
      // segments share their boundary point exactly, so there is never a
      // pixel of gap between them. This is purely a rendering/opacity
      // subdivision; every sample is still drawn, nothing is dropped.
      const emit = (from: number, to: number) => {
        if (to - from < 1) return;
        const segCaps = caps.slice(from, to + 1);
        const segReps = reps.slice(from, to + 1);
        const avgCaps = segCaps.reduce((a, b) => a + b, 0) / segCaps.length;
        const avgRep = segReps.reduce((a, b) => a + b, 0) / segReps.length;
        const opacity = Math.max(0.05, Math.min(1, baseOpacity * (1 + avgCaps * 0.6)));
        const positions = new Float32Array((to - from + 1) * 3);
        for (let k = from; k <= to; k++) {
          const j = (k - from) * 3;
          positions[j] = pts[k].x; positions[j + 1] = pts[k].y; positions[j + 2] = pts[k].z;
        }
        out.push({ positions, opacity });

        // Reflection: a real repetition signal draws a second, faint,
        // mirrored trace beneath the line — the poem's own repeated words
        // read as a reflection in still ground, not a hand-placed symbol.
        if (avgRep > REPETITION_ECHO_THRESHOLD) {
          const t = (avgRep - REPETITION_ECHO_THRESHOLD) / (1 - REPETITION_ECHO_THRESHOLD);
          const echo = new Float32Array(positions.length);
          for (let k = 0; k < positions.length; k += 3) {
            echo[k]     = positions[k];
            echo[k + 1] = positions[k + 1] + REPETITION_ECHO_OFFSET_Y * t;
            echo[k + 2] = positions[k + 2] + REPETITION_ECHO_OFFSET_Z * t;
          }
          out.push({ positions: echo, opacity: opacity * 0.42 * t });
        }
      };

      let segStart = keep[0] ? 0 : -1;
      for (let pi = 1; pi < PROFILE_SAMPLES; pi++) {
        if (!keep[pi]) {
          if (segStart !== -1) { emit(segStart, pi - 1); segStart = -1; }
          continue; // inside a thicket region — ThicketField draws here instead
        }
        if (segStart === -1) { segStart = pi; continue; } // first kept sample after a region
        if (monthIdxAt(pi) !== monthIdxAt(pi - 1)) {
          emit(segStart, pi - 1);
          segStart = pi - 1; // shared boundary point — the next segment starts here too, so nothing gaps
        }
      }
      if (segStart !== -1) emit(segStart, PROFILE_SAMPLES - 1);
    }
    return out;
  }, [months, normalized, signals, globalMeanLine]);

  return (
    <>
      {lines.map((l, i) => (
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
  const globalMeanLine = useMemo(() => computeGlobalMeanLine(months), [months]);
  const regions = useMemo(() => findThicketRegions(normalized), [normalized]);

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
        <ProfileLines months={months} normalized={normalized} signals={signals} globalMeanLine={globalMeanLine} regions={regions} />
        <ThicketField months={months} normalized={normalized} regions={regions} />
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
