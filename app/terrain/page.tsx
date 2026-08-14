"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface TerrainMonth {
  month: string; // YYYY-MM
  count: number;
  words: number;
}

interface Pt {
  x: number;
  y: number;      // exact resting position — no jitter. Roughness lives between points, not on them.
  count: number;
  words: number;
  month: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

// Deterministic PRNG — every seeded sequence below (erosion, point field) is
// rebuilt fresh from the same seed and drawn in the same fixed order, so the
// output is bit-identical every time. Nothing here is ever re-rolled.
function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Erosion: recursive midpoint displacement ────────────────────────────────
// A binary tree of pre-drawn random fractions (-1..1), one per segment between
// consecutive months. Built once from a fixed seed and cached — applying it
// later never draws another random number, so the same fractions reshape
// around wherever the (swelled) endpoints currently sit, but the roughness
// pattern itself never changes.
interface DispNode {
  frac: number;
  left: DispNode | null;
  right: DispNode | null;
}

function buildDispTree(rand: () => number, levels: number): DispNode | null {
  if (levels <= 0) return null;
  return {
    frac: (rand() - 0.5) * 2,
    left: buildDispTree(rand, levels - 1),
    right: buildDispTree(rand, levels - 1),
  };
}

function buildSegmentTrees(numSegments: number, seed: number, levels: number): (DispNode | null)[] {
  const rand = mulberry32(seed);
  const trees: (DispNode | null)[] = [];
  for (let i = 0; i < numSegments; i++) trees.push(buildDispTree(rand, levels));
  return trees;
}

// Displaces the midpoint of (p1,p2) perpendicular to the segment by
// node.frac * mag, then recurses into both halves with mag halved — ridges
// within ridges. p1 is assumed already emitted by the caller; this only
// appends from just-after p1 through p2 inclusive.
function applyDisplacement(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  node: DispNode | null,
  mag: number,
  out: { x: number; y: number }[],
) {
  if (!node) { out.push(p2); return; }
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const disp = node.frac * mag;
  const mid = { x: mx + nx * disp, y: my + ny * disp };
  applyDisplacement(p1, mid, node.left, mag / 2, out);
  applyDisplacement(mid, p2, node.right, mag / 2, out);
}

// Builds the eroded path through the (possibly swelled) month positions.
// The 19 positions themselves are untouched inputs — only what happens
// between each consecutive pair is fractal, not straight or splined.
function erodedPath(pts: { x: number; y: number }[], trees: (DispNode | null)[], mag0: number): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  const out: { x: number; y: number }[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    applyDisplacement(pts[i], pts[i + 1], trees[i] ?? null, mag0, out);
  }
  let d = `M ${out[0].x.toFixed(2)},${out[0].y.toFixed(2)}`;
  for (let k = 1; k < out.length; k++) d += ` L ${out[k].x.toFixed(2)},${out[k].y.toFixed(2)}`;
  return d;
}

// Linear reference height of the (un-eroded, un-swelled) profile at a given
// x — used only to seed the point field's density, not for rendering.
function referenceY(points: Pt[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      return a.y + (b.y - a.y) * t;
    }
  }
  return points[points.length - 1].y;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp  = (a: number, b: number, t: number) => a + (b - a) * t;

const TOP_PADDING  = 58;   // headroom above the tallest peak for swell + erosion + the reveal sliver
const REVEAL_SLICE = 10;   // px of the tallest peak still visible at the most-submerged setting
const STROKE_W     = 1.75;
const FADER_W      = 30;
const EDGE_ZONE    = 0.12; // fraction of travel, near each end, where the fader gains resistance
const FRICTION     = 0.94;
const SWELL_AMP    = 7;    // px the line rises at the point nearest the cursor/finger
const DOT_MARKS    = [0.2, 0.4, 0.6, 0.8];
const BG           = "#aaff00";

const EROSION_SEED   = 1337;
const EROSION_LEVELS = 5;   // 4-6: ridges within ridges without turning to noise
const EROSION_MAG0   = 14;  // px, level-1 max perpendicular displacement — halves each level after

const DOTS_SEED        = 777;
const NUM_DOTS          = 260;
const DOT_R             = 0.7;
const DOT_OPACITY_MAX   = 0.12;  // base opacity right at the surface
const DOT_OPACITY_MIN   = 0.02;  // base opacity at the edge of the scatter
const PROXIMITY_SIGMA   = 55;    // px — how wide the cursor's "scan" reads
const PROXIMITY_BOOST   = 0.24;

