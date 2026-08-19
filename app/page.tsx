"use client";

import { motion, AnimatePresence, animate, useMotionValue } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type { TagCount } from "@/lib/posts";
import CryptoScramble from "@/app/components/CryptoScramble";

interface PostMeta {
  slug:  string;
  title: string;
  date:  string;
  tags:  string[];
}

interface TagLayout {
  tag:        string;
  count:      number;
  x:          number;
  y:          number;
  hw:         number;
  hh:         number;
  fontSize:   number;
  fontWeight: number;
  driftX:     number;
  driftY:     number;
  duration:   number;
  driftDelay: number;
  entryDelay: number;
}

// Guaranteed top-N-by-count tags always shown, plus a shuffled sample of the
// remainder filling out the rest of each breakpoint's cap.
const MOBILE_TOP_GUARANTEED  = 30, MOBILE_ROTATING  = 15;  // 45 total
const TABLET_TOP_GUARANTEED  = 35, TABLET_ROTATING  = 35;  // 70 total
const DESKTOP_TOP_GUARANTEED = 40, DESKTOP_ROTATING = 70;  // 110 total

// Keeps tags clear of the fixed nav row (which sits 2rem from the viewport
// bottom, plus its own text height) — shared by initial placement and by
// where a flung tag comes to rest, so neither can land under the nav.
const NAV_CLEARANCE = 110; // px

// ── The core: a permanently-scrambling, fixed, unlabelled centre-point ─────────
// Same glyph pool as /writing's take-me-somewhere effect, same tick rate as
// the kismet cards. Length is fixed and meaningless — it never resolves to a
// target string, so there is none.
//
// Stacked 3-1-1: three near-equal "body" lines (differing by one or two
// characters, so the block reads as a ragged mass rather than a rectangle),
// then two shorter lines tapering to a point. ~35 characters total, split
// across independent CryptoScramble instances — a single instance can't do
// this, since infinite mode overwrites every position on every tick,
// including any embedded newline, so a multi-line shape can't survive
// inside one scrambling string.
const CORE_LINE_LENGTHS = [9, 10, 8, 5, 3];
const CORE_LINES        = CORE_LINE_LENGTHS.map(n => "•".repeat(n)); // content is irrelevant — infinite mode never reveals it
const CORE_CHARS        = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&";
const CORE_RESTITUTION  = 0.28; // vs ~0.7 tag-on-tag — noticeably more resistance, it has mass

// Each line's glyph-tick interval (ms) at rest and at contact (cursor right
// on the block) — same proportional spread across the five at both ends, so
// they stay out of phase with each other the whole way through the ramp.
// ~3 cycles/sec at rest is slow enough to register as individual characters
// rather than a blur; ~3.5x faster at contact.
const CORE_TICK_RESTING = [195, 218, 204, 229, 190];
const CORE_TICK_CONTACT = [55, 61, 57, 64, 53];

// How many of that line's own characters re-roll per tick — the rest hold.
// At rest this is 1 everywhere (barely-there activity, never a full-line
// flicker); at contact it opens up to roughly a third of the line, per line
// length, so approaching makes the block visibly more agitated, not just
// faster. Which positions get chosen is decided inside CryptoScramble
// (neighbour-biased), not here — this only sets how many.
const CORE_CHURN_RESTING = CORE_LINE_LENGTHS.map(() => 1);
const CORE_CHURN_CONTACT = CORE_LINE_LENGTHS.map(n => Math.max(2, Math.round(n * 0.4)));

