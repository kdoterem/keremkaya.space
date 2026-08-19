"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CryptoScramble from "@/app/components/CryptoScramble";
import MechButton, { SETTLE_EASE } from "@/app/components/MechButton";
import {
  getProvenanceTags,
  computeWeights,
  bodyWeightStyle,
  titleWeightStyle,
  provenanceBoundaryDate,
} from "@/lib/tagProvenance";
import {
  mulberry32,
  buildSegmentTrees,
  MeshLayers,
  SweepOverlay,
  Annotation,
  computeConfidences,
  type Pt,
} from "@/app/components/TerrainScan";

// ── PLAY — a reader traverses backward through time, present → Feb 2025,
// one poem per position. No progress bar, no counter — the terrain itself
// (behind: resolved; ahead: sonar dots; just-ahead: a haze) is the only
// indicator. Stage A only: the loop core (view → READ → poem → PROCEED/PUSS
// OUT → view, advanced). Stages B (spawn), C (depth/composition), and D
// (banishment) are not built here.
//
// Relocated from the old standalone /terrain route into /writing's PLAY
// mode — mechanically unchanged. The only difference from its previous
// form is the exit affordance: it used to be a hard navigation back to
// "/"; now it's the onExit callback, handing control back to /writing's
// own landing state instead of leaving the page. ──

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

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function formatMonthShort(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
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

// ── Layout / erosion / point-field constants (same values as the prior pass) ──
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

const SWEEP_DURATION_S = 10; // same slow loop as the landing/BROWSE terrain

// ── Reading mechanics ──
const MONO = '"SF Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace';
const PROSE = '"Helvetica Neue", Helvetica, Arial, sans-serif';

// v2 — bumped because the selection rule changed (a month's poems are now
// fully exhausted, oldest-first, before stepping back to the previous
// month, rather than one poem per month). Old v1 state from testing across
// this page's earlier rewrites doesn't match that rule, so it's left behind
// rather than resumed into.
const POS_KEY       = "range:position:v2";
const READ_KEY      = "range:read:v2";
const NOTES_KEY     = "range:notes:v2";
const LOG_KEY       = "range:log:v2";
const STRETCHES_KEY = "range:stretches:v2";

// ── The route's named stretches, in walking order (present → Feb 2025) ──
// Shown once each, as a full-screen card, the first time the reader crosses
// into one — nowhere else. The route is named; nothing on it is signed.
interface Stretch { name: string; start: string; end: string } // start/end are YYYY-MM, inclusive
const STRETCHES: Stretch[] = [
  { name: "THE APPROACH", start: "2026-06", end: "2026-08" },
  { name: "THE ENGINE",   start: "2026-02", end: "2026-05" },
  { name: "THE SHAFT",    start: "2026-01", end: "2026-01" },
  { name: "THE TRAVERSE", start: "2025-07", end: "2025-12" },
  { name: "THE NARROWS",  start: "2025-05", end: "2025-06" },
  { name: "THE FACE",     start: "2025-02", end: "2025-04" },
];

// YYYY-MM strings compare correctly as plain strings.
function stretchForMonth(month: string): string | null {
  for (const s of STRETCHES) if (month >= s.start && month <= s.end) return s.name;
  return null;
}

const STRETCH_CARD_MS = 1000; // "roughly one second"

// How many of a month's poems PROCEED serves before stepping back to the
// previous month, regardless of how many remain unread — sub-linear so a
// populous month (Feb 2025, 67) isn't a wall the reader can never get past.
// sqrt(67)≈8, sqrt(32)≈6, sqrt(1)=1. Poems not served on this pass just stay
// in the month, unvisited — not deleted, not queued, simply not walked.
function quotaFor(monthPostCount: number): number {
  return Math.max(1, Math.round(Math.sqrt(monthPostCount)));
}

const WEB3FORMS_ENDPOINT   = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY = "1bf57100-9d1e-4357-9747-7155c3a32255";

// Same treatment as the kismet cards — identical tick rate and resolve feel.
const SCRAMBLE_MS  = 1100;
const TICK_MS      = 75;
const STAGGER_MS    = 500; // title → date → body
const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&";
const TOTAL_REVEAL_MS = STAGGER_MS * 2 + SCRAMBLE_MS + 200;

// ── Tag provenance — logic lives in lib/tagProvenance.tsx, shared with
// /writing's plain (non-journey) rendering so both render identical
// emphasis for identical data. Posts with no entry there (i.e. everything
// before the boundary date) render exactly as before: computeWeights
// returns undefined, CryptoScramble falls back to its plain flat-span
// render. ──

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

function loadCrossedStretches(): Set<string> {
  try {
    const raw = localStorage.getItem(STRETCHES_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}
function saveCrossedStretches(s: Set<string>) { try { localStorage.setItem(STRETCHES_KEY, JSON.stringify([...s])); } catch { /* ignore */ } }

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

export default function ReadingJourney({ onExit }: { onExit: () => void }) {
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

  const [crossedStretches, setCrossedStretches] = useState<Set<string>>(new Set());
  const [stretchCard,      setStretchCard]      = useState<string | null>(null);

  const [dims, setDims] = useState({ width: 0, height: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const noteRef  = useRef<HTMLTextAreaElement>(null);
  const initedPos = useRef(false);
  const revealTimeouts  = useRef<number[]>([]);
  const revealDelayRef  = useRef(0);   // extra ms the current poem's reveal-stagger waits — set when a stretch card is showing
  const stretchTimeout  = useRef<number | null>(null);

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

  // Position, read-set, notes, and which stretches have already been
  // crossed are restored once — the moment the month list is known (needed
  // to clamp a stored position to a valid index).
  useEffect(() => {
    if (initedPos.current || months.length === 0) return;
    initedPos.current = true;
    setPosition(loadPosition(months.length - 1));
    setReadSet(loadReadSet());
    setNotesMap(loadNotes());
    setCrossedStretches(loadCrossedStretches());
  }, [months.length]);

  useEffect(() => () => { if (stretchTimeout.current != null) window.clearTimeout(stretchTimeout.current); }, []);

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
  // kismet's three-card reveal. revealDelayRef holds off the whole sequence
  // when a stretch card is covering the poem, so it starts fresh once the
  // card clears rather than having already been running underneath it.
  useEffect(() => {
    revealTimeouts.current.forEach(clearTimeout);
    if (!currentPoem) { setRevealStage(0); return; }
    setRevealStage(0);
    const base = revealDelayRef.current;
    revealTimeouts.current = [0, 1, 2].map(i =>
      window.setTimeout(() => setRevealStage(s => Math.max(s, i + 1)), base + i * STAGGER_MS)
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

  const confidences = useMemo(() => computeConfidences(months.map(m => m.count)), [months]);

  const peakIdx = useMemo(() => {
    if (months.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < months.length; i++) if (months[i].count > months[best].count) best = i;
    return best;
  }, [months]);

  const troughIdx = useMemo(() => {
    const withPosts = months.map((m, i) => ({ m, i })).filter(x => x.m.count > 0);
    if (withPosts.length === 0) return -1;
    let best = withPosts[0];
    for (const x of withPosts) if (x.m.count < best.m.count) best = x;
    return best.i;
  }, [months]);

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

  // MILAT seam — where deep tagging currently ends going backward in time.
  // The x-axis is linear by month index, not by calendar day, so the exact
  // day within its month is interpolated between that month's point and the
  // previous (older) one's, proportional to how far into the month it falls.
  // Looked up dynamically from the provenance data's earliest date, not
  // hardcoded — a future addition to tag-provenance.json with an earlier
  // date would move the seam automatically.
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
    if (idx === 0) return thisPt.x; // no older month to interpolate from
    const daysInMonth = new Date(by, bm, 0).getDate();
    const frac = clamp((bd - 1) / daysInMonth, 0, 1);
    const prevPt = points[idx - 1];
    return prevPt.x + (thisPt.x - prevPt.x) * frac;
  }, [points, months]);

  // Shared by the very first READ and by PROCEED's direct delivery — puts a
  // poem on screen and restarts its title/date/body stagger + button timer.
  // If the poem's month belongs to a stretch not yet crossed, a full-screen
  // card takes over first: the poem is still delivered underneath it, but
  // its own reveal is held off (via revealDelayRef) until the card clears,
  // so it starts fresh rather than having been quietly running the whole
  // time behind an opaque screen.
  const deliverPoem = useCallback((poem: SearchDoc) => {
    const stretch = stretchForMonth(poem.date.slice(0, 7));
    let delay = 0;
    if (stretch && !crossedStretches.has(stretch)) {
      const next = new Set(crossedStretches);
      next.add(stretch);
      setCrossedStretches(next);
      saveCrossedStretches(next);
      if (stretchTimeout.current != null) window.clearTimeout(stretchTimeout.current);
      setStretchCard(stretch);
      stretchTimeout.current = window.setTimeout(() => setStretchCard(null), STRETCH_CARD_MS);
      delay = STRETCH_CARD_MS;
    }
    revealDelayRef.current = delay;
    setCurrentPoem(poem);
    setNote(notesMap[poem.slug]?.text ?? "");
    setSendState(notesMap[poem.slug]?.sent ? "sent" : "idle");
    setShowButtons(false);
    setPhase("poem");
    window.setTimeout(() => setShowButtons(true), delay + TOTAL_REVEAL_MS);
  }, [notesMap, crossedStretches]);

  // READ only ever fires once per session — to enter the loop. Every poem
  // after that arrives via PROCEED.
  const handleRead = useCallback(() => {
    if (position == null) return;
    const next = currentMonthPosts.find(p => !readSet.has(p.slug));
    if (!next) return;
    deliverPoem(next);
  }, [position, currentMonthPosts, readSet, deliverPoem]);

  // PROCEED delivers the next poem directly — no return trip through the
  // view and a second click. Marking the current poem read only applies
  // when there is one (the "nothing left here" fallback has none).
  //
  // Selection is strictly chronological and fully deterministic: a month is
  // crossed forward (its own poems, oldest-first) up to its quota
  // (quotaFor — roughly sqrt of the month's poem count, minimum one) before
  // the reader steps back to the previous — i.e. older — month. So PROCEED
  // first checks whether this pass has already served that many poems from
  // the *current* month; if not, it delivers the next unread one there
  // without moving position. Only once the quota's met (or the month's
  // truly exhausted) does it step the position back. No randomisation
  // anywhere — same read-state always yields the same next poem.
  const handleProceed = useCallback(() => {
    if (position == null) return;
    let effectiveRead = readSet;
    if (currentPoem) {
      effectiveRead = new Set(readSet);
      effectiveRead.add(currentPoem.slug);
      setReadSet(effectiveRead);
      saveReadSet(effectiveRead);
    }

    const servedThisMonth = currentMonthPosts.filter(p => effectiveRead.has(p.slug)).length;
    if (servedThisMonth < quotaFor(currentMonthPosts.length)) {
      const stillInMonth = currentMonthPosts.find(p => !effectiveRead.has(p.slug));
      if (stillInMonth) {
        deliverPoem(stillInMonth);
        return;
      }
    }

    const nextPos = Math.max(0, position - 1);
    setPosition(nextPos);
    savePosition(nextPos);

    const nextMonth = months[nextPos]?.month;
    const nextPosts = nextMonth ? (postsByMonth.get(nextMonth) ?? []) : [];
    const next = nextPosts.find(p => !effectiveRead.has(p.slug));

    if (next) {
      deliverPoem(next);
    } else {
      setCurrentPoem(null);
      setPhase("view");
    }
  }, [position, currentPoem, readSet, currentMonthPosts, months, postsByMonth, deliverPoem]);

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

  // undefined for every post outside the provenance data — CryptoScramble
  // renders those exactly as it did before this pass.
  const provenanceTags = currentPoem ? getProvenanceTags(currentPoem.slug) : undefined;
  const titleWeights = useMemo(
    () => currentPoem ? computeWeights(currentPoem.title, provenanceTags) : undefined,
    [currentPoem, provenanceTags],
  );
  const bodyWeights = useMemo(
    () => currentPoem ? computeWeights(currentPoem.body, provenanceTags) : undefined,
    [currentPoem, provenanceTags],
  );

  return (
    <div
      style={{
        fontFamily: MONO,
      }}
    >
      <button
        onClick={onExit}
        style={{
          fontSize:       "0.7rem",
          fontWeight:     600,
          letterSpacing:  "0.14em",
          textTransform:  "uppercase",
          color:          "#0a0a0a",
          background:     "none",
          border:         "none",
          padding:        0,
          cursor:         "pointer",
          opacity:        0.5,
        }}
      >
        Return
      </button>

      <AnimatePresence mode="popLayout">
      {!ready ? null : phase === "view" ? (
        <motion.div
          key="view"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 18 }}
          transition={{ duration: 0.48, ease: SETTLE_EASE }}
        >
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
                style={{ display: "block", overflow: "visible" }}
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

                {/* haze — a short, partially-resolved stretch just ahead of the reader.
                    Same wireframe mesh as "resolved" below, at reduced brightness,
                    masked to the short band just past the reader's position. */}
                <g mask="url(#rangeHazeMask)">
                  <MeshLayers points={points} dispTrees={dispTrees} mag0={EROSION_MAG0} confidences={confidences} opacityMultiplier={0.5} />
                </g>

                {/* resolved — already passed, full-brightness mesh */}
                <g clipPath="url(#rangeResolvedClip)">
                  <MeshLayers points={points} dispTrees={dispTrees} mag0={EROSION_MAG0} confidences={confidences} />
                </g>

                {/* the scan sweep — continuous, independent of reading progress.
                    A different axis from "what's been read": the instrument keeps
                    reading the whole range regardless of how far the reader's got. */}
                <SweepOverlay
                  width={dims.width} height={dims.height}
                  points={points} dispTrees={dispTrees} mag0={EROSION_MAG0} confidences={confidences}
                  durationS={SWEEP_DURATION_S}
                />

                {/* MILAT seam — a literal crossing, with a floating label */}
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

                {/* persistent annotations — peak and trough, always on */}
                {peakIdx >= 0 && points[peakIdx] && (
                  <Annotation
                    x={points[peakIdx].x} y={points[peakIdx].y}
                    label={formatMonthShort(months[peakIdx].month)}
                    sublabel={`${months[peakIdx].count} poems`}
                    variant="data"
                    side={points[peakIdx].x > dims.width / 2 ? "left" : "right"}
                    vSide={points[peakIdx].y < 60 ? "down" : "up"}
                  />
                )}
                {troughIdx >= 0 && troughIdx !== peakIdx && points[troughIdx] && (
                  <Annotation
                    x={points[troughIdx].x} y={points[troughIdx].y}
                    label={formatMonthShort(months[troughIdx].month)}
                    sublabel={`${months[troughIdx].count} poem${months[troughIdx].count === 1 ? "" : "s"}`}
                    variant="data"
                    side={points[troughIdx].x > dims.width / 2 ? "left" : "right"}
                    vSide={points[troughIdx].y < 60 ? "down" : "up"}
                  />
                )}

                {/* the reader's position — its own hard-edged marker (unchanged),
                    plus a leader-line readout, distinct from the peak/trough
                    annotations above. */}
                <line x1={resolveX} y1={resolveY} x2={resolveX} y2={dims.height} stroke="#0a0a0a" strokeWidth={1} />
                <rect x={resolveX - 3} y={resolveY - 3} width={6} height={6} fill="#0a0a0a" />
                {position != null && months[position] && (
                  <Annotation
                    x={resolveX} y={resolveY}
                    label="you are here"
                    sublabel={formatMonthShort(months[position].month)}
                    variant="position"
                    side={resolveX > dims.width / 2 ? "left" : "right"}
                    vSide={resolveY < 60 ? "down" : "up"}
                    leaderLength={30}
                  />
                )}
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
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 18 }}
          transition={{ duration: 0.48, ease: SETTLE_EASE }}
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
                weights={titleWeights} weightStyle={titleWeightStyle}
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
                weights={bodyWeights} weightStyle={bodyWeightStyle}
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
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: SETTLE_EASE }}
              style={{ display: "flex", justifyContent: "center", gap: "1.25rem", marginTop: "3rem", paddingBottom: "3rem" }}
            >
              <MechButton label="Puss out?" onClick={handlePussOut} />
              <MechButton label="Proceed" onClick={handleProceed} />
            </motion.div>
          )}
        </motion.div>
      ) : null}
      </AnimatePresence>

      {/* Stretch card — full-screen, name only, no interaction. Shown once per
          stretch per reader (crossedStretches, localStorage-backed above).
          Deliberately outside the view/poem AnimatePresence: it's an overlay
          on top of whichever of those is current, not a third phase. */}
      <AnimatePresence>
        {stretchCard && (
          <motion.div
            key={stretchCard}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: SETTLE_EASE }}
            style={{
              position:       "fixed",
              inset:          0,
              background:     "#aaff00",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              padding:        "0 5vw",
              zIndex:         200,
              pointerEvents:  "none",
            }}
          >
            <span
              style={{
                fontFamily:    MONO,
                fontSize:      "clamp(1.8rem, 7vw, 4rem)",
                fontWeight:    700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color:         "#0a0a0a",
                textAlign:     "center",
              }}
            >
              {stretchCard}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
