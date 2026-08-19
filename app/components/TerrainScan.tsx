"use client";

import { useMemo, useRef } from "react";

// ── TerrainScan — shared HUD rendering primitives for the terrain, used by
// both LandingTerrain (landing/BROWSE) and ReadingJourney (PLAY) so the two
// surfaces render the *same* visual system by construction, not by two
// hand-matched implementations. This module owns: the wireframe mesh (a
// single data line re-expressed as several receding depth layers + cross-
// section ribs, so it reads as a scanned 3D surface instead of a 2D chart
// line), the scan sweep (a slow SMIL-driven pass that brightens the mesh as
// it crosses), and the leader-line annotation. None of this touches data,
// erosion seeds, or journey mechanics — it only changes how a set of points
// is drawn. ──

export interface Pt { x: number; y: number }

export interface DispNode {
  frac:  number;
  left:  DispNode | null;
  right: DispNode | null;
}

// Deterministic PRNG — unchanged from every prior pass. Same seed, same
// sequence, always.
export function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDispTree(rand: () => number, levels: number): DispNode | null {
  if (levels <= 0) return null;
  return {
    frac:  (rand() - 0.5) * 2,
    left:  buildDispTree(rand, levels - 1),
    right: buildDispTree(rand, levels - 1),
  };
}

export function buildSegmentTrees(numSegments: number, seed: number, levels: number): (DispNode | null)[] {
  const rand = mulberry32(seed);
  const trees: (DispNode | null)[] = [];
  for (let i = 0; i < numSegments; i++) trees.push(buildDispTree(rand, levels));
  return trees;
}

function applyDisplacement(p1: Pt, p2: Pt, node: DispNode | null, mag: number, out: Pt[]) {
  if (!node) { out.push(p2); return; }
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const disp = node.frac * mag;
  const mid  = { x: mx + nx * disp, y: my + ny * disp };
  applyDisplacement(p1, mid, node.left, mag / 2, out);
  applyDisplacement(mid, p2, node.right, mag / 2, out);
}

// The midpoint-displacement erosion, returning the displaced point list
// directly (rather than an SVG path string) — the mesh needs the points
// themselves to split them into confidence-gated runs.
export function erodedPoints(pts: Pt[], trees: (DispNode | null)[], mag0: number): Pt[] {
  if (pts.length === 0) return [];
  if (pts.length === 1) return [pts[0]];
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) applyDisplacement(pts[i], pts[i + 1], trees[i] ?? null, mag0, out);
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function pointsToPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let k = 1; k < pts.length; k++) d += ` L ${pts[k].x.toFixed(2)},${pts[k].y.toFixed(2)}`;
  return d;
}

// Interpolates a per-month confidence value at an arbitrary x — used to
// gate mesh detail against a signal that's only sampled once per month,
// same bracket-and-lerp approach as the original reference-height lookup.
export function confidenceAt(x: number, monthPts: Pt[], confidences: number[]): number {
  if (monthPts.length === 0) return 1;
  if (x <= monthPts[0].x) return confidences[0] ?? 1;
  if (x >= monthPts[monthPts.length - 1].x) return confidences[confidences.length - 1] ?? 1;
  for (let i = 0; i < monthPts.length - 1; i++) {
    const a = monthPts[i], b = monthPts[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      const ca = confidences[i] ?? 1, cb = confidences[i + 1] ?? 1;
      return ca + (cb - ca) * t;
    }
  }
  return confidences[confidences.length - 1] ?? 1;
}

// ── Mesh geometry ──
// A single data line re-expressed as MESH_LAYERS depth layers, rendered as
// landscape viewed from above at a slight downward angle, not a cross-
// section diagram. Three things do that work:
//
//  1. Perspective compression — each layer's depth offset shrinks
//     geometrically (DEPTH_COMPRESSION), so rows crowd together receding
//     "back" instead of marching away at even steps, and each layer's line
//     weight (LAYER_STROKE_W) thins with it. This is most of the depth cue.
//  2. Elevation weight — a point's own height above the baseline (not just
//     which layer it's on) bumps its stroke weight/opacity via ELEV_WEIGHT,
//     so a peak visibly outweighs a valley within the same layer.
//  3. A mild x-convergence toward the data's own centre (X_CONVERGE_MAX) as
//     layers recede, plus a slight vertical foreshortening (VIEW_TILT) —
//     together read as a downward viewing angle rather than flat side-on.
//
// LAYER_CONF_THRESHOLD still gates how deep a region's layers reach — a
// low-confidence (sparse-data) stretch drops its back layers first, so the
// mesh visibly thins where "the instrument is struggling to resolve" that
// ground, before the front layer (the real data) ever does.
export const MESH_LAYERS = 4;