// The core's own small motion: each line nudges to a new random point every
// time its own glyphs jump — the scramble's "attack" is what moves it, not
// an independent clock. Amplitude ramps on the same proximity curve as the
// tick interval (below), continuously — not a hover on/off switch.
const CORE_VIBRATE_AMP         = 1.4; // px, at rest
const CORE_VIBRATE_AMP_CONTACT = 4.5; // px, at the cursor
// Distance (px, cursor to block centre) beyond which the core is fully at
// rest; interpolated linearly down to 0px (full contact values).
const CORE_PROXIMITY_RADIUS    = 320;
// Scale on hover is separate and discrete — a contact response, not a ramp.
const CORE_HOVER_SCALE         = 1.22;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Shared by buildLayout (keeps tags out) and the fling physics (bounces off
// it) so the exclusion zone is identical in both places.
function coreClearanceFor(vw: number): number {
  const isMobile = vw < 500;
  const isTablet = vw < 900;
  return isMobile ? 150 : isTablet ? 190 : 230;
}

const NAV = [
  { label: "WRITING", href: "/writing"  },
  { label: "KISMET",  href: "/kismet"   },
  { label: "Q&A",     href: "/answers"  },
  { label: "FIND ME", href: "/find-me"  },
];

// ── Session cache — survives client-side navigation without re-fetching ────────
let _layoutCache:  TagLayout[]  | null = null;
let _postsCache:   PostMeta[]   | null = null;
let _cacheVw = 0, _cacheVh = 0;

function buildLayout(tagCounts: TagCount[], vw: number, vh: number): TagLayout[] {
  const n = tagCounts.length;
  if (n === 0) return [];

  const isMobile = vw < 500;
  const isTablet = vw < 900;

  const topGuaranteed = isMobile ? MOBILE_TOP_GUARANTEED  : isTablet ? TABLET_TOP_GUARANTEED  : DESKTOP_TOP_GUARANTEED;
  const rotatingCount  = isMobile ? MOBILE_ROTATING        : isTablet ? TABLET_ROTATING        : DESKTOP_ROTATING;

  // The most-used tags are always present; only the long tail is sampled,
  // so the cloud's shape reflects the archive instead of chance.
  const byCount    = [...tagCounts].sort((a, b) => b.count - a.count);
  const guaranteed = byCount.slice(0, topGuaranteed);
  const remainder  = byCount.slice(topGuaranteed);
  const rotating   = [...remainder].sort(() => Math.random() - 0.5).slice(0, rotatingCount);
  const selected   = [...guaranteed, ...rotating].sort(() => Math.random() - 0.5);

  // Frequency → size, on a sqrt scale so a handful of heavily-used tags
  // don't flatten the rare ones into unreadable noise.
  const allCounts = tagCounts.map(t => t.count);
  const minCount  = Math.min(...allCounts);
  const maxCount  = Math.max(...allCounts);
  const sqrtMin   = Math.sqrt(minCount);
  const sqrtSpan  = Math.sqrt(maxCount) - sqrtMin || 1;

  const FONT_MIN = isMobile ? 8 : 9;
  const FONT_MAX = isMobile ? 16 : 22;

  const result: TagLayout[] = [];
  const placed: Array<{ x: number; y: number; hw: number; hh: number }> = [];

  // No tag's own bounding box may cross into the core's clearance disc —
  // the field reads as thinning toward an empty centre rather than a
  // drawn boundary, since it's the same stochastic first-fit placement
  // as tag-tag spacing, just against one more (fixed, central) obstacle.
  const coreClearance = coreClearanceFor(vw);
  const cx = vw / 2, cy = vh / 2;

  selected.forEach(({ tag, count }, i) => {
    const weight   = (Math.sqrt(count) - sqrtMin) / sqrtSpan;  // 0..1, frequency-normalised
    const fontSize = FONT_MIN + weight * (FONT_MAX - FONT_MIN);
    const hw        = (fontSize * tag.length * 0.52) / 2;
    const hh        = fontSize * 0.65;
    const marginX      = Math.max(hw + 20, vw * 0.05);
    const marginTop    = Math.max(hh + 20, vh * 0.08);
    const marginBottom = Math.max(hh + 20, NAV_CLEARANCE);
    const gap       = isMobile ? 8 : 12;

    let px = vw / 2, py = vh / 2;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x  = marginX + Math.random() * (vw - marginX * 2);
      const y  = marginTop + Math.random() * (vh - marginTop - marginBottom);
      const clearsCore = Math.hypot(x - cx, y - cy) > coreClearance + Math.max(hw, hh);
      const ok = clearsCore && placed.every(
        p => Math.abs(x - p.x) > hw + p.hw + gap ||
             Math.abs(y - p.y) > hh + p.hh + gap
      );
      px = x; py = y;
      if (ok) break;
    }

    placed.push({ x: px, y: py, hw, hh });
    result.push({
      tag,
      count,
      x:          px,
      y:          py,
      hw,
      hh,
      fontSize,
      fontWeight: weight >= 0.5 ? 700 : 400,
      driftX:     (Math.random() - 0.5) * (isMobile ? 8 : 16),
      driftY:     (Math.random() - 0.5) * (isMobile ? 5 : 10),
      duration:   4 + Math.random() * 6,
      driftDelay: -Math.random() * 9,
      entryDelay: i * 0.018,
    });
  });

  return result;
}

