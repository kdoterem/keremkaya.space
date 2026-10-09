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
// Each run is cut into the pieces that can safely be an inline-block: never
// across a newline (an inline-block holding a "\n" becomes a multi-line box
// sitting inline after the previous word — the-dictator's closing triplet
// rendered as a staircase off the end of "pre-dictated"), and never with
// leading/trailing whitespace inside it (trailing spaces collapse in a
// shrink-to-fit box, so "against" and "those" ended up touching). Pieces of
// the same run share its phase, so they still move as one. Unweighted text
// is split at whitespace too, so wherever a run boundary falls mid-word
// ("pre-dictated" + its comma at a different weight), the touching pieces
// can be glued with nowrap — otherwise the gap between two inline-blocks is
// a legal line break and the comma wraps onto its own line on a phone.
type Piece = { text: string; weight: number; runStart: number } | { ws: string };

function toPieces(text: string, weights: number[]): Piece[] {
  const pieces: Piece[] = [];
  for (const r of buildRuns(text.length, weights)) {
    for (const part of text.slice(r.start, r.end).split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { pieces.push({ ws: part }); continue; }
      const prev = pieces[pieces.length - 1];
      // Keep a weighted run's inner spaces inside one box (fewer animated
      // nodes, and it drifts as a phrase): merge "word ws word" of the same run.
      if (r.weight > 0 && pieces.length >= 2) {
        const before = pieces[pieces.length - 2];
        if (prev && "ws" in prev && !prev.ws.includes("\n") && "text" in before && before.runStart === r.start) {
          pieces.splice(pieces.length - 2, 2, { ...before, text: before.text + prev.ws + part });
          continue;
        }
      }
      pieces.push({ text: part, weight: r.weight, runStart: r.start });
    }
  }
  return pieces;
}

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

  const renderPiece = (p: Exclude<Piece, { ws: string }>, key: number) => {
    if (p.weight <= 0) return <span key={key}>{p.text}</span>;

    const tint = weightedTintFor(p.weight);

    if (reduceMotion) {
      return <span key={key} style={{ color: tint, ...(bodyWeightStyle(p.weight) ?? {}) }}>{p.text}</span>;
    }

    const { driftAmpX, driftAmpY, scaleAmp } = aliveScaleFor(p.weight);
    const phase1 = seededPhase(p.runStart);
    const phase2 = seededPhase(p.runStart * 7 + 3);
    const driftDurS = 4 + phase1 * 4;
    const scaleDurS = 3 + phase2 * 3;

    return (
      <motion.span
        key={key}
        style={{ display: "inline-block", whiteSpace: "pre-wrap", color: tint }}
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
        {p.text}
      </motion.span>
    );
  };

  // Consecutive non-whitespace pieces touch with no space between them —
  // one visual word, so glue them.
  const out: React.ReactNode[] = [];
  const pieces = toPieces(text, weights);
  let i = 0;
  while (i < pieces.length) {
    const p = pieces[i];
    if ("ws" in p) { out.push(p.ws); i++; continue; }
    let j = i + 1;
    while (j < pieces.length && !("ws" in pieces[j])) j++;
    const group = pieces.slice(i, j) as Exclude<Piece, { ws: string }>[];
    out.push(
      group.length === 1
        ? renderPiece(group[0], i)
        : <span key={i} style={{ whiteSpace: "nowrap" }}>{group.map((g, k) => renderPiece(g, i * 1000 + k))}</span>
    );
    i = j;
  }

  return <span className={className} style={style}>{out}</span>;
}