let _terrainCache: TerrainMonth[] | null = null;

export default function TerrainPage() {
  const [data, setData] = useState<TerrainMonth[]>(_terrainCache ?? []);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (_terrainCache) { setData(_terrainCache); return; }
    fetch("/api/terrain").then(r => r.json()).then((d: TerrainMonth[]) => {
      _terrainCache = d;
      setData(d);
    });
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setDims({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxCount = useMemo(() => Math.max(1, ...data.map(d => d.count)), [data]);

  // Static layout: each month's exact resting position. No jitter here — the
  // erosion below is where the roughness lives; these 19 points are the fixed
  // ground truth that swell, hover, and the readout all key to.
  const points = useMemo<Pt[]>(() => {
    const { width, height } = dims;
    if (!width || !height || data.length === 0) return [];
    const innerW      = width - STROKE_W * 4;
    const baseline    = height;
    const pxPerCount  = (height - TOP_PADDING) / maxCount;
    const n = data.length;
    return data.map((d, i) => {
      const x = STROKE_W * 2 + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const y = baseline - d.count * pxPerCount;
      return { x, y, count: d.count, words: d.words, month: d.month };
    });
  }, [data, dims, maxCount]);

  const baselineY = dims.height;
  const peakY     = points.length ? Math.min(...points.map(p => p.y)) : 0;

  // Built once per data length — the fixed random fractions the erosion always
  // reapplies. Never rebuilt on resize or interaction.
  const dispTrees = useMemo(
    () => buildSegmentTrees(Math.max(0, points.length - 1), EROSION_SEED, EROSION_LEVELS),
    [points.length],
  );

  // The scanned point field: static positions, denser and more opaque near the
  // (reference) surface, thinning with distance. Computed once per layout.
  const dots = useMemo(() => {
    if (points.length === 0) return [];
    const rand   = mulberry32(DOTS_SEED);
    const spread = clamp(dims.height * 0.2, 30, 90);
    const list: { x: number; y: number; base: number }[] = [];
    for (let i = 0; i < NUM_DOTS; i++) {
      const x = rand() * dims.width;
      const ref = referenceY(points, x);
      // Exponential falloff either side of the surface — clusters close,
      // thins fast, matches a scanned/sounded point cloud rather than a
      // uniform haze.
      const side = rand() < 0.5 ? -1 : 1;
      const offset = side * -Math.log(1 - rand()) * spread * 0.5;
      const y = clamp(ref + offset, 0, dims.height);
      const t = clamp(Math.abs(offset) / spread, 0, 1);
      list.push({ x, y, base: lerp(DOT_OPACITY_MAX, DOT_OPACITY_MIN, t) });
    }
    return list;
  }, [points, dims.width, dims.height]);

  // ── live render state — path string, dot glow, waterline, thumb + readout,
  // all driven by one rAF loop so fader inertia, swell, and the proximity
  // glow stay in lockstep ──
  const [render, setRender] = useState({
    linePath: "", dotOpacities: [] as number[], waterlineY: 0, faderT: 1, hoverIndex: -1,
  });

  const faderVal = useRef(1);   // 0 = up/submerged, 1 = down/full visibility
  const faderVel = useRef(0);
  const dragging = useRef(false);
  const swell    = useRef<number[]>([]);
  const pointerX = useRef<number | null>(null);
  const pointerY = useRef<number | null>(null);
  const rafId    = useRef<number | null>(null);
  const dragHist = useRef<{ v: number; t: number }[]>([]);

  useEffect(() => { swell.current = points.map(() => 0); }, [points.length]);

  const tick = useCallback(() => {
    let more = false;

    if (dragging.current) {
      more = true;
    } else if (Math.abs(faderVel.current) > 0.00006) {
      let v = faderVal.current + faderVel.current;
      let damp = FRICTION;
      if (v < EDGE_ZONE)     damp -= ((EDGE_ZONE - Math.max(v, 0)) / EDGE_ZONE) * 0.5;
      if (v > 1 - EDGE_ZONE) damp -= ((v - (1 - EDGE_ZONE)) / EDGE_ZONE) * 0.5;
      faderVel.current *= Math.max(damp, 0.35);
      if (v <= 0) { v = 0; faderVel.current = 0; }
      if (v >= 1) { v = 1; faderVel.current = 0; }
      faderVal.current = v;
      more = Math.abs(faderVel.current) > 0.00006;
    }

    const px = pointerX.current;
    const py = pointerY.current;
    let swelling = false;
    const sw = swell.current;
    const spacing = points.length > 1 ? (points[points.length - 1].x - points[0].x) / (points.length - 1) : 1;
    const sigma = Math.max(spacing * 0.9, 16);
    for (let i = 0; i < points.length; i++) {
      const target = px == null ? 0 : SWELL_AMP * Math.exp(-((points[i].x - px) ** 2) / (2 * sigma * sigma));
      const cur  = sw[i] ?? 0;
      const next = cur + (target - cur) * 0.18;
      sw[i] = next;
      if (Math.abs(next - target) > 0.03 || Math.abs(next) > 0.03) swelling = true;
    }
    if (swelling) more = true;

    const linePts  = points.map((p, i) => ({ x: p.x, y: p.y - (sw[i] ?? 0) }));
    const linePath = erodedPath(linePts, dispTrees, EROSION_MAG0);

    // Proximity glow — a soft radius around the pointer/finger where the
    // point field reads slightly brighter, like a scan returning data.
    const dotOpacities = dots.map(d => {
      if (px == null || py == null) return d.base;
      const dist2 = (d.x - px) ** 2 + (d.y - py) ** 2;
      const boost = PROXIMITY_BOOST * Math.exp(-dist2 / (2 * PROXIMITY_SIGMA * PROXIMITY_SIGMA));
      return Math.min(0.4, d.base + boost);
    });

    const waterlineY = lerp(peakY - REVEAL_SLICE, baselineY, faderVal.current);
    const hoverIndex  = px == null || points.length === 0
      ? -1
      : points.reduce((best, p, i) => Math.abs(p.x - px) < Math.abs(points[best].x - px) ? i : best, 0);

    setRender({ linePath, dotOpacities, waterlineY, faderT: faderVal.current, hoverIndex });

    rafId.current = more ? requestAnimationFrame(tick) : null;
  }, [points, dispTrees, dots, baselineY, peakY]);

  const kick = useCallback(() => {
    if (rafId.current == null) rafId.current = requestAnimationFrame(tick);
  }, [tick]);

  // Draw the initial frame as soon as layout is known, without waiting for interaction.
  useEffect(() => {
    if (points.length === 0) return;
    tick();
  }, [points.length, dims.width, dims.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (rafId.current != null) cancelAnimationFrame(rafId.current); }, []);

  // ── fader drag: direct 1:1 while held, inertia + edge resistance on release ──
  const onFaderDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    faderVel.current = 0;
    dragHist.current = [];
    const track = e.currentTarget.getBoundingClientRect();
    const t = clamp((e.clientY - track.top) / track.height, 0, 1);
    faderVal.current = t;
    dragHist.current.push({ v: t, t: performance.now() });
    kick();
  }, [kick]);

  const onFaderMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const track = e.currentTarget.getBoundingClientRect();
    const t = clamp((e.clientY - track.top) / track.height, 0, 1);
    faderVal.current = t;
    dragHist.current.push({ v: t, t: performance.now() });
    if (dragHist.current.length > 12) dragHist.current.shift();
  }, []);

  const onFaderUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragging.current = false;
    const hist   = dragHist.current;
    const now    = performance.now();
    const recent = hist.filter(p => now - p.t < 100);
    if (recent.length >= 2) {
      const first = recent[0], last = recent[recent.length - 1];
      const dt = Math.max(last.t - first.t, 1);
      faderVel.current = (last.v - first.v) / dt * 16;
    }
    kick();
  }, [kick]);

  // ── pointer/touch swell + proximity glow over the terrain itself ──
  // Pointer capture on press keeps tracking a finger that drifts a few px
  // outside the frame mid-scrub, instead of silently losing it to whatever
  // element is now underneath.
  const onFramePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerX.current = clamp(e.clientX - rect.left, 0, rect.width);
    pointerY.current = clamp(e.clientY - rect.top, 0, rect.height);
    kick();
  }, [kick]);

  const onFramePointerLeave = useCallback(() => {
    pointerX.current = null;
    pointerY.current = null;
    kick();
  }, [kick]);

  const onFramePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onFramePointerMove(e);
  }, [onFramePointerMove]);

  const onFramePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    onFramePointerLeave();
  }, [onFramePointerLeave]);

  const hovered = render.hoverIndex >= 0 ? data[render.hoverIndex] : null;

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      <Link
        href="/"
        style={{
          fontSize:       "0.7rem",
          fontWeight:     500,
          letterSpacing:  "0.15em",
          fontVariant:    "small-caps",
          color:          "#0a0a0a",
          textDecoration: "none",
          opacity:        0.5,
        }}
      >
        RETURN
      </Link>

      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        style={{
          fontSize:      "clamp(2rem, 5vw, 3.5rem)",
          fontWeight:    700,
          letterSpacing: "-0.02em",
          color:         "#0a0a0a",
          marginTop:     "2.5rem",
          marginBottom:  "2.5rem",
        }}
      >
        TERRAIN
      </motion.h2>

      <div style={{ display: "flex", alignItems: "stretch", gap: "1.25rem" }}>
        {/* ── the terrain frame — fixed size, never scales; only the waterline moves ── */}
        <div
          ref={frameRef}
          onPointerDown={onFramePointerDown}
          onPointerMove={onFramePointerMove}
          onPointerUp={onFramePointerUp}
          onPointerLeave={onFramePointerLeave}
          onPointerCancel={onFramePointerUp}
          style={{
            flex:      1,
            minWidth:  0,
            height:    "clamp(280px, 46vh, 480px)",
            position:  "relative",
            touchAction: "none",
          }}
        >
          {dims.width > 0 && dims.height > 0 && (
            <svg
              width={dims.width}
              height={dims.height}
              viewBox={`0 0 ${dims.width} ${dims.height}`}
              style={{ display: "block" }}
            >
              {/* the sonar point field — behind the line, static positions,
                  live opacity for the proximity scan */}
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
              >
                {dots.map((d, i) => (
                  <circle
                    key={i}
                    cx={d.x}
                    cy={d.y}
                    r={DOT_R}
                    fill="#0a0a0a"
                    fillOpacity={render.dotOpacities[i] ?? d.base}
                  />
                ))}
              </motion.g>

              {/* the eroded profile — one line, fractal roughness between the
                  19 fixed month positions */}
              <motion.path
                d={render.linePath}
                fill="none"
                stroke="#0a0a0a"
                strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 2, ease: "easeInOut" }}
              />

              {/* the waterline — page-colour cover, not a drawn line, so months
                  vanish beneath it rather than being clipped against a hard
                  edge. Submerges the eroded line and the point field together. */}
              <rect
                x={0}
                y={render.waterlineY}
                width={dims.width}
                height={Math.max(0, dims.height - render.waterlineY)}
                fill={BG}
              />
            </svg>
          )}
        </div>

        {/* ── fader ── */}
        <div
          onPointerDown={onFaderDown}
          onPointerMove={onFaderMove}
          onPointerUp={onFaderUp}
          onPointerCancel={onFaderUp}
          style={{
            width:      FADER_W,
            height:     "clamp(280px, 46vh, 480px)",
            position:   "relative",
            touchAction: "none",
            cursor:     "pointer",
          }}
        >
          <div style={{
            position:  "absolute", left: "50%", top: 0, bottom: 0,
            width:     1, background: "rgba(10,10,10,0.2)",
            transform: "translateX(-50%)",
          }} />
          {DOT_MARKS.map(t => (
            <div key={t} style={{
              position:     "absolute", left: "50%", top: `${t * 100}%`,
              width:        4, height: 4, borderRadius: "50%",
              background:   "rgba(10,10,10,0.25)",
              transform:    "translate(-50%, -50%)",
            }} />
          ))}
          <div style={{
            position:     "absolute", left: "50%", top: `${render.faderT * 100}%`,
            width:        18, height: 3, borderRadius: 1.5,
            background:   "#0a0a0a",
            transform:    "translate(-50%, -50%)",
          }} />
        </div>
      </div>

      {/* ── readout — same grey and style as the /writing date stamps ── */}
      <div style={{
        marginTop:     "1.25rem",
        fontSize:      "0.75rem",
        fontWeight:    400,
        letterSpacing: "0.05em",
        color:         "rgba(10,10,10,0.4)",
        minHeight:     "1.2em",
      }}>
        {hovered
          ? `${formatMonth(hovered.month)} — ${hovered.count} poem${hovered.count === 1 ? "" : "s"}, ${hovered.words.toLocaleString()} words`
          : ""}
      </div>
    </main>
  );
}
