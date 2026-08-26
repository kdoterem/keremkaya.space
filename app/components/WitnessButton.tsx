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
  launchDelayMs: number;
}

// Two confetti cannons, not a general scatter — one held at the bottom-left
// corner firing up-and-right at 45°, one at the bottom-right firing
// up-and-left, crossing in the middle. A real cannon pop is a fast,
// pressurized kick, not a gentle release: high launch speed, a tight
// directional cone (not a wide fan or a full circle), and the burst's own
// speed bleeds off hard within a handful of frames (BURST_DRAG) — violent
// and over quickly, same as a real pop — before gravity takes over for the
// fall. Every piece is the same long, narrow paper streamer (no circles —
// real confetti strips don't look like dots), dense enough to read as a
// real outburst rather than a sprinkle.
const PIECE_COUNT = 360;
const GRAVITY = 0.55;
const BURST_DRAG = 0.9;
const CANNON_SPEED_MIN = 17;
const CANNON_SPEED_RANGE = 15;
const CANNON_CONE = Math.PI * 0.24; // ~43° spread around each cannon's own center angle — directed, not a fan
const LAUNCH_STAGGER_MS = 90; // both cannons still read as one synchronized pop, not a trickle

function spawnPieces(width: number, height: number): Piece[] {
  const cannons = [
    { x: -width * 0.03, y: height * 0.97, angle: -Math.PI / 4 },           // bottom-left, firing up-right
    { x: width * 1.03, y: height * 0.97, angle: (-Math.PI * 3) / 4 },       // bottom-right, firing up-left
  ];
  const pieces: Piece[] = [];
  for (let i = 0; i < PIECE_COUNT; i++) {
    const cannon = cannons[i % 2];
    const angle = cannon.angle + (Math.random() - 0.5) * CANNON_CONE;
    const speed = CANNON_SPEED_MIN + Math.random() * CANNON_SPEED_RANGE;
    pieces.push({
      x: cannon.x + (Math.random() - 0.5) * width * 0.04,
      y: cannon.y + (Math.random() - 0.5) * height * 0.03,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 20 + Math.random() * 22, // long strips
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.35,
      swayPhase: Math.random() * Math.PI * 2,
      swayAmp: 0.6 + Math.random() * 1.3,
      opacity: 0.82 + Math.random() * 0.18,
      launchDelayMs: Math.random() * LAUNCH_STAGGER_MS,
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
        if (elapsed < p.launchDelayMs) continue; // hasn't fired yet
        // The cannon's own kick bleeds off hard (BURST_DRAG) — violent for
        // a handful of frames, then gone. Gravity accumulates the whole
        // time underneath it, so once the kick has decayed, gravity is
        // what's left driving the fall.
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
