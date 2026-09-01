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
// first rendered as truly blank rather than glittering. A single word
// never wraps onto two lines on its own, so doing this per-word instead
// of per-run sidesteps the bug entirely rather than working around it.
//
// The sparkle is clipped to this word's own real letterforms — same
// technique, same look as the /writing reader's own reveal
// (InvisibleInkText) — rather than a placeholder glyph standing in for
// it. Real text does mean it's sitting in the page's own payload for
// anyone who goes looking, same tradeoff InvisibleInkText already
// accepts; the point was never to be airtight, just to look and feel
// like the rest of the site instead of a second, different effect.
//
// Clickable when it isn't real provenance (onToggle) — a stuck reader can
// peek one word without asking for the whole poem, and tap it again to
// put it back, since a peek is exploratory, not a commitment the way an
// actual provenanced word is.
export default function ObscurableToken({
  text,
  weight,
  revealed,
  seed,
  onToggle,
}: {
  text: string;
  weight: number;
  revealed: boolean;
  seed: number;
  onToggle?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const legible = revealed || weight > 0;

  if (legible) {
    // Legible only because it's been peeked (weight <= 0, revealed forced
    // true by the caller) — still toggleable, unlike real provenance.
    if (weight <= 0) {
      return (
        <span
          onClick={onToggle}
          style={{
            cursor: onToggle ? "pointer" : undefined,
            textDecoration: onToggle ? "underline" : undefined,
            textDecorationColor: "rgba(10,10,10,0.22)",
            textUnderlineOffset: "3px",
          }}
        >
          {text}
        </span>
      );
    }
    if (reduceMotion) return <span>{text}</span>;

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

  if (reduceMotion) {
    return (
      <span onClick={onToggle} style={{ opacity: 0.35, cursor: onToggle ? "pointer" : undefined }}>
        {text}
      </span>
    );
  }

  return (
    <span
      onClick={onToggle}
      style={{ position: "relative", display: "inline-block", cursor: onToggle ? "pointer" : undefined }}
    >
      <span style={{ opacity: 0 }}>{text}</span>
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
          {text}
        </span>
      ))}
    </span>
  );
}
