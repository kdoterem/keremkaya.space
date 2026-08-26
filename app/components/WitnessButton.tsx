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
  shape: 0 | 1; // 0 = strand (paper streamer), 1 = circle (dot-like)
  opacity: number;
}

const PIECE_COUNT = 200;
const GRAVITY = 0.5;
// How fast the initial burst's own velocity bleeds off each frame — this is
// what turns "shot outward violently" into "now just lingering and
// drifting," without a separate state machine: gravity keeps accumulating
// underneath the whole time, so once the burst's own speed has decayed
// near zero, gravity is what's left driving the fall.
const BURST_DRAG = 0.93;

// A real burst, not an instant scatter — several origin points spread
// across the width (like a row of confetti poppers, not one single
// cannon, so the whole screen fills at once rather than spreading out from
// a single spot) each fire their share of pieces outward in every
// direction at real speed, with an extra upward kick so it reads as
// thrown, not just released. BURST_DRAG in the tick loop below bleeds that
// speed off quickly, so the violent part is genuinely over within the
// first few frames — what's left after that is the slow lingering drift.
const ORIGIN_COUNT = 7;

function spawnPieces(width: number, height: number): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    const originIndex = i % ORIGIN_COUNT;
    const originX = ((originIndex + 0.5) / ORIGIN_COUNT) * width + (Math.random() - 0.5) * width * 0.08;
    const originY = height * (0.18 + Math.random() * 0.14);

    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 9;

    pieces.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4, // extra upward kick — thrown, not dropped
      size: 10 + Math.random() * 15,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      swayPhase: Math.random() * Math.PI * 2,
      swayAmp: 0.6 + Math.random() * 1.3,
      shape: Math.random() < 0.5 ? 0 : 1,
      opacity: 0.75 + Math.random() * 0.25,
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
        // The burst's own velocity bleeds off fast (BURST_DRAG); gravity
        // accumulates the whole time underneath it. Early frames: mostly
        // burst, flying outward. Later frames: burst has decayed away,
        // gravity is what's left — the lingering drift, then the fall.
        p.vx *= BURST_DRAG;
        p.vy = p.vy * BURST_DRAG + GRAVITY * 0.06;
        p.y += p.vy;
        p.x += p.vx + Math.sin(now / 400 + p.swayPhase) * p.swayAmp * 0.05;
        p.rotation += p.rotationSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = "#0a0a0a";
        if (p.shape === 0) {
          // A streamer, not a square — long and narrow reads as paper
          // confetti at a glance, a stubby rect just reads as a black dot.
          ctx.fillRect(-p.size / 2, -p.size / 7, p.size, p.size / 3.5);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
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