const DEPTH_GAP_BASE    = 11;    // px, offset from layer 0 to layer 1 — the largest single step
const DEPTH_COMPRESSION = 0.52;  // each further step shrinks by this factor — rows crowd going "back"
const DEPTH_OFFSETS: number[] = (() => {
  const out = [0];
  let gap = DEPTH_GAP_BASE;
  for (let i = 1; i < MESH_LAYERS; i++) { out.push(out[i - 1] + gap); gap *= DEPTH_COMPRESSION; }
  return out;
})();

const DEPTH_FLATTEN  = 0.3;   // fraction blended toward mean height, per layer step
const VIEW_TILT      = 0.9;   // vertical foreshortening around the mean — looked down upon, not side-on
const X_CONVERGE_MAX = 0.16;  // deepest layer's x pulled this fraction toward the data's own centre

const EROSION_SCALE   = [1, 0.7, 0.42, 0.22];        // erosion detail recedes with depth
const LAYER_STROKE_W  = [1.1, 0.7, 0.42, 0.26];      // front heaviest, back hairline — weight IS depth
const LAYER_OPACITY   = [0.85, 0.5, 0.3, 0.16];
const LAYER_CONF_THRESHOLD = [0, 0.3, 0.55, 0.8];    // min confidence required for this layer to render

const CROSS_OPACITY      = 0.18;
const CROSS_STROKE_FRONT = 0.55; // the rib's near half — heavier
const CROSS_STROKE_BACK  = 0.2;  // the rib's far half — thinner, tapering into the depth

// Peaks read brighter/heavier than valleys — height itself doing visible
// work, not just position on the page. Tiered (not a smooth gradient) so
// it reads as a handful of deliberate weight steps, the same register as
// the confidence gating above it.
const ELEV_TIERS  = [0.25, 0.5, 0.75];       // fraction-of-local-peak-height breakpoints
const ELEV_WEIGHT = [0.55, 0.78, 1, 1.35];   // valley -> peak stroke/opacity multiplier

function elevationTier(frac: number): number {
  for (let i = 0; i < ELEV_TIERS.length; i++) if (frac < ELEV_TIERS[i]) return i;
  return ELEV_TIERS.length;
}

function xScaleFor(layer: number): number {
  const t = MESH_LAYERS > 1 ? layer / (MESH_LAYERS - 1) : 0;
  return 1 - X_CONVERGE_MAX * t;
}
function layerXForward(x: number, centerX: number, layer: number): number {
  return centerX + (x - centerX) * xScaleFor(layer);
}
// Erosion needs the converged x to displace in the drawn coordinate space,
// but confidence/elevation are only known per original month — this
// recovers an approximate original x from a (possibly eroded, so not
// perfectly invertible) point on a converged layer, close enough for a
// coarse tier lookup.
function layerXInverse(x: number, centerX: number, layer: number): number {
  return centerX + (x - centerX) / xScaleFor(layer);
}

function layerY(y: number, meanY: number, layer: number): number {
  const flattenT = DEPTH_FLATTEN * layer;
  const flattened = y * (1 - flattenT) + meanY * flattenT;
  const tilted = meanY + (flattened - meanY) * VIEW_TILT;
  return tilted - DEPTH_OFFSETS[layer];
}

function sceneMetrics(points: Pt[]) {
  const meanY = points.reduce((s, p) => s + p.y, 0) / points.length;
  const xs = points.map(p => p.x);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const peakY = Math.min(...points.map(p => p.y));      // smallest y = tallest peak
  const baselineY = Math.max(...points.map(p => p.y));  // largest y = valley/baseline
  return { meanY, centerX, peakY, baselineY };
}

interface MeshSegment { d: string; tier: number }
interface MeshLayer { layer: number; segments: MeshSegment[] }

function buildMeshLayers(
  points: Pt[], dispTrees: (DispNode | null)[], mag0: number, confidences: number[],
): MeshLayer[] {
  if (points.length === 0) return [];
  const { meanY, centerX, peakY, baselineY } = sceneMetrics(points);
  const elevations = points.map(p => clamp((baselineY - p.y) / ((baselineY - peakY) || 1), 0, 1));

  const out: MeshLayer[] = [];
  for (let i = 0; i < MESH_LAYERS; i++) {
    const layerPts = points.map(p => ({ x: layerXForward(p.x, centerX, i), y: layerY(p.y, meanY, i) }));
    const eroded    = erodedPoints(layerPts, dispTrees, mag0 * EROSION_SCALE[i]);
    const threshold = LAYER_CONF_THRESHOLD[i];

    const segments: MeshSegment[] = [];
    let run: Pt[] = [];
    let runTier = -1;
    const flush = () => { if (run.length > 1) segments.push({ d: pointsToPath(run), tier: runTier }); run = []; };

    for (const pt of eroded) {
      const origX = layerXInverse(pt.x, centerX, i);
      const conf  = confidenceAt(origX, points, confidences);
      if (conf < threshold) { flush(); runTier = -1; continue; }
      const tier = elevationTier(confidenceAt(origX, points, elevations));
      if (tier !== runTier) { flush(); runTier = tier; }
      run.push(pt);
    }
    flush();
    out.push({ layer: i, segments });
  }
  return out;
}

