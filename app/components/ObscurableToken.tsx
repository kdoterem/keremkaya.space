"use client";

import { motion, useReducedMotion } from "framer-motion";
import { aliveScaleFor, seededPhase } from "@/lib/tagProvenance";

// ── A single word of real provenance — always legible, gets the same
// drift+breathe "alive" motion every other weighted-text surface on the
// site uses. Obscuring/sparkle used to live here too, one word at a
// time; that's ObscurableRun's job now instead — batched per contiguous
// obscured run rather than per word, which is what actually fixed
// PLAY's real performance problem (a typical doorway was running ~280
// continuously-animated sparkle elements at once just to sit there;
// several ran into the thousands). This component only ever renders
// text that's genuinely legible now — weight <= 0 just falls through to
// plain text, which is what the title (PlayRevealText, always legible)
// needs for its untagged words, and what PLAY's own "context" words
// (weight -1 — see PlayPoemBody) render as directly without even
// reaching this component.
export default function ObscurableToken({
  text,
  weight,
  seed,
}: {
  text: string;
  weight: number;
  seed: number;
}) {
  const reduceMotion = useReducedMotion();
  if (weight <= 0 || reduceMotion) return <span>{text}</span>;

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
