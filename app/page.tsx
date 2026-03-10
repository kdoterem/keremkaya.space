"use client";

import { motion, AnimatePresence, animate, useMotionValue } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

interface PostMeta {
  slug:  string;
  title: string;
  date:  string;
  tags:  string[];
}

interface TagLayout {
  tag:        string;
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

const NAV = [
  { label: "WRITING", href: "/writing"  },
  { label: "ANSWERS", href: "/answers"  },
  { label: "ART",     href: "/art"      },
  { label: "FIND ME", href: "/find-me"  },
];

// ── Session cache — survives client-side navigation without re-fetching ────────
let _layoutCache:  TagLayout[]  | null = null;
let _postsCache:   PostMeta[]   | null = null;
let _cacheVw = 0, _cacheVh = 0;

function buildLayout(tags: string[], vw: number, vh: number): TagLayout[] {
  const n = tags.length;
  if (n === 0) return [];

  const isMobile = vw < 500;
  const isTablet = vw < 900;
  const maxTags  = isMobile ? 45 : isTablet ? 70 : n;

  const shuffled = [...tags].sort(() => Math.random() - 0.5).slice(0, maxTags);
  const result: TagLayout[] = [];
  const placed: Array<{ x: number; y: number; hw: number; hh: number }> = [];

  shuffled.forEach((tag, i) => {
    const fontSize  = isMobile
      ? Math.max(8, Math.min(16, 8  + Math.random() * 8))
      : Math.max(9, Math.min(22, 10 + Math.random() * 12));
    const hw        = (fontSize * tag.length * 0.52) / 2;
    const hh        = fontSize * 0.65;
    const marginX   = Math.max(hw + 20, vw * 0.05);
    const marginY   = Math.max(hh + 20, vh * 0.08);
    const gap       = isMobile ? 8 : 12;

    let px = vw / 2, py = vh / 2;
    for (let attempt = 0; attempt < 200; attempt++) {
      const x  = marginX + Math.random() * (vw - marginX * 2);
      const y  = marginY + Math.random() * (vh - marginY * 2);
      const ok = placed.every(
        p => Math.abs(x - p.x) > hw + p.hw + gap ||
             Math.abs(y - p.y) > hh + p.hh + gap
      );
      px = x; py = y;
      if (ok) break;
    }

    placed.push({ x: px, y: py, hw, hh });
    result.push({
      tag,
      x:          px,
      y:          py,
      hw,
      hh,
      fontSize,
      fontWeight: Math.random() > 0.45 ? 700 : 400,
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

      if (nx < l.hw)      { nx = l.hw;      vx =  Math.abs(vx) * 0.75; }
      if (nx > vw - l.hw) { nx = vw - l.hw; vx = -Math.abs(vx) * 0.75; }
      if (ny < l.hh)      { ny = l.hh;      vy =  Math.abs(vy) * 0.75; }
      if (ny > vh - l.hh) { ny = vh - l.hh; vy = -Math.abs(vy) * 0.75; }

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
    ]).then(([tags, allPosts]: [string[], PostMeta[]]) => {
      const layout = buildLayout(tags, vw, vh);
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
        const newLayout = buildLayout(prev.map(l => l.tag), vw, vh);
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