interface CrossSection { x0: number; y0: number; x1: number; y1: number; confidence: number; weight: number }

function buildCrossSections(points: Pt[], confidences: number[]): CrossSection[] {
  if (points.length === 0) return [];
  const { meanY, centerX, peakY, baselineY } = sceneMetrics(points);
  return points
    .map((p, i) => {
      const conf = confidences[i] ?? 1;
      let deepest = 0;
      for (let l = 0; l < MESH_LAYERS; l++) if (conf >= LAYER_CONF_THRESHOLD[l]) deepest = l;
      const elevFrac = clamp((baselineY - p.y) / ((baselineY - peakY) || 1), 0, 1);
      return {
        x0: layerXForward(p.x, centerX, 0), y0: layerY(p.y, meanY, 0),
        x1: layerXForward(p.x, centerX, deepest), y1: layerY(p.y, meanY, deepest),
        confidence: conf,
        weight: ELEV_WEIGHT[elevationTier(elevFrac)],
      };
    })
    .filter(cs => cs.confidence > 0);
}

// The wireframe itself — contour layers (horizontal-ish, along the ridge)
// plus cross-section ribs (perpendicular, one per month) forming a lattice,
// perspective-compressed and elevation-weighted so it reads as landscape
// under a downward-angled scan rather than a cross-section diagram.
// opacityMultiplier > 1 is how the sweep's brightening pass reads: SVG
// clamps opacity at 1, so a masked, boosted copy laid over the idle mesh
// flashes to full brightness only where the mask currently allows it.
export function MeshLayers({
  points, dispTrees, mag0, confidences, opacityMultiplier = 1, glow = false,
}: {
  points: Pt[];
  dispTrees: (DispNode | null)[];
  mag0: number;
  confidences: number[];
  opacityMultiplier?: number;
  glow?: boolean;
}) {
  const layers = useMemo(
    () => buildMeshLayers(points, dispTrees, mag0, confidences),
    [points, dispTrees, mag0, confidences],
  );
  const crossSections = useMemo(() => buildCrossSections(points, confidences), [points, confidences]);

  return (
    <g style={glow ? { filter: "drop-shadow(0 0 1.5px rgba(10,10,10,0.4))" } : undefined}>
      {crossSections.map((cs, i) => {
        const midX = (cs.x0 + cs.x1) / 2, midY = (cs.y0 + cs.y1) / 2;
        const op = CROSS_OPACITY * cs.confidence * cs.weight * opacityMultiplier;
        return (
          <g key={`cs-${i}`}>
            <line x1={cs.x0} y1={cs.y0} x2={midX} y2={midY} stroke="#0a0a0a" strokeWidth={CROSS_STROKE_FRONT} strokeOpacity={op} />
            <line x1={midX} y1={midY} x2={cs.x1} y2={cs.y1} stroke="#0a0a0a" strokeWidth={CROSS_STROKE_BACK} strokeOpacity={op} />
          </g>
        );
      })}
      {layers.map(layer => layer.segments.map((seg, si) => (
        <path
          key={`l${layer.layer}-${si}`}
          d={seg.d} fill="none" stroke="#0a0a0a"
          strokeWidth={LAYER_STROKE_W[layer.layer] * ELEV_WEIGHT[seg.tier]}
          strokeLinecap="round" strokeLinejoin="round"
          strokeOpacity={Math.min(1, LAYER_OPACITY[layer.layer] * ELEV_WEIGHT[seg.tier] * opacityMultiplier)}
        />
      )))}
    </g>
  );
}

// ── Scan sweep ──
// A single thin bright line and a matching soft brightening band traverse
// the frame edge-to-edge on a slow loop, purely via SMIL <animate> — no
// React state, no rAF, so it keeps running even when the fader is fully at
// rest and nothing else is re-rendering. This is the one deliberately
// unconditional motion on the page: an instrument reading something never
// looks fully resolved, so the idle state itself has to keep moving.
let sweepInstanceId = 0;

