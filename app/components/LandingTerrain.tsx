"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";

// ── The free-scrub terrain — /writing's landing state and BROWSE mode.
// Ported forward from /terrain's pre-Stage-A build (the "fader, hover
// readout" version, replaced there in an earlier pass and now restored
// here): eroded ridgeline, sonar point field, proximity swell/glow, a
// draggable waterline fader with inertia and edge resistance. Unchanged
// from that version except: the MILAT seam (new, shared with the
// PLAY-mode terrain) and optional per-month click targets for BROWSE. ──

export interface TerrainMonth {
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

const TOP_PADDING  = 58;
const REVEAL_SLICE = 10;
const STROKE_W     = 1.75;
const FADER_W      = 30;
const EDGE_ZONE    = 0.12;
const FRICTION     = 0.94;
const SWELL_AMP    = 7;
const DOT_MARKS    = [0.2, 0.4, 0.6, 0.8];
const BG           = "#aaff00";

const EROSION_SEED   = 1337;
const EROSION_LEVELS = 5;
const EROSION_MAG0   = 14;

const DOTS_SEED        = 777;
const NUM_DOTS          = 260;
const DOT_R             = 0.7;
const DOT_OPACITY_MAX   = 0.12;
const DOT_OPACITY_MIN   = 0.02;
const PROXIMITY_SIGMA   = 55;
const PROXIMITY_BOOST   = 0.24;

const DIM_MS = 400;

interface Props {
  months: TerrainMonth[];
  dim?: boolean;                          // recedes visually — BROWSE's list is showing on top
  onMonthClick?: (month: string) => void; // present only in BROWSE mode
}

export default function LandingTerrain({ months, dim = false, onMonthClick }: Props) {
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);

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

  const maxCount = useMemo(() => Math.max(1, ...months.map(d => d.count)), [months]);

  const points = useMemo<Pt[]>(() => {
    const { width, height } = dims;
    if (!width || !height || months.length === 0) return [];
    const innerW      = width - STROKE_W * 4;
    const baseline    = height;
    const pxPerCount  = (height - TOP_PADDING) / maxCount;
    const n = months.length;
    return months.map((d, i) => {
      const x = STROKE_W * 2 + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const y = baseline - d.count * pxPerCount;
      return { x, y, count: d.count, words: d.words, month: d.month };
    });
  }, [months, dims, maxCount]);

  const baselineY = dims.height;
  const peakY     = points.length ? Math.min(...points.map(p => p.y)) : 0;

  const dispTrees = useMemo(
    () => buildSegmentTrees(Math.max(0, points.length - 1), EROSION_SEED, EROSION_LEVELS),
    [points.length],
  );

  const dots = useMemo(() => {
    if (points.length === 0) return [];
    const rand   = mulberry32(DOTS_SEED);
    const spread = clamp(dims.height * 0.2, 30, 90);
    const list: { x: number; y: number; base: number }[] = [];
    for (let i = 0; i < NUM_DOTS; i++) {
      const x = rand() * dims.width;
      const ref = referenceY(points, x);
      const side = rand() < 0.5 ? -1 : 1;
      const offset = side * -Math.log(1 - rand()) * spread * 0.5;
      const y = clamp(ref + offset, 0, dims.height);
      const t = clamp(Math.abs(offset) / spread, 0, 1);
      list.push({ x, y, base: lerp(DOT_OPACITY_MAX, DOT_OPACITY_MIN, t) });
    }
    return list;
  }, [points, dims.width, dims.height]);

  // MILAT seam — same interpolation as the PLAY-mode terrain (lib/tagProvenance's
  // provenanceBoundaryDate, not hardcoded), so both renderings agree on where it
  // falls without duplicating the date itself.
  const milatX = useMemo(() => {
    if (points.length === 0 || months.length === 0) return null;
    const boundary = provenanceBoundaryDate();
    if (!boundary) return null;
    const [by, bm, bd] = boundary.split("-").map(Number);
    if (!by || !bm || !bd) return null;
    const boundaryMonth = `${by}-${String(bm).padStart(2, "0")}`;
    const idx = months.findIndex(m => m.month === boundaryMonth);
    if (idx === -1) return null;
    const thisPt = points[idx];
    if (idx === 0) return thisPt.x;
    const daysInMonth = new Date(by, bm, 0).getDate();
    const frac = clamp((bd - 1) / daysInMonth, 0, 1);
    const prevPt = points[idx - 1];
    return prevPt.x + (thisPt.x - prevPt.x) * frac;
  }, [points, months]);

  const [render, setRender] = useState({
    linePath: "", dotOpacities: [] as number[], waterlineY: 0, faderT: 1, hoverIndex: -1,
  });

  const faderVal = useRef(1);
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

  useEffect(() => {
    if (points.length === 0) return;
    tick();
  }, [points.length, dims.width, dims.height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (rafId.current != null) cancelAnimationFrame(rafId.current); }, []);

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

  const hovered = render.hoverIndex >= 0 ? months[render.hoverIndex] : null;
  const spacing = points.length > 1 ? (points[points.length - 1].x - points[0].x) / (points.length - 1) : 40;

  return (
    <div
      style={{
        opacity:    dim ? 0.22 : 1,
        transition: `opacity ${DIM_MS}ms ${dim ? "ease-in" : "ease-out"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", gap: "1.25rem" }}>
        {/* ── the terrain frame — fixed size, never scales; only the waterline moves ── */}
        <div
          ref={frameRef}
          onPointerDown={dim ? undefined : onFramePointerDown}
          onPointerMove={dim ? undefined : onFramePointerMove}
          onPointerUp={dim ? undefined : onFramePointerUp}
          onPointerLeave={dim ? undefined : onFramePointerLeave}
          onPointerCancel={dim ? undefined : onFramePointerUp}
          style={{
            flex:      1,
            minWidth:  0,
            height:    "clamp(280px, 46vh, 480px)",
            position:  "relative",
            touchAction: "none",
            pointerEvents: dim ? "none" : "auto",
          }}
        >
          {dims.width > 0 && dims.height > 0 && (
            <svg
              width={dims.width}
              height={dims.height}
              viewBox={`0 0 ${dims.width} ${dims.height}`}
              style={{ display: "block" }}
            >
              {/* sonar point field */}
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

              {/* the eroded profile */}
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

              {/* MILAT seam — a literal, unlabeled crossing in the terrain,
                  perforated rather than solid (unlike the ridgeline). Always
                  present, independent of the fader setting. */}
              {milatX != null && (
                <line
                  x1={milatX} y1={0} x2={milatX} y2={dims.height}
                  stroke="#0a0a0a" strokeWidth={1} strokeDasharray="1 7" strokeOpacity={0.4}
                />
              )}

              {/* the waterline — page-colour cover; months vanish beneath it
                  rather than being clipped against a hard edge */}
              <rect
                x={0}
                y={render.waterlineY}
                width={dims.width}
                height={Math.max(0, dims.height - render.waterlineY)}
                fill={BG}
              />

              {/* BROWSE month click targets — only present when onMonthClick is
                  given, and only over the water: a submerged month isn't
                  reachable until the fader raises it. */}
              {onMonthClick && points.map((p, i) => (
                p.y >= render.waterlineY ? null : (
                  <rect
                    key={p.month}
                    x={p.x - spacing / 2}
                    y={0}
                    width={spacing}
                    height={render.waterlineY}
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onClick={() => onMonthClick(p.month)}
                  />
                )
              ))}
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
            pointerEvents: dim ? "none" : "auto",
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

      {/* ── readout ── */}
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
    </div>
  );
}
