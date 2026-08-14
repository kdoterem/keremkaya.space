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
  y: number;      // resting position — jitter baked in, no swell, no fader
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

// Deterministic PRNG — the hand-drawn jitter is fixed per point, not re-rolled
// on every render, so the line doesn't crawl.
function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Catmull-Rom through the points, converted to cubic beziers — a continuous
// curved line rather than straight segments snapped between data points.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp  = (a: number, b: number, t: number) => a + (b - a) * t;

const TOP_PADDING  = 44;   // headroom above the tallest peak for swell + jitter + the reveal sliver
const REVEAL_SLICE = 10;   // px of the tallest peak still visible at the most-submerged setting
const STROKE_W     = 1.75;
const FADER_W      = 30;
const EDGE_ZONE    = 0.12; // fraction of travel, near each end, where the fader gains resistance
const FRICTION     = 0.94;
const SWELL_AMP    = 7;    // px the line rises at the point nearest the cursor/finger
const DOT_MARKS    = [0.2, 0.4, 0.6, 0.8];
const BG           = "#aaff00";

// The single profile is redrawn NUM_CONTOURS times, each copy offset a little
// further down and to the right — a depth-sounding / ridged-surface read
// instead of one plotted line. All copies share the same geometry (same
// smoothPath output, just translated), so the swell/jitter/fader math never
// has to know the stack exists.
const NUM_CONTOURS   = 14;
const STACK_DX       = 2.4;    // px sideways per layer, receding
const STACK_DY       = 3.1;    // px downward per layer, receding
const SKEW_DEG       = 2;      // gentle — a hint of recession, not a video-game tilt
const FRONT_OPACITY  = 0.6;    // stroke opacity of the nearest (readable) contour
const REAR_OPACITY   = 0.08;   // stroke opacity of the furthest contour

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

  // Static layout: each point's resting position, with a small fixed jitter
  // baked in so the drawn line reads as hand-placed rather than plotted.
  const points = useMemo<Pt[]>(() => {
    const { width, height } = dims;
    if (!width || !height || data.length === 0) return [];
    const rand      = mulberry32(42);
    const innerW    = width - STROKE_W * 4;
    const baseline  = height;
    const pxPerCount = (height - TOP_PADDING) / maxCount;
    const n = data.length;
    return data.map((d, i) => {
      const jx = (rand() - 0.5) * 3;
      const jy = (rand() - 0.5) * 3;
      const x  = STROKE_W * 2 + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW) + jx;
      const y  = baseline - d.count * pxPerCount + jy;
      return { x, y, count: d.count, words: d.words, month: d.month };
    });
  }, [data, dims, maxCount]);

  const baselineY = dims.height;
  const peakY     = points.length ? Math.min(...points.map(p => p.y)) : 0;

  // ── live render state — path strings, waterline, thumb + readout, all driven
  // by one rAF loop so fader inertia and pointer swell stay in lockstep ──
  const [render, setRender] = useState({
    linePath: "", fillPath: "", waterlineY: 0, faderT: 1, hoverIndex: -1,
  });

  const faderVal = useRef(1);   // 0 = up/submerged, 1 = down/full visibility
  const faderVel = useRef(0);
  const dragging = useRef(false);
  const swell    = useRef<number[]>([]);
  const pointerX = useRef<number | null>(null);
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

    const linePts   = points.map((p, i) => ({ x: p.x, y: p.y - (sw[i] ?? 0) }));
    const linePath  = smoothPath(linePts);
    const fillPath  = linePts.length
      ? `${linePath} L ${linePts[linePts.length - 1].x.toFixed(2)},${baselineY} L ${linePts[0].x.toFixed(2)},${baselineY} Z`
      : "";
    const waterlineY = lerp(peakY - REVEAL_SLICE, baselineY, faderVal.current);
    const hoverIndex  = px == null || points.length === 0
      ? -1
      : points.reduce((best, p, i) => Math.abs(p.x - px) < Math.abs(points[best].x - px) ? i : best, 0);

    setRender({ linePath, fillPath, waterlineY, faderT: faderVal.current, hoverIndex });

    rafId.current = more ? requestAnimationFrame(tick) : null;
  }, [points, baselineY, peakY]);

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

  // ── pointer/touch swell over the terrain itself ──
  // Pointer capture on press keeps the swell tracking a finger that drifts a
  // few px outside the frame mid-scrub, instead of silently losing it to
  // whatever element is now underneath.
  const onFramePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerX.current = clamp(e.clientX - rect.left, 0, rect.width);
    kick();
  }, [kick]);

  const onFramePointerLeave = useCallback(() => {
    pointerX.current = null;
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
              {/* the ridge stack — one skewed group holding every contour, so the
                  whole surface recedes together; the waterline (outside this
                  group, below) stays flat and submerges it as one piece */}
              <g transform={`translate(${dims.width / 2} 0) skewY(${SKEW_DEG}) translate(${-dims.width / 2} 0)`}>
                {Array.from({ length: NUM_CONTOURS }, (_, rev) => NUM_CONTOURS - 1 - rev).map((i) => {
                  const strokeOpacity = NUM_CONTOURS > 1
                    ? lerp(FRONT_OPACITY, REAR_OPACITY, i / (NUM_CONTOURS - 1))
                    : FRONT_OPACITY;
                  return (
                    <g key={i} transform={`translate(${i * STACK_DX} ${i * STACK_DY})`}>
                      {/* occlusion fill — solid page colour, drawn beneath this
                          contour's own stroke, hiding whatever sits behind it so
                          the stack reads as an occluding surface, not a tangle */}
                      <path d={render.fillPath} fill={BG} stroke="none" />
                      <motion.path
                        d={render.linePath}
                        fill="none"
                        stroke="#0a0a0a"
                        strokeOpacity={strokeOpacity}
                        strokeWidth={STROKE_W}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 2, ease: "easeInOut" }}
                      />
                    </g>
                  );
                })}
              </g>
              {/* the waterline — page-colour cover, not a drawn line, so months
                  vanish beneath it rather than being clipped against a hard edge.
                  Unskewed and drawn last, so it submerges the whole stack as one
                  flat cut rather than following the stack's own recession. */}
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
