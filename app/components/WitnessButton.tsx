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
  vx: number; vy: number;
  size: number;
  rotation: number; rotationSpeed: number;
  swayPhase: number; swayAmp: number;
  opacity: number;
}

// Real "confetti cannon green screen" overlay footage doesn't show pieces
// travelling to fill the frame — by the time there's a first frame worth
// looking at, the whole screen is already wall-to-wall confetti, and what
// you actually watch over the next few seconds is that density thinning
// out as pieces fall past frame or their motion settles. So: every piece
// spawns already scattered across the ENTIRE canvas at t=0 (not clustered
// near an origin), each with its own fast, independently-random direction
// of motion — the churn of all those independent vectors is what reads as
// "mid-explosion," not a journey across the screen. CHURN_DRAG bleeds that
// energy off over about a second, then GRAVITY (accumulating the whole
// time underneath it) is what's left, carrying everything into an
// ordinary fall — which is also what thins the field out over time, since
// pieces exit past the bottom edge and no new ones replace them.
const PIECE_COUNT = 560;
const GRAVITY = 0.55;
const CHURN_DRAG = 0.965;
const CHURN_SPEED_MIN = 3;
const CHURN_SPEED_RANGE = 8;

function spawnPieces(width: number, height: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = CHURN_SPEED_MIN + Math.random() * CHURN_SPEED_RANGE;
    pieces.push({
      x: Math.random() * width,
      y: -height * 0.05 + Math.random() * height * 1.05,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 16 + Math.random() * 18,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.35,
      swayPhase: Math.random() * Math.PI * 2,
      swayAmp: 0.6 + Math.random() * 1.3,
      opacity: 0.78 + Math.random() * 0.22,
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
      for (const p of pieces) {
        // The initial churn bleeds off over about a second (CHURN_DRAG);
        // gravity accumulates the whole time underneath it, so once the
        // churn has decayed, gravity is what's left — an ordinary fall,
        // which is also what thins the field out as pieces exit frame.
        p.vx *= CHURN_DRAG;
        p.vy = p.vy * CHURN_DRAG + GRAVITY * 0.06;
        p.y += p.vy;
        p.x += p.vx + Math.sin(now / 400 + p.swayPhase) * p.swayAmp * 0.05;
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
