"use client";

import { motion, useReducedMotion } from "framer-motion";
import { aliveScaleFor, seededPhase } from "@/lib/tagProvenance";
import { sparkleLayerStyle } from "./InvisibleInkText";

// ── The atomic unit PLAY's obscure/reveal is actually built from: one
// word. Earlier versions obscured whole multi-line runs of text at once,
// wrapped in a single inline `position: relative` span with an absolute
// `inset: 0` sparkle overlay — which silently breaks the moment that run's
// content wraps onto more than one visual line: `inset: 0` only ever
// covers an inline element's FIRST line box, so every line after the
// first rendered as truly blank (the real text sits at opacity 0 with no
// sparkle drawn over it) rather than glittering. A single word never
// wraps onto two lines on its own, so doing this per-word instead of
// per-run sidesteps the bug entirely rather than working around it.
//
// Masked to bullet placeholders before the sparkle treatment ever sees
// them (see maskWord) — same reasoning as the old PlayRevealText: this
// isn't meant to be a casually-inspectable "hidden" state.
function maskWord(word: string): string {
  return word.replace(/\S/g, "•");
}

export default function ObscurableToken({
  text,
  weight,
  revealed,
  seed,
}: {
  text: string;
  weight: number;
  revealed: boolean;
  seed: number;
}) {
  const reduceMotion = useReducedMotion();
  const legible = revealed || weight > 0;

  if (legible) {
    if (weight <= 0 || reduceMotion) return <span>{text}</span>;

    // Same drift+breathe "alive" motion every other weighted-text surface
    // on the site uses — a word played through PLAY and the same word
    // read normally carry identical emphasis.
    const { driftAmpX, driftAmpY, scaleAmp } = aliveScaleFor(weight);
    const phase1 = seededPhase(seed);
    const phase2 = seededPhase(seed * 7 + 3);
    const driftDurS = 4 + phase1 * 4;
    const scaleDurS = 3 + phase2 * 3;

    return (
      <motion.span
        style={{ display: "inline-block" }}
        animate={{
          x:     [0, driftAmpX, 0, -driftAmpX, 0],
          y:     [0, -driftAmpY, 0, driftAmpY, 0],
          scale: [1, 1 + scaleAmp, 1],
        }}
        transition={{
          x:     { duration: driftDurS,       repeat: Infinity, ease: "easeInOut", delay: phase2 * driftDurS },
          y:     { duration: driftDurS * 1.3, repeat: Infinity, ease: "easeInOut", delay: phase1 * driftDurS },
          scale: { duration: scaleDurS,        repeat: Infinity, ease: "easeInOut", delay: phase1 * scaleDurS },
        }}
      >
        {text}
      </motion.span>
    );
  }

  const masked = maskWord(text);
  if (reduceMotion) return <span style={{ opacity: 0.35 }}>{masked}</span>;

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span style={{ opacity: 0 }}>{masked}</span>
      {[0, 1, 2].map((layerIndex) => (
        <span
          key={layerIndex}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            ...sparkleLayerStyle(seed + layerIndex * 3, layerIndex),
          }}
        >
          {masked}
        </span>
      ))}
    </span>
  );
}
