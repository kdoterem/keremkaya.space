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

// ── terrain zones — four distinct, deliberately different rendering modes
// decided per point from real data, not one continuously-blended system.
// The previous pass (a single blended curve/stroke system varying by
// height and text signals) produced spiky tufts at the tall/dense end and
// thin ripples at the low end — neither committed fully to reading as
// anything in particular. This picks one of a small number of modes per
// region and renders it fully as that mode:
//
// - "peak": the top of the real height range (this archive: Feb 2025
//   alone clears the threshold) — dense contour mass (see MassField).
// - "basin": the bottom of the real height range (Jan 2026 and a couple
//   of other very-low-count months) — the calm curve technique, unchanged
//   from the previous two passes.
// - "dense": moderate height but real per-poem word-density well above
//   the archive's typical range — a lighter version of the same contour-
//   mass technique as peaks, distinct from both the dominant peak and
//   ordinary ground.
// - "ordinary": everything else — the connective tissue, unremarkable
//   rolling ground, the plain curve technique.
//
// Height decides peak/basin first (the same real Catmull-Rom curve that
// already drives elevation); word-density only gets a say among the
// months height didn't already claim, which is why Jan 2026 — the
// archive's single highest word-density month, one 1,104-word poem —
// stays a basin rather than becoming "dense": it's already the lowest
// point by height, and that real fact takes priority.
export type TerrainZoneMode = "peak" | "basin" | "dense" | "ordinary";
export interface TerrainZone { mode: TerrainZoneMode; xStart: number; xEnd: number; }

const PEAK_THRESHOLD = 0.5;
const BASIN_THRESHOLD = 0.08;
const DENSE_THRESHOLD = 0.55;
const ZONE_SAMPLES = 240;

function computeDensitySignal(months: TerrainMonth[], normalized: number[]): number[] {
  const wordDensity = months.map(m => (m.count > 0 ? m.words / m.count : 0));
  const logs = wordDensity.map(v => Math.log(v + 1e-4));
  const eligible = logs.filter((_, i) => normalized[i] > BASIN_THRESHOLD && normalized[i] < PEAK_THRESHOLD);
  const minL = eligible.length ? Math.min(...eligible) : 0;
  const maxL = eligible.length ? Math.max(...eligible) : 1;
  const range = maxL - minL || 1;
  return logs.map(l => Math.max(0, Math.min(1, (l - minL) / range)));
}

// Linear interpolation of a per-month scalar across x — same style as
// signalAt below, standalone here since it's needed before MonthSignals
// exists in the data flow.
function monthScalarAt(values: number[], xNorm: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];
  const clamped = Math.max(0, Math.min(1, xNorm));
  const scaled = clamped * (n - 1);
  const i = Math.floor(scaled);
  const t = scaled - i;
  const a = values[Math.min(n - 1, i)];
  const b = values[Math.min(n - 1, i + 1)];
  return a + (b - a) * t;
}

function modeAt(normalized: number[], densitySignal: number[], xNorm: number): TerrainZoneMode {
  const h = heightAt(normalized, xNorm);
  if (h >= PEAK_THRESHOLD) return "peak";
  if (h <= BASIN_THRESHOLD) return "basin";
  if (monthScalarAt(densitySignal, xNorm) >= DENSE_THRESHOLD) return "dense";
  return "ordinary";
}

// Walks the full x domain at fine resolution and groups it into contiguous
// same-mode runs. Because this walks the real smoothed signals rather than
// snapping to month indices, several consecutive months with genuinely
// similar character merge into one continuous zone automatically — a real
// stretch of high density reads as one mass, not several adjacent-but-
// separate ones just because it spans more than one data point.
function classifyZones(normalized: number[], densitySignal: number[]): TerrainZone[] {
  const zones: TerrainZone[] = [];
  if (normalized.length === 0) return zones;
  let currentMode = modeAt(normalized, densitySignal, 0);
  let startXNorm = 0;
  for (let i = 1; i <= ZONE_SAMPLES; i++) {
    const xNorm = i / ZONE_SAMPLES;
    const mode = modeAt(normalized, densitySignal, xNorm);
    if (mode !== currentMode) {
      zones.push({ mode: currentMode, xStart: (startXNorm - 0.5) * SCENE_WIDTH, xEnd: (xNorm - 0.5) * SCENE_WIDTH });
      currentMode = mode;
      startXNorm = xNorm;
    }
  }
  zones.push({ mode: currentMode, xStart: (startXNorm - 0.5) * SCENE_WIDTH, xEnd: (1 - 0.5) * SCENE_WIDTH });
  return mergeTinyZones(zones);
}

