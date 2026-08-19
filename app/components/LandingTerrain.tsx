"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { provenanceBoundaryDate } from "@/lib/tagProvenance";
import {
  mulberry32,
  buildSegmentTrees,
  MeshLayers,
  SweepOverlay,
  Annotation,
  computeConfidences,
  type Pt as ScanPt,
} from "@/app/components/TerrainScan";

// ── The scan — /writing's landing state and BROWSE mode. A HUD readout, not
// a chart: the ridge is a wireframe mesh under continuous scan (TerrainScan
// handles the mesh + sweep), annotated in place (seam, peak, trough, and —
// on hover — whatever's nearest) rather than captioned below the frame. The
// fader (physics, four reference dots, inertia) is unchanged; only its
// chrome was restyled to the same hairline language as everything else
// here. ──

export interface TerrainMonth {
  month: string; // YYYY-MM
  count: number;
  words: number;
}

interface Pt extends ScanPt {
  count: number;
  words: number;
  month: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonthShort(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[mo - 1].slice(0, 3)} ${y}`;
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

const SWEEP_DURATION_S = 10;
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
    const innerW      = width - 4; // was STROKE_W*4 (~7px) — the mesh's own hairlines don't need that margin
    const baseline    = height;
    const pxPerCount  = (height - TOP_PADDING) / maxCount;
    const n = months.length;
    return months.map((d, i) => {
      const x = 2 + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const y = baseline - d.count * pxPerCount;
      return { x, y, count: d.count, words: d.words, month: d.month };
    });
  }, [months, dims, maxCount]);

  const confidences = useMemo(() => computeConfidences(months.map(m => m.count)), [months]);

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

  // MILAT seam — shared boundary-date lookup with the PLAY-mode terrain, so
  // both agree on where it falls without duplicating the date itself. Now
  // carries a floating label (it didn't before) — a deliberate change from
  // the earlier "no label, just a crossing" spec.
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

  // Persistent annotations — always on, geometrically placed, not collected
  // into a single caption. Peak/trough ignore zero-post gap months (a gap
  // isn't a "low" data point, it's an absence).
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

  const [render, setRender] = useState({
    linePts: [] as Pt[], dotOpacities: [] as number[], waterlineY: 0, faderT: 1, hoverIndex: -1,
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

    const linePts = points.map((p, i) => ({ ...p, y: p.y - (sw[i] ?? 0) }));

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

    setRender({ linePts, dotOpacities, waterlineY, faderT: faderVal.current, hoverIndex });

    rafId.current = more ? requestAnimationFrame(tick) : null;
  }, [points, dots, baselineY, peakY]);

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

  const hoveredIdx = !dim && render.hoverIndex >= 0 ? render.hoverIndex : -1;
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
              style={{ display: "block", overflow: "visible" }}
            >
              {/* sonar point field — detected-but-unresolved ground */}
              <g>
                {dots.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r={DOT_R} fill="#0a0a0a" fillOpacity={render.dotOpacities[i] ?? d.base} />
                ))}
              </g>

              {/* the wireframe mesh — idle brightness, always drawn */}
              {render.linePts.length > 0 && (
                <MeshLayers points={render.linePts} dispTrees={dispTrees} mag0={EROSION_MAG0} confidences={confidences} />
              )}

              {/* the scan sweep — continuous, independent of interaction state */}
              {render.linePts.length > 0 && (
                <SweepOverlay
                  width={dims.width} height={dims.height}
                  points={render.linePts} dispTrees={dispTrees} mag0={EROSION_MAG0} confidences={confidences}
                  durationS={SWEEP_DURATION_S}
                />
              )}

              {/* MILAT seam — a literal crossing, now with a floating label */}
              {milatX != null && (
                <>
                  <line
                    x1={milatX} y1={0} x2={milatX} y2={dims.height}
                    stroke="#0a0a0a" strokeWidth={1} strokeDasharray="1 7" strokeOpacity={0.4}
                  />
                  <Annotation
                    x={milatX} y={dims.height * 0.55}
                    label="MILAT" sublabel={provenanceBoundaryDate() ?? undefined}
                    variant="seam" side={milatX > dims.width / 2 ? "left" : "right"}
                  />
                </>
              )}

              {/* persistent annotations — peak and trough, on screen always */}
              {peakIdx >= 0 && points[peakIdx] && (
                <Annotation
                  x={points[peakIdx].x} y={points[peakIdx].y}
                  label={formatMonthShort(points[peakIdx].month)}
                  sublabel={`${points[peakIdx].count} poems`}
                  variant="data"
                  side={points[peakIdx].x > dims.width / 2 ? "left" : "right"}
                  vSide={points[peakIdx].y < 60 ? "down" : "up"}
                />
              )}
              {troughIdx >= 0 && troughIdx !== peakIdx && points[troughIdx] && (
                <Annotation
                  x={points[troughIdx].x} y={points[troughIdx].y}
                  label={formatMonthShort(points[troughIdx].month)}
                  sublabel={`${points[troughIdx].count} poem${points[troughIdx].count === 1 ? "" : "s"}`}
                  variant="data"
                  side={points[troughIdx].x > dims.width / 2 ? "left" : "right"}
                  vSide={points[troughIdx].y < 60 ? "down" : "up"}
                />
              )}

              {/* transient — nearest point to the cursor, one more annotation among several */}
              {hoveredIdx >= 0 && points[hoveredIdx] && hoveredIdx !== peakIdx && hoveredIdx !== troughIdx && (
                <Annotation
                  x={points[hoveredIdx].x} y={points[hoveredIdx].y}
                  label={formatMonthShort(points[hoveredIdx].month)}
                  sublabel={`${points[hoveredIdx].count} poem${points[hoveredIdx].count === 1 ? "" : "s"}, ${points[hoveredIdx].words.toLocaleString()}w`}
                  variant="transient"
                  side={points[hoveredIdx].x > dims.width / 2 ? "left" : "right"}
                  vSide={points[hoveredIdx].y < 60 ? "down" : "up"}
                />
              )}

              {/* the waterline — page-colour cover; months vanish beneath it
                  rather than being clipped against a hard edge */}
              <rect
                x={0} y={render.waterlineY}
                width={dims.width} height={Math.max(0, dims.height - render.waterlineY)}
                fill={BG}
              />

              {/* BROWSE month click targets — only present when onMonthClick is
                  given, and only over the water: a submerged month isn't
                  reachable until the fader raises it. */}
              {onMonthClick && points.map((p) => (
                p.y >= render.waterlineY ? null : (
                  <rect
                    key={p.month}
                    x={p.x - spacing / 2} y={0}
                    width={spacing} height={render.waterlineY}
                    fill="transparent" style={{ cursor: "pointer" }}
                    onClick={() => onMonthClick(p.month)}
                  />
                )
              ))}
            </svg>
          )}
        </div>

        {/* ── fader — hairline chrome, same mechanic ── */}
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
            width:     1, background: "rgba(10,10,10,0.18)",
            transform: "translateX(-50%)",
          }} />
          {DOT_MARKS.map(t => (
            <div key={t} style={{
              position:     "absolute", left: "50%", top: `${t * 100}%`,
              width:        5, height: 5, borderRadius: "50%",
              border:       "1px solid rgba(10,10,10,0.3)",
              background:   "transparent",
              transform:    "translate(-50%, -50%)",
            }} />
          ))}
          {/* thumb — a hollow bracket, not a filled bar */}
          <div style={{
            position:     "absolute", left: "50%", top: `${render.faderT * 100}%`,
            width:        16, height: 8,
            border:       "1px solid #0a0a0a",
            background:   "transparent",
            transform:    "translate(-50%, -50%)",
            filter:       "drop-shadow(0 0 1.5px rgba(10,10,10,0.35))",
          }} />
        </div>
      </div>
    </div>
  );
}
