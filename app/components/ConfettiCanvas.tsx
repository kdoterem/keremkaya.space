"use client";

import { useEffect, useRef } from "react";

// ── Extracted out of WitnessButton (its original home) so PLAY's
// send-to-Kerem confirmation can reuse the exact same tuned physics
// rather than re-deriving them — this took roughly eight passes to get
// feeling right (real accelerating gravity instead of a flat linear
// creep, horizontal-only flutter so pieces don't fight their own fall,
// staggered pop timing), and confetti has proven hard to get right
// every time it's been attempted here. Reuse it, don't re-tune it.
//
// Plain canvas + requestAnimationFrame, not a library — this is a one-off
// few-second moment, not a persistent site system. Decorative only
// (aria-hidden); whatever UI triggers this owns its own announcement.

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

export default function ConfettiCanvas({ durationMs = 4200 }: { durationMs?: number }) {
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
      if (now - start > durationMs) return; // let the last frame sit — the caller's own fade-out covers it
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
  }, [durationMs]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, zIndex: 301, pointerEvents: "none" }}
    />
  );
}