// The continuous signals sometimes graze a threshold at a shallow angle
// rather than crossing it cleanly, producing a hairline sliver zone
// (occasionally under a tenth of a scene unit wide) — real per the
// classifier's own logic, but the opposite of "commit fully to each
// mode": a sliver that thin can't read as anything, dense or otherwise.
// Fold any zone narrower than MIN_ZONE_WIDTH into whichever zone precedes
// it, then merge any now-adjacent same-mode zones the folding produced.
const MIN_ZONE_WIDTH = 0.25;
function mergeTinyZones(zones: TerrainZone[]): TerrainZone[] {
  if (zones.length === 0) return zones;
  const folded: TerrainZone[] = [zones[0]];
  for (let i = 1; i < zones.length; i++) {
    const z = zones[i];
    if (z.xEnd - z.xStart < MIN_ZONE_WIDTH) {
      folded[folded.length - 1] = { ...folded[folded.length - 1], xEnd: z.xEnd };
    } else {
      folded.push(z);
    }
  }
  const merged: TerrainZone[] = [folded[0]];
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

function insideMassZone(x: number, zones: TerrainZone[]): boolean {
  return zones.some(z => (z.mode === "peak" || z.mode === "dense") && x >= z.xStart && x <= z.xEnd);
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

// ── The mass — a genuinely different generation technique for peak and
// dense zones, replacing the previous pass's individual-stroke thicket.
// The strokes were legible as individual things but read as loose
// scratches or tufts, not as rock — a real mountain's sense of volume and
// shadow comes from many contour lines packed close together and
// overlapping, following the same landform, not from sparse marks with
// gaps between them. So a mass zone is filled with a dense GRID: many
// x-running profile lines (the same technique ordinary ground already
// uses) AND many z-running cross lines, both confined to the zone's own
// width, sampled and packed far more tightly than anywhere else on the
// terrain. Overlap and convergence between that many close lines is what
// reads as a continuous solid mass — line density and crossing standing
// in for shading, the way a hachured relief map suggests volume with no
// fill at all.
//
// Both x- and z-running lines still use the exact same real height
// function as ordinary ground (terrainHeightAt: real Catmull-Rom
// elevation + real per-poem micro-texture + real stillness damping) —
// this changes how many lines are drawn and how tightly they're packed,
// not what data decides their shape. Peak zones get the densest, most
// opaque grid; dense zones (real per-poem word-density, not height) get a
// visibly lighter version of the same technique — still a mass, just a
// smaller one, distinct from both the dominant peak and ordinary ground.
const MASS_X_LINES_PEAK = 90, MASS_Z_LINES_PEAK = 34, MASS_OPACITY_PEAK = 0.62;
const MASS_X_LINES_DENSE = 46, MASS_Z_LINES_DENSE = 16, MASS_OPACITY_DENSE = 0.4;
const MASS_SAMPLES = 44;

function massConfigFor(mode: TerrainZoneMode) {
  return mode === "peak"
    ? { xLines: MASS_X_LINES_PEAK, zLines: MASS_Z_LINES_PEAK, opacity: MASS_OPACITY_PEAK }
    : { xLines: MASS_X_LINES_DENSE, zLines: MASS_Z_LINES_DENSE, opacity: MASS_OPACITY_DENSE };
}

function MassField({ months, normalized, globalMeanLine, signals, zones }: {
  months: TerrainMonth[]; normalized: number[]; globalMeanLine: number; signals: MonthSignals[]; zones: TerrainZone[];
}) {
  const groups = useMemo(() => {
    const peak: number[] = [];
    const dense: number[] = [];

    for (const zone of zones) {
      if (zone.mode !== "peak" && zone.mode !== "dense") continue;
      const width = zone.xEnd - zone.xStart;
      if (width <= 0) continue;
      const cfg = massConfigFor(zone.mode);
      const target = zone.mode === "peak" ? peak : dense;

      // x-running: many depth-slices, each a profile curve confined to
      // this zone's width — same technique as ordinary ground, just far
      // denser and packed into a narrower z-range so adjacent lines
      // overlap rather than reading as separate strokes.
      for (let li = 0; li < cfg.xLines; li++) {
        const zt = cfg.xLines > 1 ? li / (cfg.xLines - 1) : 0.5;
        const z = (zt - 0.5) * SCENE_DEPTH;
        let prevX: number | null = null, prevY = 0, prevZ = 0;
        for (let si = 0; si <= MASS_SAMPLES; si++) {
          const t = si / MASS_SAMPLES;
          const x = zone.xStart + t * width;
          const xNorm = x / SCENE_WIDTH + 0.5;
          const stillness = signalAt(signals, "stillnessIntensity", xNorm);
          const y = terrainHeightAt(normalized, months, globalMeanLine, li, x, z, stillness);
          if (prevX !== null) target.push(prevX, prevY, prevZ, x, y, z);
          prevX = x; prevY = y; prevZ = z;
        }
      }

      // z-running: cross-sections at fixed x within the zone, sampled
      // across depth — the orthogonal grid that makes this read as a
      // mesh with real volume instead of many parallel strokes all
      // running the same direction, which was exactly the earlier
      // curve-only pass's "combed" problem.
      for (let zi = 0; zi < cfg.zLines; zi++) {
        const xt = cfg.zLines > 1 ? zi / (cfg.zLines - 1) : 0.5;
        const x = zone.xStart + xt * width;
        const xNorm = x / SCENE_WIDTH + 0.5;
        const stillness = signalAt(signals, "stillnessIntensity", xNorm);
        let prevZ: number | null = null, prevY = 0, prevX = 0;
        for (let si = 0; si <= MASS_SAMPLES; si++) {
          const t = si / MASS_SAMPLES;
          const z = (t - 0.5) * SCENE_DEPTH;
          // Reuses the same li-driven poem/phase selection as the x-lines
          // at the matching depth, so a z-line's height agrees with the
          // x-lines it crosses rather than reading a different poem there.
          const li = Math.round(t * (PROFILE_COUNT - 1));
          const y = terrainHeightAt(normalized, months, globalMeanLine, li, x, z, stillness);
          if (prevZ !== null) target.push(prevX, prevY, prevZ, x, y, z);
          prevX = x; prevY = y; prevZ = z;
        }
      }
    }
    return { peak: new Float32Array(peak), dense: new Float32Array(dense) };
  }, [months, normalized, globalMeanLine, signals, zones]);

  return (
    <>
      {groups.peak.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[groups.peak, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={MASS_OPACITY_PEAK} />
        </lineSegments>
      )}
      {groups.dense.length > 0 && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[groups.dense, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color="#0a0a0a" transparent opacity={MASS_OPACITY_DENSE} />
        </lineSegments>
      )}
    </>
  );
}

// ── The landform, drawn as lines — the "basin" and "ordinary" zones only
// now; "peak" and "dense" zones are MassField's, entirely. Many parallel
// cross-section silhouettes across the depth axis, each a single
// continuous strip — no gaps, no dropped points. Nearer lines occlude
// farther ones through ordinary WebGL depth testing, reinforced by a
// subtle opacity gradient by depth. A real ALL-CAPS density boosts a
// line's opacity/weight; a real repetition signal draws a faint mirrored
// reflection beneath a line, not a floating duplicate above it. All
// generic functions of the same per-month signals object — no special
// case for any one month.
const PROFILE_COUNT = 48;
const PROFILE_SAMPLES = 100;

const REPETITION_ECHO_THRESHOLD = 0.42;
const REPETITION_ECHO_OFFSET_Y = -0.05; // below the line — a reflection, not a duplicate floating above it
const REPETITION_ECHO_OFFSET_Z = 0.03;

function ProfileLines({ months, normalized, signals, globalMeanLine, zones }: { months: TerrainMonth[]; normalized: number[]; signals: MonthSignals[]; globalMeanLine: number; zones: TerrainZone[] }) {
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

      // Peak and dense zones are rendered entirely by MassField instead —
      // a genuinely different technique, not this curve retextured. `keep`
      // marks which samples the curve is allowed to draw; mass-zone
      // samples are simply not part of this line at all (MassField owns
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
        keep.push(!insideMassZone(x, zones));
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
          continue; // inside a peak/dense zone — MassField draws here instead
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
  }, [months, normalized, signals, globalMeanLine, zones]);

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
  const densitySignal = useMemo(() => computeDensitySignal(months, normalized), [months, normalized]);
  const zones = useMemo(() => classifyZones(normalized, densitySignal), [normalized, densitySignal]);

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
        <ProfileLines months={months} normalized={normalized} signals={signals} globalMeanLine={globalMeanLine} zones={zones} />
        <MassField months={months} normalized={normalized} globalMeanLine={globalMeanLine} signals={signals} zones={zones} />
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