export function SweepOverlay({
  width, height, points, dispTrees, mag0, confidences, durationS = 10,
}: {
  width: number; height: number;
  points: Pt[]; dispTrees: (DispNode | null)[]; mag0: number; confidences: number[];
  durationS?: number;
}) {
  const idRef = useRef<string | null>(null);
  if (idRef.current == null) idRef.current = `sweep-${++sweepInstanceId}`;
  const id = idRef.current;
  const bandW = Math.max(30, width * 0.06);

  if (width <= 0 || height <= 0) return null;

  return (
    <>
      <defs>
        <linearGradient id={`${id}-grad`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0"   stopColor="white" stopOpacity="0" />
          <stop offset="0.5" stopColor="white" stopOpacity="1" />
          <stop offset="1"   stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}-mask`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <rect y={0} height={height} width={bandW} fill={`url(#${id}-grad)`}>
            <animate attributeName="x" values={`${-bandW};${width};${-bandW}`} dur={`${durationS}s`} repeatCount="indefinite" />
          </rect>
        </mask>
      </defs>

      <g mask={`url(#${id}-mask)`}>
        <MeshLayers points={points} dispTrees={dispTrees} mag0={mag0} confidences={confidences} opacityMultiplier={2.4} glow />
      </g>

      <line x1={0} y1={0} x2={0} y2={height} stroke="#0a0a0a" strokeWidth={1} strokeOpacity={0.5}>
        <animate attributeName="x1" values={`0;${width};0`} dur={`${durationS}s`} repeatCount="indefinite" />
        <animate attributeName="x2" values={`0;${width};0`} dur={`${durationS}s`} repeatCount="indefinite" />
      </line>
    </>
  );
}

// ── Annotation ──
// A fixed point with a short bent leader line out to a floating label —
// several of these on screen at once is what makes this read as a HUD
// rather than a chart: data is annotated in place, geometrically, not
// collected into one caption below the frame.
export type AnnotationVariant = "data" | "seam" | "position" | "transient";

const ANNOTATION_STYLE: Record<AnnotationVariant, { dash?: string; opacity: number }> = {
  data:      { opacity: 0.5 },
  seam:      { dash: "1 3", opacity: 0.55 },
  position:  { opacity: 0.85 },
  transient: { opacity: 0.7 },
};

const HUD_MONO = '"SF Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace';

export function Annotation({
  x, y, label, sublabel, side = "right", vSide = "up", variant = "data", leaderLength = 24,
}: {
  x: number; y: number;
  label: string; sublabel?: string;
  side?: "left" | "right";
  vSide?: "up" | "down"; // which way the leader climbs — "up" (default) goes off-canvas for
                          // a point already near the top edge, so callers near the frame's
                          // top pass "down" instead.
  variant?: AnnotationVariant;
  leaderLength?: number;
}) {
  const dir  = side === "right" ? 1 : -1;
  const vDir = vSide === "up" ? -1 : 1;
  const midX = x + dir * leaderLength * 0.45;
  const midY = y + vDir * leaderLength * 0.4;
  const endX = x + dir * leaderLength;
  const endY = y + vDir * leaderLength * 0.75;
  const style = ANNOTATION_STYLE[variant];

  return (
    <g>
      <circle cx={x} cy={y} r={variant === "position" ? 2.5 : 1.5} fill="#0a0a0a" fillOpacity={style.opacity} />
      <path
        d={`M ${x.toFixed(1)},${y.toFixed(1)} L ${midX.toFixed(1)},${midY.toFixed(1)} L ${endX.toFixed(1)},${endY.toFixed(1)}`}
        fill="none" stroke="#0a0a0a" strokeWidth={0.75} strokeOpacity={style.opacity} strokeDasharray={style.dash}
      />
      <text
        x={endX + dir * 4} y={endY}
        textAnchor={side === "right" ? "start" : "end"}
        fontFamily={HUD_MONO} fontSize={9} fill="#0a0a0a" fillOpacity={style.opacity}
        style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
        {sublabel && (
          <tspan x={endX + dir * 4} dy="1.15em" fillOpacity={style.opacity * 0.65}>{sublabel}</tspan>
        )}
      </text>
    </g>
  );
}

// ── Per-month scan confidence ──
// A thin/low-count month is a weaker return — the instrument has less to
// resolve there. Zero-post gap months read as no return at all (0), real
// but sparse months get a floor above 0 so they're visibly weaker without
// vanishing outright, and anything at or above ~30% of the fullest month
// reads as a full, confident scan.
export function computeConfidences(counts: number[]): number[] {
  const max = Math.max(1, ...counts);
  const ref = max * 0.3;
  return counts.map(c => (c === 0 ? 0 : Math.max(0.25, Math.min(1, c / ref))));
}