// ── Shared position-registry ───────────────────────────────────────────────────
type PosEntry = { x: number; y: number; hw: number; hh: number };
type PosMap   = React.MutableRefObject<Map<string, PosEntry>>;

// ── Per-tag component ──────────────────────────────────────────────────────────
function TagWord({
  l, isFaded, onSelect, onClear, positions,
}: {
  l:         TagLayout;
  isFaded:   boolean;
  onSelect:  () => void;
  onClear:   () => void;
  positions: PosMap;
}) {
  const posX = useMotionValue(l.x);
  const posY = useMotionValue(l.y);

  const [entered,  setEntered]  = useState(false);
  const [dragging, setDragging] = useState(false);

  const wasDragged     = useRef(false);
  const isDraggingRef  = useRef(false);
  const driftXCtrl     = useRef<{ stop(): void } | null>(null);
  const driftYCtrl     = useRef<{ stop(): void } | null>(null);
  const physicsRAF     = useRef<number | null>(null);
  const pointerHistory = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const lastPointerPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), (l.entryDelay + 1) * 1000);
    return () => clearTimeout(t);
  }, [l.entryDelay]);

  useEffect(() => {
    const update = () => {
      positions.current.set(l.tag, { x: posX.get(), y: posY.get(), hw: l.hw, hh: l.hh });
    };
    update();
    const u1 = posX.on("change", update);
    const u2 = posY.on("change", update);
    return () => { u1(); u2(); positions.current.delete(l.tag); };
  }, [l.tag, l.hw, l.hh]);

  const startDrift = useCallback(() => {
    driftXCtrl.current?.stop();
    driftYCtrl.current?.stop();
    const bx = posX.get(), by = posY.get();
    driftXCtrl.current = animate(posX, [bx, bx + l.driftX, bx], {
      duration: l.duration, repeat: Infinity, repeatType: "mirror", ease: "easeInOut",
    });
    driftYCtrl.current = animate(posY, [by, by + l.driftY, by], {
      duration: l.duration * 0.78, repeat: Infinity, repeatType: "mirror",
      ease: "easeInOut", delay: 2,
    });
  }, [posX, posY, l.driftX, l.driftY, l.duration]);

  const stopAll = useCallback(() => {
    driftXCtrl.current?.stop();
    driftYCtrl.current?.stop();
    if (physicsRAF.current !== null) {
      cancelAnimationFrame(physicsRAF.current);
      physicsRAF.current = null;
    }
  }, []);

  const startDriftRef = useRef(startDrift); startDriftRef.current = startDrift;
  const stopAllRef    = useRef(stopAll);    stopAllRef.current    = stopAll;

  useEffect(() => {
    if (!entered) return;
    startDrift();
    return () => stopAll();
  }, [entered]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPhysics = useCallback((initVx: number, initVy: number) => {
    stopAllRef.current();
    let vx = initVx, vy = initVy;

    function step() {
      vx *= 0.97; vy *= 0.97;
      const vw = window.innerWidth, vh = window.innerHeight;
      const cx = posX.get(), cy = posY.get();
      let nx = cx + vx, ny = cy + vy;

      // Bottom bound mirrors buildLayout's marginBottom exactly, so a flung
      // tag settles above the nav row instead of bouncing off the raw edge.
      const bottomBound = vh - Math.max(l.hh + 20, NAV_CLEARANCE);

      if (nx < l.hw)         { nx = l.hw;         vx =  Math.abs(vx) * 0.75; }
      if (nx > vw - l.hw)    { nx = vw - l.hw;     vx = -Math.abs(vx) * 0.75; }
      if (ny < l.hh)         { ny = l.hh;          vy =  Math.abs(vy) * 0.75; }
      if (ny > bottomBound)  { ny = bottomBound;   vy = -Math.abs(vy) * 0.75; }

      // The core has mass and never moves — a flung tag hitting it loses far
      // more energy than a tag-tag collision (CORE_RESTITUTION vs ~0.7), and
      // its position is corrected the same frame so it never visibly overlaps.
      const coreBound = coreClearanceFor(vw) + Math.max(l.hw, l.hh);
      const dcx = nx - vw / 2, dcy = ny - vh / 2;
      const distCore = Math.hypot(dcx, dcy) || 1;
      if (distCore < coreBound) {
        const ux = dcx / distCore, uy = dcy / distCore;
        nx = vw / 2 + ux * coreBound;
        ny = vh / 2 + uy * coreBound;
        const vn = vx * ux + vy * uy;
        if (vn < 0) {
          vx -= (1 + CORE_RESTITUTION) * vn * ux;
          vy -= (1 + CORE_RESTITUTION) * vn * uy;
        }
      }

      posX.set(nx); posY.set(ny);

      positions.current.forEach((other, otherTag) => {
        if (otherTag === l.tag) return;
        const ddx = nx - other.x, ddy = ny - other.y;
        const ovX = l.hw + other.hw - Math.abs(ddx);
        const ovY = l.hh + other.hh - Math.abs(ddy);
        if (ovX > 0 && ovY > 0) {
          if (ovX <= ovY) vx = Math.abs(vx) * Math.sign(ddx || 1) * 0.7;
          else            vy = Math.abs(vy) * Math.sign(ddy || 1) * 0.7;
        }
      });

      if (Math.sqrt(vx * vx + vy * vy) < 0.2) {
        physicsRAF.current = null;
        startDriftRef.current();
        return;
      }
      physicsRAF.current = requestAnimationFrame(step);
    }
    physicsRAF.current = requestAnimationFrame(step);
  }, [l.hw, l.hh, l.tag, posX, posY]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    stopAllRef.current();
    setDragging(true);
    isDraggingRef.current  = false;
    wasDragged.current     = false;
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
    pointerHistory.current = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    isDraggingRef.current = true;
    wasDragged.current    = true;
    const last = lastPointerPos.current;
    const dx   = last ? e.clientX - last.x : 0;
    const dy   = last ? e.clientY - last.y : 0;
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
    const vw = window.innerWidth, vh = window.innerHeight;
    posX.set(Math.max(l.hw, Math.min(vw - l.hw, posX.get() + dx)));
    posY.set(Math.max(l.hh, Math.min(vh - l.hh, posY.get() + dy)));
    const h = pointerHistory.current;
    h.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (h.length > 20) h.splice(0, h.length - 20);
  }, [l.hw, l.hh, posX, posY]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    if (!isDraggingRef.current) { startDriftRef.current(); return; }
    const h      = pointerHistory.current;
    const recent = h.filter(p => e.timeStamp - p.t < 100);
    let vx = 0, vy = 0;
    if (recent.length >= 2) {
      const first = recent[0], last = recent[recent.length - 1];
      const dt    = Math.max(last.t - first.t, 1);
      vx = (last.x - first.x) / dt * 16;
      vy = (last.y - first.y) / dt * 16;
    }
    Math.sqrt(vx * vx + vy * vy) < 0.5
      ? startDriftRef.current()
      : startPhysics(vx, vy);
  }, [startPhysics]);

  return (
    <motion.button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => {
        e.stopPropagation();
        if (wasDragged.current) return;
        isFaded ? onClear() : onSelect();
      }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: isFaded ? 0.1 : 1, scale: 1 }}
      transition={{
        opacity: { duration: 0.4, delay: entered ? 0 : l.entryDelay },
        scale:   { type: "spring", stiffness: 260, damping: 8, delay: entered ? 0 : l.entryDelay },
      }}
      whileHover={{ scale: 1.22, transition: { duration: 0.12 } }}
      whileTap={{ scale: 0.92 }}
      style={{
        position:      "absolute",
        left:          posX as unknown as number,
        top:           posY as unknown as number,
        x:             "-50%",
        y:             "-50%",
        background:    "none",
        border:        "none",
        // Tags: slightly muted so they read as content, distinct from the nav
        color:         "rgba(10,10,10,0.72)",
        cursor:        dragging ? "grabbing" : "grab",
        padding:       0,
        fontFamily:    '"Helvetica Neue", Helvetica, Arial, sans-serif',
        fontSize:      l.fontSize,
        fontWeight:    l.fontWeight,
        letterSpacing: "0.01em",
        whiteSpace:    "nowrap",
        lineHeight:    1,
        touchAction:   "none",
        zIndex:        dragging ? 1000 : 1,
        userSelect:    "none",
      }}
    >
      {l.tag}
    </motion.button>
  );
}

