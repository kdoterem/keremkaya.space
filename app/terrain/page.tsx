"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CryptoScramble from "@/app/components/CryptoScramble";

// ── The range: a reader traverses backward through time, present → Feb 2025,
// one poem per position. No progress bar, no counter — the terrain itself
// (behind: resolved; ahead: sonar dots; just-ahead: a haze) is the only
// indicator. Stage A only: the loop core (view → READ → poem → PROCEED/PUSS
// OUT → view, advanced). Stages B (spawn), C (depth/composition), and D
// (banishment) are not built here. ──

interface TerrainMonth {
  month: string; // YYYY-MM
  count: number;
  words: number;
}

interface SearchDoc {
  slug:  string;
  title: string;
  date:  string;
  tags:  string[];
  body:  string;
}

interface Pt {
  x: number;
  y: number;
}

// ── Erosion: recursive midpoint displacement (unchanged from the prior pass) ──
// Fixed seeded fractions, precomputed once — reapplying them never draws
// another random number, so the roughness pattern never changes.
interface DispNode {
  frac:  number;
  left:  DispNode | null;
  right: DispNode | null;
}

function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDispTree(rand: () => number, levels: number): DispNode | null {
  if (levels <= 0) return null;
  return {
    frac:  (rand() - 0.5) * 2,
    left:  buildDispTree(rand, levels - 1),
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
  p1: Pt, p2: Pt, node: DispNode | null, mag: number, out: Pt[],
) {
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

function erodedPath(pts: Pt[], trees: (DispNode | null)[], mag0: number): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) applyDisplacement(pts[i], pts[i + 1], trees[i] ?? null, mag0, out);
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

// ── Layout / erosion / point-field constants (same values as the previous pass) ──
const TOP_PADDING = 40;
const STROKE_W    = 1.75;

const EROSION_SEED   = 1337;
const EROSION_LEVELS = 5;
const EROSION_MAG0   = 14;

const DOTS_SEED      = 777;
const NUM_DOTS       = 260;
const DOT_R          = 0.7;
const DOT_OPACITY_MAX = 0.12;
const DOT_OPACITY_MIN = 0.02;

const HAZE_OPACITY = 0.45; // ceiling opacity of the partially-resolved band

// ── Reading mechanics ──
const MONO = '"SF Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace';
const PROSE = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const POS_KEY   = "range:position";
const READ_KEY  = "range:read";
const NOTES_KEY = "range:notes";
const LOG_KEY   = "range:log";

const WEB3FORMS_ENDPOINT   = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY = "1bf57100-9d1e-4357-9747-7155c3a32255";

// Same treatment as the kismet cards — identical tick rate and resolve feel.
const SCRAMBLE_MS  = 1100;
const TICK_MS      = 75;
const STAGGER_MS    = 500; // title → date → body
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&";
const TOTAL_REVEAL_MS = STAGGER_MS * 2 + SCRAMBLE_MS + 200;

type Phase = "view" | "poem";
type SendState = "idle" | "sending" | "sent" | "error";
interface NoteEntry { text: string; sent: boolean }

function loadPosition(max: number): number {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw != null) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return clamp(n, 0, max);
    }
  } catch { /* ignore */ }
  return max; // default: the most recent month
}
function savePosition(n: number) { try { localStorage.setItem(POS_KEY, String(n)); } catch { /* ignore */ } }

function loadReadSet(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}
function saveReadSet(s: Set<string>) { try { localStorage.setItem(READ_KEY, JSON.stringify([...s])); } catch { /* ignore */ } }

function loadNotes(): Record<string, NoteEntry> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}
function saveNotes(n: Record<string, NoteEntry>) { try { localStorage.setItem(NOTES_KEY, JSON.stringify(n)); } catch { /* ignore */ } }

// Stage A stub — Stage D specifies the real banishment mechanism.
function logPussOut(entry: { slug: string; position: number; at: number }) {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    const log = raw ? JSON.parse(raw) : [];
    log.push(entry);
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch { /* ignore */ }
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// ── Mechanical button — hard edges, monospace caps, instant (not eased) invert ──
function MechButton({
  label, onClick, disabled,
}: { label: string; onClick: () => void; disabled?: boolean }) {
  const [hover, setHover] = useState(false);
  const active = hover && !disabled;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily:     MONO,
        fontSize:       "0.75rem",
        fontWeight:     600,
        letterSpacing:  "0.14em",
        textTransform:  "uppercase",
        border:         "1px solid #0a0a0a",
        borderRadius:   0,
        background:     active ? "#0a0a0a" : "transparent",
        color:          active ? "#aaff00" : "#0a0a0a",
        padding:        "0.7rem 1.5rem",
        cursor:         disabled ? "default" : "pointer",
        opacity:        disabled ? 0.35 : 1,
        minWidth:       "9rem",
      }}
    >
      {label}
    </button>
  );
}

