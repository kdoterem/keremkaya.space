"use client";

import { motion, useReducedMotion } from "framer-motion";
import { buildRuns, aliveScaleFor, seededPhase } from "@/lib/tagProvenance";
import { SPARKLE_LAYERS, sparkleLayerStyle } from "./InvisibleInkText";

// ── PLAY's obscure/reveal — the counterpart to InvisibleInkText's timed
// line-by-line reveal, but permanent rather than clock-driven: a run is
// either the chosen tag's (always legible, alive-motion, same as every
// other surface) or it isn't (glitters under the same three-layer sparkle
// InvisibleInkText uses, and stays that way) until `revealed` flips true —
// the "show me Kerem's version" moment, not a timer.
//
// Non-tag runs are masked to a run of "•" (one per non-whitespace
// character, real whitespace/line breaks left alone so layout and stanza
// spacing still read correctly) before the sparkle treatment ever sees
// them — unlike InvisibleInkText's own real-text-underneath approach
// (fine there: everything reveals on its own regardless), here the point
// is a genuine withholding, and the real words shouldn't be sitting
// selectable/inspectable under an opacity trick while still marked
// "hidden." The one caveat: this masking happens client-side off the real
// `text` prop, so the real words are still present in the page's own
// payload for anyone who goes looking — same tradeoff InvisibleInkText
// already accepts, not a new one. Revealing is one click away with zero
// gate anyway, so this isn't trying to be airtight, just not carelessly
// leaky.
function maskRun(slice: string): string {
  return slice.replace(/\S/g, "•");
}

export default function PlayRevealText({
  text,
  weights,
  revealed,
  style,
  className,
}: {
  text: string;
  weights: number[] | undefined;
  revealed: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const runs = weights
    ? buildRuns(text.length, weights)
    : [{ start: 0, end: text.length, weight: 0 }];

  return (
    <div className={className} style={{ whiteSpace: "pre-wrap", ...style }}>
      {runs.map((r, i) => {
        const slice = text.slice(r.start, r.end);
        const isTagRun = r.weight > 0;

        // Revealed, or this run is the chosen tag's own — legible either
        // way. Tag runs additionally get the same drift+breathe "alive"
        // motion as every other weighted-text surface on the site, so a
        // poem played through PLAY and the same poem read normally carry
        // identical emphasis on the same words.
        if (revealed || isTagRun) {
          if (!isTagRun || reduceMotion) return <span key={i}>{slice}</span>;

          const { driftAmpX, driftAmpY, scaleAmp } = aliveScaleFor(r.weight);
          const phase1 = seededPhase(r.start);
          const phase2 = seededPhase(r.start * 7 + 3);
          const driftDurS = 4 + phase1 * 4;
          const scaleDurS = 3 + phase2 * 3;

          return (
            <motion.span
              key={i}
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
              {slice}
            </motion.span>
          );
        }

        // Obscured. Reduced motion: a flat redacted block rather than a
        // still shimmer — no animation to fall back to, but still must
        // not read as blank/missing text.
        const masked = maskRun(slice);
        if (reduceMotion) {
          return (
            <span key={i} style={{ opacity: 0.35 }}>
              {masked}
            </span>
          );
        }

        return (
          <span key={i} style={{ position: "relative", display: "inline" }}>
            <span style={{ opacity: 0 }}>{masked}</span>
            {[0, 1, 2].map((layerIndex) => (
              <span
                key={layerIndex}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  ...sparkleLayerStyle(r.start + layerIndex * SPARKLE_LAYERS.length, layerIndex),
                }}
              >
                {masked}
              </span>
            ))}
          </span>
        );
      })}
    </div>
  );
}