// One line of the core — its own CryptoScramble instance (so its tick timing
// is naturally independent of the other four), nudged to a new small random
// point every time its own glyphs actually jump. proximityRef is shared
// across all five lines (0 = cursor beyond CORE_PROXIMITY_RADIUS, 1 = right
// on the block) so approaching the core anywhere speeds all five up,
// widens their vibration, and opens up how many characters change per
// tick — together, continuously, not a per-line or on/off state. tickMsRef
// / churnCountRef are what actually carry those live values into
// CryptoScramble; recomputing them here each tick (rather than every
// frame) is enough — even the slowest resting tick is ~200ms, so it still
// tracks the cursor smoothly.
function CoreLine({
  text, restTick, contactTick, restChurn, contactChurn, proximityRef,
}: {
  text:         string;
  restTick:     number;
  contactTick:  number;
  restChurn:    number;
  contactChurn: number;
  proximityRef: React.MutableRefObject<number>;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const tickMsRef    = useRef(restTick);
  const churnCountRef = useRef(restChurn);

  const onTick = useCallback(() => {
    const t = proximityRef.current;
    const nextTick = lerp(restTick, contactTick, t);
    const amp      = lerp(CORE_VIBRATE_AMP, CORE_VIBRATE_AMP_CONTACT, t);
    tickMsRef.current    = nextTick;
    churnCountRef.current = lerp(restChurn, contactChurn, t);
    animate(x, (Math.random() - 0.5) * amp, { duration: nextTick / 1000, ease: "easeOut" });
    animate(y, (Math.random() - 0.5) * amp, { duration: nextTick / 1000, ease: "easeOut" });
  }, [x, y, restTick, contactTick, restChurn, contactChurn, proximityRef]);

  return (
    <motion.span style={{ display: "block", x, y }}>
      <CryptoScramble
        text={text}
        tickMs={restTick}
        tickMsRef={tickMsRef}
        churnCount={restChurn}
        churnCountRef={churnCountRef}
        chars={CORE_CHARS}
        infinite
        onTick={onTick}
        style={{
          display:       "block",
          fontFamily:    '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize:      "clamp(0.95rem, 2.3vw, 1.4rem)",
          fontWeight:    800,
          color:         "#0a0a0a",
          letterSpacing: "-0.02em",
          textAlign:     "center",
          // Well below normal (this site's prose runs 1.6-1.8) — the five
          // lines sit close enough to read as one dense body, not a stack
          // of separate strings.
          lineHeight:    0.82,
        }}
      />
    </motion.span>
  );
}

// ── The core — fixed, unlabelled, permanently scrambling. Not a TagWord: no
// drag, no fling, no fade when a tag panel is open, no label or tooltip.
// It does move, in the sense that each line nudges itself on its own
// scramble ticks (CoreLine, above) — the field's one exception to "no
// ambient motion," since the motion isn't decorative drift, it's the same
// jump the text itself is already doing. It reacts to approach, not arrival
// — speed and vibration ramp continuously with cursor distance, so the
// acceleration is what draws you in rather than a reward for reaching it.
// Scale-on-hover is a separate, discrete contact response. Nothing else
// marks it as clickable. ──
function ScrambleCore() {
  const proximityRef = useRef(0);
  const [hover, setHover] = useState(false);

  // Global, not scoped to the element — the core should start responding
  // before the cursor is anywhere near its own (small) hit area.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - window.innerWidth / 2;
      const dy = e.clientY - window.innerHeight / 2;
      const dist = Math.hypot(dx, dy);
      proximityRef.current = 1 - Math.min(dist, CORE_PROXIMITY_RADIUS) / CORE_PROXIMITY_RADIUS;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <Link
      href="/writing"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position:       "absolute",
        left:           "50%",
        top:            "50%",
        textDecoration: "none",
        cursor:         "pointer",
        userSelect:     "none",
        zIndex:         2,
      }}
    >
      <motion.div
        animate={{ scale: hover ? CORE_HOVER_SCALE : 1 }}
        transition={{ duration: 0.12 }}
        style={{
          x: "-50%",
          y: "-50%",
          // Shrink-wraps to the widest ("body") line, so every shorter line
          // below centres symmetrically within that same width — that's what
          // makes the taper read as pointed rather than lopsided.
          display:   "inline-block",
          textAlign: "center",
        }}
      >
        {CORE_LINES.map((line, i) => (
          <CoreLine
            key={i}
            text={line}
            restTick={CORE_TICK_RESTING[i]}
            contactTick={CORE_TICK_CONTACT[i]}
            restChurn={CORE_CHURN_RESTING[i]}
            contactChurn={CORE_CHURN_CONTACT[i]}
            proximityRef={proximityRef}
          />
        ))}
      </motion.div>
    </Link>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Home() {
  const [layout,      setLayout]      = useState<TagLayout[]>([]);
  const [posts,       setPosts]       = useState<PostMeta[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [matching,    setMatching]    = useState<PostMeta[]>([]);
  const [viewH,       setViewH]       = useState("100vh");

  const positions = useRef<Map<string, PosEntry>>(new Map());

  useEffect(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const dimsMatch =
      Math.abs(_cacheVw - vw) < 50 && Math.abs(_cacheVh - vh) < 50;

    // Use cached data when returning from another page — no flicker, no re-randomise
    if (_layoutCache && _postsCache && dimsMatch) {
      setLayout(_layoutCache);
      setPosts(_postsCache);
      const preselect = new URLSearchParams(window.location.search).get("tag");
      if (preselect) {
        setSelectedTag(preselect);
        setMatching(_postsCache.filter((p: PostMeta) => p.tags.includes(preselect)));
      }
      return;
    }

    Promise.all([
      fetch("/api/tags").then(r  => r.json()),
      fetch("/api/posts").then(r => r.json()),
    ]).then(([tagCounts, allPosts]: [TagCount[], PostMeta[]]) => {
      const layout = buildLayout(tagCounts, vw, vh);
      _layoutCache = layout;
      _postsCache  = allPosts;
      _cacheVw     = vw;
      _cacheVh     = vh;
      setPosts(allPosts);
      setLayout(layout);

      // Auto-select tag when arriving from a reader page link (?tag=...)
      const preselect = new URLSearchParams(window.location.search).get("tag");
      if (preselect) {
        setSelectedTag(preselect);
        setMatching(allPosts.filter((p: PostMeta) => p.tags.includes(preselect)));
      }
    });
  }, []);

  useEffect(() => {
    const onResize = () => {
      setViewH(`${window.innerHeight}px`);
      setLayout(prev => {
        if (!prev.length) return prev;
        const vw = window.innerWidth, vh = window.innerHeight;
        const newLayout = buildLayout(prev.map(l => ({ tag: l.tag, count: l.count })), vw, vh);
        _layoutCache = newLayout;
        _cacheVw = vw; _cacheVh = vh;
        return newLayout;
      });
    };
    setViewH(`${window.innerHeight}px`);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const selectTag = useCallback((tag: string) => {
    setSelectedTag(tag);
    setMatching((_postsCache ?? posts).filter(p => p.tags.includes(tag)));
  }, [posts]);

  const clearTag = useCallback(() => {
    setSelectedTag(null);
    setMatching([]);
  }, []);

  return (
    <main
      onClick={clearTag}
      style={{
        width:             "100vw",
        height:            viewH,
        position:          "relative",
        overflow:          "hidden",
        userSelect:        "none",
        overscrollBehavior: "none",
      }}
    >
      {/* ── word cloud ── */}
      {layout.map((l) => (
        <TagWord
          key={l.tag}
          l={l}
          isFaded={selectedTag !== null && l.tag !== selectedTag}
          onSelect={() => selectTag(l.tag)}
          onClear={clearTag}
          positions={positions}
        />
      ))}

      {/* ── the core ── */}
      <ScrambleCore />

      {/* ── posts panel ── */}
      <AnimatePresence>
        {selectedTag && (
          <motion.div
            key="panel"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            style={{
              position:   "fixed",
              bottom:     0,
              left:       0,
              right:      0,
              maxHeight:  "58vh",
              overflowY:  "auto",
              background: "#0a0a0a",
              padding:    "1.8rem 5vw calc(1.8rem + env(safe-area-inset-bottom))",
              zIndex:     100,
            }}
          >
            <div style={{
              display: "flex", alignItems: "baseline",
              justifyContent: "space-between", marginBottom: "1.4rem",
            }}>
              <span style={{
                fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                fontSize: "clamp(1rem, 3vw, 1.4rem)", fontWeight: 700,
                color: "#aaff00", letterSpacing: "-0.01em",
              }}>
                {selectedTag}
              </span>
              <button
                onClick={clearTag}
                style={{
                  background: "none", border: "none",
                  color: "rgba(255,255,255,0.35)", fontSize: "0.7rem",
                  letterSpacing: "0.12em",
                  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                  cursor: "pointer",
                }}
              >
                CLOSE ×
              </button>
            </div>

            {matching.length === 0 ? (
              <p style={{
                color: "rgba(255,255,255,0.3)", fontSize: "0.85rem",
                fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              }}>
                no posts tagged &quot;{selectedTag}&quot;
              </p>
            ) : matching.map((post) => (
              <Link
                key={post.slug}
                href={`/writing/${post.slug}`}
                style={{
                  display: "flex", alignItems: "baseline",
                  justifyContent: "space-between",
                  padding: "0.75rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  textDecoration: "none", transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.5")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                <span style={{
                  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                  fontSize: "clamp(0.88rem, 2vw, 1.05rem)",
                  fontWeight: 500, color: "#fff", letterSpacing: "-0.01em",
                }}>
                  {post.title}
                </span>
                <span style={{
                  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                  fontSize: "0.68rem", color: "rgba(255,255,255,0.3)",
                  letterSpacing: "0.05em", flexShrink: 0, marginLeft: "2rem",
                }}>
                  {post.date}
                </span>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── nav — always visible, visually distinct from tags ── */}
      <nav
        style={{
          position:       "absolute",
          bottom:         "calc(2rem + env(safe-area-inset-bottom))",
          left:           0,
          right:          0,
          display:        "flex",
          justifyContent: "center",
          gap:            "clamp(1.2rem, 4vw, 2.5rem)",
          zIndex:         10,
        }}
      >
        {NAV.map(({ label, href }) => (
          <Link key={href} href={href}
            style={{
              fontSize:       "0.72rem",
              fontWeight:     500,
              fontVariant:    "small-caps",
              letterSpacing:  "0.18em",
              // Nav: clearly muted — reads as UI chrome, not content
              color:          "rgba(10,10,10,0.3)",
              textDecoration: "none",
              fontFamily:     '"Helvetica Neue", Helvetica, Arial, sans-serif',
              transition:     "color 0.2s",
            }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "rgba(10,10,10,0.8)")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "rgba(10,10,10,0.3)")}
          >
            {label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