export default function TerrainPage() {
  const [months,       setMonths]       = useState<TerrainMonth[]>([]);
  const [postsByMonth, setPostsByMonth] = useState<Map<string, SearchDoc[]>>(new Map());
  const [position,     setPosition]     = useState<number | null>(null);
  const [readSet,       setReadSet]     = useState<Set<string>>(new Set());
  const [notesMap,      setNotesMap]    = useState<Record<string, NoteEntry>>({});

  const [phase,       setPhase]       = useState<Phase>("view");
  const [currentPoem, setCurrentPoem] = useState<SearchDoc | null>(null);
  const [revealStage, setRevealStage] = useState(0); // 0=none, 1=title, 2=+date, 3=+body
  const [showButtons, setShowButtons] = useState(false);
  const [note,        setNote]        = useState("");
  const [sendState,   setSendState]   = useState<SendState>("idle");

  const [dims, setDims] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const noteRef  = useRef<HTMLTextAreaElement>(null);
  const initedPos = useRef(false);
  const revealTimeouts = useRef<number[]>([]);

  useEffect(() => {
    fetch("/api/terrain").then(r => r.json()).then((m: TerrainMonth[]) => setMonths(m));
  }, []);

  useEffect(() => {
    fetch("/api/search-index").then(r => r.json()).then((docs: SearchDoc[]) => {
      const map = new Map<string, SearchDoc[]>();
      for (const d of docs) {
        const key = d.date.slice(0, 7);
        if (!key) continue;
        const arr = map.get(key) ?? [];
        arr.push(d);
        map.set(key, arr);
      }
      for (const arr of map.values()) arr.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
      setPostsByMonth(map);
    });
  }, []);

  // Position, read-set, and notes are restored once — the moment the month
  // list is known (needed to clamp a stored position to a valid index).
  useEffect(() => {
    if (initedPos.current || months.length === 0) return;
    initedPos.current = true;
    setPosition(loadPosition(months.length - 1));
    setReadSet(loadReadSet());
    setNotesMap(loadNotes());
  }, [months.length]);

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

  useEffect(() => { if (noteRef.current) autoGrow(noteRef.current); }, [note]);

  // Title → date → body, staggered — a CryptoScramble instance doesn't mount
  // (and so doesn't start resolving) until its stage arrives, same as
  // kismet's three-card reveal.
  useEffect(() => {
    revealTimeouts.current.forEach(clearTimeout);
    if (!currentPoem) { setRevealStage(0); return; }
    setRevealStage(0);
    revealTimeouts.current = [0, 1, 2].map(i =>
      window.setTimeout(() => setRevealStage(s => Math.max(s, i + 1)), i * STAGGER_MS)
    );
    return () => { revealTimeouts.current.forEach(clearTimeout); revealTimeouts.current = []; };
  }, [currentPoem]);

  const maxCount = useMemo(() => Math.max(1, ...months.map(m => m.count)), [months]);

  // Static layout — the 19 month positions, exact, unchanged by anything
  // that follows.
  const points = useMemo<Pt[]>(() => {
    const { width, height } = dims;
    if (!width || !height || months.length === 0) return [];
    const innerW     = width - STROKE_W * 4;
    const baseline   = height;
    const pxPerCount = (height - TOP_PADDING) / maxCount;
    const n = months.length;
    return months.map((m, i) => ({
      x: STROKE_W * 2 + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
      y: baseline - m.count * pxPerCount,
    }));
  }, [months, dims, maxCount]);

  const dispTrees = useMemo(
    () => buildSegmentTrees(Math.max(0, points.length - 1), EROSION_SEED, EROSION_LEVELS),
    [points.length],
  );
  const linePath = useMemo(() => erodedPath(points, dispTrees, EROSION_MAG0), [points, dispTrees]);

  const dots = useMemo(() => {
    if (points.length === 0) return [];
    const rand   = mulberry32(DOTS_SEED);
    const spread = clamp(dims.height * 0.2, 30, 90);
    const list: { x: number; y: number; base: number }[] = [];
    for (let i = 0; i < NUM_DOTS; i++) {
      const x   = rand() * dims.width;
      const ref = referenceY(points, x);
      const side   = rand() < 0.5 ? -1 : 1;
      const offset = side * -Math.log(1 - rand()) * spread * 0.5;
      const y = clamp(ref + offset, 0, dims.height);
      const t = clamp(Math.abs(offset) / spread, 0, 1);
      list.push({ x, y, base: lerp(DOT_OPACITY_MAX, DOT_OPACITY_MIN, t) });
    }
    return list;
  }, [points, dims.width, dims.height]);

  const spacing   = points.length > 1 ? (points[points.length - 1].x - points[0].x) / (points.length - 1) : 40;
  const hazeWidth = spacing * 0.9;

  const resolveX = position != null && points[position] ? points[position].x : 0;
  const resolveY = position != null && points[position] ? points[position].y : 0;

  const ready = months.length > 0 && postsByMonth.size > 0 && position != null;

  const currentMonth      = position != null ? months[position]?.month : undefined;
  const currentMonthPosts = currentMonth ? (postsByMonth.get(currentMonth) ?? []) : [];
  const hasUnread          = currentMonthPosts.some(p => !readSet.has(p.slug));

  const handleRead = useCallback(() => {
    if (position == null) return;
    const next = currentMonthPosts.find(p => !readSet.has(p.slug));
    if (!next) return;
    setCurrentPoem(next);
    setNote(notesMap[next.slug]?.text ?? "");
    setSendState(notesMap[next.slug]?.sent ? "sent" : "idle");
    setShowButtons(false);
    setPhase("poem");
    window.setTimeout(() => setShowButtons(true), TOTAL_REVEAL_MS);
  }, [position, currentMonthPosts, readSet, notesMap]);

  // Advancing the position is the core action here; marking a poem read only
  // applies when there is one — the "nothing left here" fallback (no unread
  // poem at this position) still needs to proceed with no currentPoem set.
  const handleProceed = useCallback(() => {
    if (position == null) return;
    if (currentPoem) {
      const nextRead = new Set(readSet);
      nextRead.add(currentPoem.slug);
      setReadSet(nextRead);
      saveReadSet(nextRead);
    }
    const nextPos = Math.max(0, position - 1);
    setPosition(nextPos);
    savePosition(nextPos);
    setCurrentPoem(null);
    setPhase("view");
  }, [currentPoem, position, readSet]);

  // Stage A stub — logs the event and returns without advancing. The real
  // banishment behaviour is Stage D.
  const handlePussOut = useCallback(() => {
    if (!currentPoem || position == null) return;
    logPussOut({ slug: currentPoem.slug, position, at: Date.now() });
    setCurrentPoem(null);
    setPhase("view");
  }, [currentPoem, position]);

  const handleNoteChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNote(value);
    if (!currentPoem) return;
    setNotesMap(prev => {
      const next = { ...prev, [currentPoem.slug]: { text: value, sent: prev[currentPoem.slug]?.sent ?? false } };
      saveNotes(next);
      return next;
    });
  }, [currentPoem]);

  const handleSend = useCallback(async () => {
    if (!currentPoem || sendState === "sending" || sendState === "sent") return;
    setSendState("sending");
    try {
      const res = await fetch(WEB3FORMS_ENDPOINT, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          from_name:  "range",
          subject:    "range — a note",
          message:    `${currentPoem.title}\n${currentPoem.date}\n\n${note}`,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error("send failed");
      setSendState("sent");
      setNotesMap(prev => {
        const next = { ...prev, [currentPoem.slug]: { text: note, sent: true } };
        saveNotes(next);
        return next;
      });
    } catch {
      setSendState("error");
    }
  }, [currentPoem, sendState, note]);

  const sendLabel = {
    idle: "send this to kerem", sending: "sending", sent: "sent", error: "didn't send. try again",
  }[sendState];

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw",
        fontFamily: MONO,
      }}
    >
      <Link
        href="/"
        style={{
          fontSize:       "0.7rem",
          fontWeight:     600,
          letterSpacing:  "0.14em",
          textTransform:  "uppercase",
          color:          "#0a0a0a",
          textDecoration: "none",
          opacity:        0.5,
        }}
      >
        Return
      </Link>

      {!ready ? null : phase === "view" ? (
        <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
          <div
            ref={frameRef}
            style={{
              marginTop: "3rem",
              height:    "clamp(280px, 46vh, 480px)",
              position:  "relative",
            }}
          >
            {dims.width > 0 && dims.height > 0 && points.length > 0 && (
              <svg
                width={dims.width}
                height={dims.height}
                viewBox={`0 0 ${dims.width} ${dims.height}`}
                style={{ display: "block" }}
              >
                <defs>
                  <linearGradient
                    id="rangeHazeGrad"
                    x1={Math.max(0, resolveX - hazeWidth)} x2={resolveX} y1="0" y2="0"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0" stopColor="white" stopOpacity="0" />
                    <stop offset="1" stopColor="white" stopOpacity="1" />
                  </linearGradient>
                  <mask id="rangeHazeMask">
                    <rect
                      x={Math.max(0, resolveX - hazeWidth)} y={0}
                      width={hazeWidth} height={dims.height}
                      fill="url(#rangeHazeGrad)"
                    />
                  </mask>
                  <clipPath id="rangeResolvedClip">
                    <rect x={resolveX} y={0} width={Math.max(0, dims.width - resolveX)} height={dims.height} />
                  </clipPath>
                </defs>

                {/* sonar point field — detected-but-unresolved ground, spans the whole width */}
                <g>
                  {dots.map((d, i) => (
                    <circle key={i} cx={d.x} cy={d.y} r={DOT_R} fill="#0a0a0a" fillOpacity={d.base} />
                  ))}
                </g>

                {/* haze — a short, partially-resolved stretch just ahead of the reader */}
                <path
                  d={linePath} fill="none" stroke="#0a0a0a" strokeWidth={STROKE_W}
                  strokeOpacity={HAZE_OPACITY} mask="url(#rangeHazeMask)"
                />

                {/* resolved — already passed, fully drawn */}
                <path
                  d={linePath} fill="none" stroke="#0a0a0a" strokeWidth={STROKE_W}
                  clipPath="url(#rangeResolvedClip)"
                />

                {/* the reader's position — marked, hard-edged */}
                <line x1={resolveX} y1={resolveY} x2={resolveX} y2={dims.height} stroke="#0a0a0a" strokeWidth={1} />
                <rect x={resolveX - 3} y={resolveY - 3} width={6} height={6} fill="#0a0a0a" />
              </svg>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginTop: "2.5rem" }}>
            {hasUnread ? (
              <MechButton label="Read" onClick={handleRead} />
            ) : (
              <>
                <span style={{ fontSize: "0.7rem", letterSpacing: "0.1em", color: "rgba(10,10,10,0.4)" }}>
                  nothing left here
                </span>
                <MechButton label="Proceed" onClick={handleProceed} />
              </>
            )}
          </div>
        </motion.div>
      ) : currentPoem ? (
        <motion.div
          key={currentPoem.slug}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
          style={{ maxWidth: "640px", margin: "3rem auto 0" }}
        >
          <h1
            style={{
              fontFamily: PROSE, fontSize: "clamp(1.6rem, 4vw, 2.4rem)", fontWeight: 700,
              letterSpacing: "-0.02em", lineHeight: 1.15, color: "#0a0a0a", marginBottom: "0.5rem",
              minHeight: "1.15em",
            }}
          >
            {revealStage >= 1 && (
              <CryptoScramble
                text={currentPoem.title} duration={SCRAMBLE_MS} tickMs={TICK_MS}
                chars={SCRAMBLE_CHARS} scrambleSpaces
              />
            )}
          </h1>

          <p style={{ fontFamily: PROSE, fontSize: "0.75rem", color: "rgba(10,10,10,0.4)", letterSpacing: "0.05em", marginBottom: "2.5rem", minHeight: "1em" }}>
            {revealStage >= 2 && (
              <CryptoScramble
                text={currentPoem.date} duration={SCRAMBLE_MS} tickMs={TICK_MS}
                chars={SCRAMBLE_CHARS} scrambleSpaces
              />
            )}
          </p>

          <div style={{ fontFamily: PROSE, fontSize: "1.05rem", lineHeight: 1.8, color: "#0a0a0a", whiteSpace: "pre-wrap" }}>
            {revealStage >= 3 && (
              <CryptoScramble
                text={currentPoem.body} duration={SCRAMBLE_MS} tickMs={TICK_MS}
                chars={SCRAMBLE_CHARS} scrambleSpaces
              />
            )}
          </div>

          {/* Notes — same pattern as kismet: plain, no chrome, autosaves, sends to kerem */}
          <div className="kismet-note-wrap" style={{ marginTop: "3rem" }}>
            <textarea
              ref={noteRef}
              value={note}
              onChange={handleNoteChange}
              readOnly={sendState === "sent"}
              placeholder="notes"
              rows={1}
              className="kismet-note"
            />
            {note.trim() && (
              <div className="kismet-note-action">
                <button
                  onClick={handleSend}
                  disabled={sendState === "sending" || sendState === "sent"}
                  className="kismet-send"
                >
                  {sendLabel}
                </button>
              </div>
            )}
          </div>

          {showButtons && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
              style={{ display: "flex", justifyContent: "center", gap: "1.25rem", marginTop: "3rem", paddingBottom: "3rem" }}
            >
              <MechButton label="Puss out?" onClick={handlePussOut} />
              <MechButton label="Proceed" onClick={handleProceed} />
            </motion.div>
          )}
        </motion.div>
      ) : null}
    </main>
  );
}
