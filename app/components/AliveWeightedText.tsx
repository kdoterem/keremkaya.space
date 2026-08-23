"use client";

import { motion, useReducedMotion } from "framer-motion";
import { buildRuns, aliveScaleFor, seededPhase, bodyWeightStyle, ALIVE_REST_COLOR } from "@/lib/tagProvenance";

// ── The living body text — every tag-carrying run drifts, breathes (scale),
// and pulses color, continuously and out of phase with its neighbours, so
// glancing down the poem catches motion ahead of where you're actually
// reading — the lines still to come are visibly alive, not just sitting
// there. Deliberately used for the BODY only; the title stays on the plain,
// static WeightedText (lib/tagProvenance.tsx) so the two kinds of emphasis
// read as genuinely different registers rather than the same trick twice.
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

        const base = bodyWeightStyle(r.weight) ?? {};
        if (reduceMotion) return <span key={i} style={base}>{slice}</span>;

        const { driftAmpX, driftAmpY, scaleAmp, peakColor } = aliveScaleFor(r.weight);
        const phase1 = seededPhase(r.start);
        const phase2 = seededPhase(r.start * 7 + 3);
        const driftDurS = 4   + phase1 * 4;
        const scaleDurS = 3   + phase2 * 3;
        const pulseDurS = 3.5 + phase1 * 3;

        return (
          <motion.span
            key={i}
            style={{ display: "inline-block", ...base }}
            animate={{
              x:     [0, driftAmpX, 0, -driftAmpX, 0],
              y:     [0, -driftAmpY, 0, driftAmpY, 0],
              scale: [1, 1 + scaleAmp, 1],
              color: [ALIVE_REST_COLOR, peakColor, ALIVE_REST_COLOR],
            }}
            transition={{
              x:     { duration: driftDurS,        repeat: Infinity, ease: "easeInOut", delay: phase2 * driftDurS },
              y:     { duration: driftDurS * 1.3,   repeat: Infinity, ease: "easeInOut", delay: phase1 * driftDurS },
              scale: { duration: scaleDurS,         repeat: Infinity, ease: "easeInOut", delay: phase1 * scaleDurS },
              color: { duration: pulseDurS,         repeat: Infinity, ease: "easeInOut", delay: phase2 * pulseDurS },
            }}
          >
            {slice}
          </motion.span>
        );
      })}
    </span>
  );
}
