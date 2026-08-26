"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

// ── An unlabeled button — no text, no icon, no tooltip, nothing that gives
// away what it does. Reward curiosity, don't announce it: the whole idea
// only works if there's genuinely nothing to read here, just a small mark
// someone might click because they wondered what it was, the same register
// as the tag cloud or the dodge-then-commit PLAY button on /writing. Sits
// quietly after save/share, in the "you've finished reading" zone — this
// only means anything once you've actually read the poem, so it belongs
// after it, not before or floating independently of it.
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
  flutterAmpX: number; flutterAmpY: number;
  flutterFreqX: number; flutterFreqY: number;
  flutterPhaseX: number; flutterPhaseY: number;
  fallSpeed: number;                   // starts near zero, accumulates slowly — net drift down
  size: number;
  rotation: number; rotationSpeed: number;
  opacity: number;
  appearDelayMs: number;               // staggered fast fill, not everyone visible at once
}

// Two things a plain drag-to-gravity model gets physically wrong for
// paper: (1) it doesn't show an actual pop — pieces either travel there
// (takes visible time) or are just already there (reads as prefilled,
// nothing happened); (2) it decays toward a calm, smooth fall, but real
// confetti is light and flat — it flutters and tumbles continuously in
// the air, it doesn't settle down the way a heavier object's motion would.
//
// So: every piece gets a real pop — a sharp KICK in a random direction
// that fades out fast (within a few hundred ms), stacked with a
// continuous, NON-decaying FLUTTER (independent sine oscillation on both
// axes, its own frequency/phase per piece so five hundred pieces never
// move in unison) that keeps driving real motion for the entire four
// seconds — nothing ever goes still or graceful. A slowly-accumulating
// fallSpeed is the only thing that trends pieces downward and off frame
// over time, which is what thins the field out, without ever damping the
// flutter itself. And the fill itself is staggered over a short, fast
// window (appearDelayMs) so there's a real burst to see, not a screen
// that's already full when the button lands.
const PIECE_COUNT = 500;
const KICK_SPEED_MIN = 8;
const KICK_SPEED_RANGE = 9;
const KICK_DRAG = 0.88;
const FLUTTER_AMP_MIN = 2.2;
const FLUTTER_AMP_RANGE = 3.6;
const FALL_ACCEL = 0.028;
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
      flutterAmpY: FLUTTER_AMP_MIN + Math.random() * FLUTTER_AMP_RANGE,
      flutterFreqX: 130 + Math.random() * 120,
      flutterFreqY: 130 + Math.random() * 120,
      flutterPhaseX: Math.random() * Math.PI * 2,
      flutterPhaseY: Math.random() * Math.PI * 2,
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
        p.fallSpeed += FALL_ACCEL * 0.06;
        const flutterVx = Math.sin(now / p.flutterFreqX + p.flutterPhaseX) * p.flutterAmpX;
        const flutterVy = Math.cos(now / p.flutterFreqY + p.flutterPhaseY) * p.flutterAmpY;
        p.x += p.kickVx + flutterVx;
        p.y += p.kickVy + flutterVy + p.fallSpeed;
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
          width: "11px",
          height: "11px",
          border: "1px solid rgba(10,10,10,0.15)",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
          marginTop: "2.5rem",
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
