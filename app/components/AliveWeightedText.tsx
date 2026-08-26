"use client";

import { motion, useReducedMotion } from "framer-motion";
import { buildRuns, aliveScaleFor, seededPhase, bodyWeightStyle, weightedTintFor } from "@/lib/tagProvenance";

// ── The living body text — every tag-carrying run drifts and breathes
// (scale), continuously and out of phase with its neighbours, so glancing
// down the poem catches motion ahead of where you're actually reading —
// the lines still to come are visibly alive, not just sitting there.
// Deliberately used for the BODY only; the title stays on the plain,
// static WeightedText (lib/tagProvenance.tsx) so the two kinds of emphasis
// read as genuinely different registers rather than the same trick twice.
//
// No font-weight/size bump when motion is actually playing — the
// drift+breathe alone is the "alive" signal now; a static heavier/bigger
// look on top of it read as visually "as black as the title." bodyWeightStyle
// only still applies as the prefers-reduced-motion fallback below, so those
// readers still get *some* indication when there's no motion to carry it.
//
// Color IS applied, but as a fixed value, not animated — weightedTintFor
// (lib/tagProvenance.tsx) blends a modest, level-scaled amount of the
// site's own accent green into near-black, quiet enough to not read as
// "blacked out" the way the bold title does.
//
// Motion is driven by aliveScaleFor/seededPhase — the same functions the
// share-image video export uses — so a reader who saves a poem gets back
// the same visual vocabulary they were just reading, not an approximation
// of it. seededPhase is deterministic (keyed off each run's own text
// offset), so re-renders never reshuffle a run's phase mid-read.
//
// weightStyle is hardcoded to bodyWeightStyle (imported directly, not
// accepted as a prop) rather than passed in from the caller — the caller,
// app/writing/[slug]/page.tsx, is a Server Component, and this is a Client
// Component ("use client" above); a function prop can't cross that
// boundary — Next.js can't serialize it, and rendering this page threw a
// server-side exception on every post that has provenance data until this
// was caught. Since this component is body-only by design (see above),
// hardcoding it isn't a real loss of flexibility.
export default function AliveWeightedText({
  text,
  weights,
  style,
  className,
}: {
  text: string;
  weights: number[] | undefined;
  style?: React.CSSProperties;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (!weights) return <span className={className} style={style}>{text}</span>;
  const runs = buildRuns(text.length, weights);

  return (
    <span className={className} style={style}>
      {runs.map((r, i) => {
        const slice = text.slice(r.start, r.end);
        if (r.weight <= 0) return <span key={i}>{slice}</span>;

        const tint = weightedTintFor(r.weight);

        if (reduceMotion) {
          return <span key={i} style={{ color: tint, ...(bodyWeightStyle(r.weight) ?? {}) }}>{slice}</span>;
        }

        const { driftAmpX, driftAmpY, scaleAmp } = aliveScaleFor(r.weight);
        const phase1 = seededPhase(r.start);
        const phase2 = seededPhase(r.start * 7 + 3);
        const driftDurS = 4 + phase1 * 4;
        const scaleDurS = 3 + phase2 * 3;

        return (
          <motion.span
            key={i}
            style={{ display: "inline-block", color: tint }}
            animate={{
              x:     [0, driftAmpX, 0, -driftAmpX, 0],
              y:     [0, -driftAmpY, 0, driftAmpY, 0],
              scale: [1, 1 + scaleAmp, 1],
            }}
            transition={{
              x:     { duration: driftDurS,      repeat: Infinity, ease: "easeInOut", delay: phase2 * driftDurS },
              y:     { duration: driftDurS * 1.3, repeat: Infinity, ease: "easeInOut", delay: phase1 * driftDurS },
              scale: { duration: scaleDurS,       repeat: Infinity, ease: "easeInOut", delay: phase1 * scaleDurS },
            }}
          >
            {slice}
          </motion.span>
        );
      })}
    </span>
  );
}
