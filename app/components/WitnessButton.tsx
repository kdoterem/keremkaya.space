"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

// ── An unlabeled button — no text, no icon, no tooltip, nothing that gives
// away what it does. Reward curiosity, don't announce it: the whole idea
// only works if there's genuinely nothing to read here, just a small mark
// someone might click because they wondered what it was, the same register
// as the tag cloud or the dodge-then-commit PLAY button on /writing. Pinned
// to the bottom-right corner of the viewport, not sitting inline with (or
// stacked under) save/share — its own separate thing, findable in its own
// corner rather than blending into the row of buttons at the end of a poem.
//
// What it does: the poem dissolves, the screen becomes a clean field of
// the site's own green, black confetti pops and falls across the whole
// thing, and after a beat "thank you for witnessing" appears at real
// titlecard weight — not a toast, not a checkmark. A few seconds later it
// all dissolves back to exactly where you were; no navigation, nothing
// saved. Repeatable every time, on every poem, for anyone who wants it —
// not gated to any particular posts.

const TOTAL_MS = 4200;
const TEXT_DELAY_S = 0.55;
const REDUCED_MS = 2200;

interface Piece {
  x: number; y: number;
  kickVx: number; kickVy: number;      // a sharp initial punch, decays fast — the pop itself
  flutterAmpX: number; flutterFreqX: number; flutterPhaseX: number; // side-to-side sway only
  fallSpeed: number;                   // accelerates to a capped terminal speed — real gravity
  size: number;
  rotation: number; rotationSpeed: number;
  opacity: number;
  appearDelayMs: number;               // staggered fast fill, not everyone visible at once
}

// The pop itself was right: a sharp KICK in a random direction, decaying
// fast, staggered over a short fill window so there's a real burst to
// see. What was wrong was after — real gravity was almost an
// afterthought (a tiny linear accumulation), and a full vertical flutter
// on top of it meant pieces spent as much time drifting back up as they
// did falling, so the whole field just hung there instead of clearing.
// This isn't confetti in a sealed box; once the pop's energy is spent,
// gravity should win, decisively, the way it actually would in open air.
//
// So: gravity now ACCELERATES (real free-fall shape, not a flat linear
// creep) up to a capped terminal speed, reached well within the first
// second post-pop. Flutter is horizontal-only now (the side-to-side sway
// of a falling leaf/streamer) — no more vertical bobbing fighting the
// fall. Net result: pop, then a real, visibly-clearing fall, with just
// enough sway to keep it feeling alive rather than a straight plummet.
const PIECE_COUNT = 500;
const KICK_SPEED_MIN = 8;
const KICK_SPEED_RANGE = 9;
const KICK_DRAG = 0.88;
const FLUTTER_AMP_MIN = 1.2;
const FLUTTER_AMP_RANGE = 2;
const GRAVITY_ACCEL = 0.16;
const MAX_FALL_SPEED = 8;
const POP_WINDOW_MS = 260;

function spawnPieces(width: number, height: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    const kickAngle = Math.random() * Math.PI * 2;
    const kickSpeed = KICK_SPEED_MIN + Math.random() * KICK_SPEED_RANGE;
    pieces.push({
      x: Math.random() * width,
      y: Math.random() * height,
      kickVx: Math.cos(kickAngle) * kickSpeed,
      kickVy: Math.sin(kickAngle) * kickSpeed,
      flutterAmpX: FLUTTER_AMP_MIN + Math.random() * FLUTTER_AMP_RANGE,
      flutterFreqX: 130 + Math.random() * 120,
      flutterPhaseX: Math.random() * Math.PI * 2,
      fallSpeed: 0,
      size: 16 + Math.random() * 18,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.4,
      opacity: 0.78 + Math.random() * 0.22,
      appearDelayMs: Math.random() * POP_WINDOW_MS,
    });
  }
  return pieces;
}

// Plain canvas + requestAnimationFrame, not a library — this is a one-off
// four-second moment, not a persistent site system, so a small dependency-
// free particle loop is plenty and keeps this self-contained. Decorative
// only (aria-hidden); the actual message is the text below, which carries
// its own announcement.
function ConfettiCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const pieces = spawnPieces(canvas.width, canvas.height);
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      if (now - start > TOTAL_MS) return; // let the last frame sit — the overlay's own fade-out covers it
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const elapsed = now - start;
      for (const p of pieces) {
        if (elapsed < p.appearDelayMs) continue; // hasn't popped in yet
        p.kickVx *= KICK_DRAG;
        p.kickVy *= KICK_DRAG;
        p.fallSpeed = Math.min(p.fallSpeed + GRAVITY_ACCEL, MAX_FALL_SPEED);
        const flutterVx = Math.sin(now / p.flutterFreqX + p.flutterPhaseX) * p.flutterAmpX;
        p.x += p.kickVx + flutterVx;
        p.y += p.kickVy + p.fallSpeed;
        p.rotation += p.rotationSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = "#0a0a0a";
        // Long and narrow — a real paper streamer, not a stubby rect.
        ctx.fillRect(-p.size / 2, -p.size / 9, p.size, p.size / 4.5);
        ctx.restore();
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, zIndex: 301, pointerEvents: "none" }}
    />
  );
}

export default function WitnessButton() {
  const [active, setActive] = useState(false);
  const reduceMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const trigger = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setActive(true);
    timerRef.current = setTimeout(() => setActive(false), reduceMotion ? REDUCED_MS : TOTAL_MS);
  }, [reduceMotion]);

  return (
    <>
      <button
        onClick={trigger}
        aria-label="press if you're curious"
        style={{
          position: "fixed",
          bottom: "1.75rem",
          right: "1.75rem",
          zIndex: 50,
          width: "11px",
          height: "11px",
          border: "1px solid rgba(10,10,10,0.15)",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
          transition: "border-color 0.3s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(10,10,10,0.4)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(10,10,10,0.15)"; }}
      />

      <AnimatePresence>
        {active && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 300,
              background: "#aaff00",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {!reduceMotion && <ConfettiCanvas />}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: reduceMotion ? 0.1 : TEXT_DELAY_S }}
              style={{
                position: "relative",
                zIndex: 302,
                fontSize: "clamp(1.6rem, 5vw, 2.6rem)",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "#0a0a0a",
                textAlign: "center",
                padding: "0 1.5rem",
                fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              }}
            >
              thank you for witnessing
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
