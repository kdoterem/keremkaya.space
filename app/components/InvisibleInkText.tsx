"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { weightedTintFor, seededPhase } from "@/lib/tagProvenance";

// ── Invisible-ink reveal, line by line — the whole poem sits in its real
// layout from the first frame (that's the point: you can SEE there's more,
// further down, still shimmering — curiosity about what hasn't unravelled
// yet, not something hidden until you scroll to it), and each verse settles
// into place on its own clock, timed to a reading pace. One-way: once a
// line is revealed it stays revealed, no re-hiding mid-read.
//
// Line, not word: a whole line dropping into place reads as one clear
// gesture; two hundred individual words each doing their own thing reads
// as chaos. It's also more forgiving of imprecise timing — a line gives
// you a real chunk to read at your own pace before the next one lands,
// rather than a ticking per-word rhythm that has to be exactly right to
// feel comfortable.
//
// Doesn't need provenance data to work at all — every line goes through
// the same shimmer→reveal timeline regardless of tags, so this works on
// any post. Tag-carrying words (when there is provenance data) keep
// weightedTintFor's color once their line is revealed, as a quiet bonus
// layer within it — see lib/tagProvenance.tsx.

// Three independently-phased sparkle layers, stacked — real invisible ink
// (see iMessage's own effect, the reference for this) isn't one dot-noise
// pattern jumping around as a single block, it's many small points of light
// twinkling out of sync with each other. A single animated background layer
// can never look like that, however jumpy its own steps are: every dot in
// it moves in lockstep because they're all one layer with one position.
// So: three layers, each its own dot pattern at its own scale, each on its
// own animation clock — same principle as the homepage tag cloud and
// AliveWeightedText's per-word drift elsewhere on this site, where every
// "alive" element gets its own seededPhase rather than sharing one timer.
const SPARKLE_LAYERS: { image: string; size: string }[] = [
  {
    image:
      "radial-gradient(circle, rgba(10,10,10,0.55) 0.8px, transparent 0.9px), " +
      "radial-gradient(circle, rgba(10,10,10,0.30) 0.6px, transparent 0.7px)",
    size: "5px 5px, 7px 7px",
  },
  {
    image:
      "radial-gradient(circle, rgba(10,10,10,0.42) 0.7px, transparent 0.8px), " +
      "radial-gradient(circle, rgba(10,10,10,0.24) 0.55px, transparent 0.65px)",
    size: "6px 8px, 4px 6px",
  },
  {
    image:
      "radial-gradient(circle, rgba(10,10,10,0.34) 0.65px, transparent 0.75px), " +
      "radial-gradient(circle, rgba(10,10,10,0.20) 0.5px, transparent 0.6px)",
    size: "4px 6px, 8px 5px",
  },
];

// steps(1, end) keeps every transition an instant jump rather than a slide —
// a smooth sweep is the exact visual language of loading-skeleton
// placeholders (Facebook/LinkedIn's "content is loading" shimmer), which is
// what this is deliberately avoiding (see @keyframes ink-twinkle,
// app/globals.css). Each layer gets its own duration (seeded off the line's
// own position, so it's stable across re-renders, not random each time) and
// a *negative* delay — a CSS trick that starts an animation as if it had
// already been running for that long, so every layer looks mid-twinkle from
// the very first frame instead of all three starting together at 0% and
// only drifting apart later.
function sparkleLayerStyle(lineSeed: number, layerIndex: number): React.CSSProperties {
  const layer = SPARKLE_LAYERS[layerIndex];
  const phase = seededPhase(lineSeed * 2.7 + layerIndex * 11.3 + 1);
  const duration = 1.1 + phase * 1.1; // 1.1s – 2.2s, varies per line and per layer
  const delay = -phase * duration;
  return {
    backgroundImage: layer.image,
    backgroundSize: layer.size,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    animation: `ink-twinkle ${duration}s steps(1, end) infinite`,
    animationDelay: `${delay}s`,
  };
}

// Reveal cadence — a line arrives once you're roughly this many words into
// the line before it, not once that whole prior line's own reading time has
// fully elapsed. That's the felt difference between "wait for this line to
// finish, then the next one starts" and "the next line is already there,
// waiting for you" — the latter is what was asked for.
//
// A fixed word-count lookahead, not scaled by each line's own length, also
// fixes short lines: under the old full-duration model a 3-word line had
// hardly any duration of its own, so the line after it fired almost
// instantly. Now every line — three words or thirteen — waits the same
// beat before the next one lands.
const LOOKAHEAD_WORDS = 3.5;
const SEC_PER_WORD = 0.32;

export const PACE_OPTIONS: { label: string; multiplier: number; hint: string }[] = [
  { label: "unhurried", multiplier: 1.35, hint: "more time per line" },
  { label: "brisk",     multiplier: 0.7,  hint: "less time per line" },
];

function lineIntervalMs(multiplier: number): number {
  return LOOKAHEAD_WORDS * SEC_PER_WORD * multiplier * 1000;
}

// A short pause before the cascade starts — a beat to take in the whole
// poem shimmering before anything moves.
const START_DELAY_MS = 600;
const TICK_MS = 100;

function wordWeightLevel(weights: number[], start: number, len: number): number {
  let max = 0;
  for (let i = start; i < start + len; i++) {
    if (weights[i] !== undefined) max = Math.max(max, weights[i]);
  }
  return max;
}

// Renders one line's real text with per-word provenance tint — no reveal
// logic of its own, the whole line reveals or doesn't as a unit; this only
// decides each word's color once the line is visible.
function LineContent({ text, weights, lineStart }: { text: string; weights: number[] | undefined; lineStart: number }) {
  if (!weights) return <>{text}</>;
  const tokens = text.split(/(\s+)/);
  let offset = lineStart;
  return (
    <>
      {tokens.map((tok, i) => {
        const start = offset;
        offset += tok.length;
        if (!tok || /^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        const level = wordWeightLevel(weights, start, tok.length);
        if (level <= 0) return <span key={i}>{tok}</span>;
        return <span key={i} style={{ color: weightedTintFor(level) }}>{tok}</span>;
      })}
    </>
  );
}

// One line: a blank line (stanza gap) just holds its own vertical space,
// always "revealed" since there's nothing to show either way. A real line
// renders two stacked layers — the actual text (always in the DOM and
// always accessible; only its opacity/position animate, so screen
// readers/Ctrl+F/copy-paste see the whole poem immediately regardless of
// the visual pacing — the reveal is a sighted-reading flourish, not a
// content gate) and, on top, three decorative aria-hidden sparkle layers
// (see sparkleLayerStyle above) that fade out together when the line's
// moment arrives. The real layer drops in from just above its resting
// position and settles with a soft spring bounce — the "gravity" landing
// feel — rather than a flat fade.
function InkLine({
  text,
  weights,
  lineStart,
  revealed,
  animate,
}: {
  text: string;
  weights: number[] | undefined;
  lineStart: number;
  revealed: boolean;
  animate: boolean;
}) {
  if (!text.trim()) return <div style={{ minHeight: "1em" }}>&nbsp;</div>;

  return (
    <div style={{ position: "relative" }}>
      <motion.div
        initial={false}
        animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : -8 }}
        transition={{ type: "spring", stiffness: 300, damping: 22 }}
      >
        <LineContent text={text} weights={weights} lineStart={lineStart} />
      </motion.div>
      {animate && [0, 1, 2].map((layerIndex) => (
        <motion.div
          key={layerIndex}
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            ...sparkleLayerStyle(lineStart, layerIndex),
          }}
          animate={{ opacity: revealed ? 0 : 1 }}
          transition={{ duration: 0.45 }}
        >
          {text}
        </motion.div>
      ))}
    </div>
  );
}

export default function InvisibleInkText({
  text,
  weights,
  multiplier,
  style,
  className,
}: {
  text: string;
  weights: number[] | undefined;
  multiplier: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  const lineInfos = useMemo(() => {
    const lines = text.split("\n");
    let offset = 0;
    return lines.map((lineText) => {
      const start = offset;
      offset += lineText.length + 1; // +1 for the \n split() consumed
      const wordCount = (lineText.match(/\S+/g) || []).length;
      return { text: lineText, start, wordCount, isBlank: wordCount === 0 };
    });
  }, [text]);

  const thresholds = useMemo(() => {
    const interval = lineIntervalMs(multiplier);
    let cumulative = START_DELAY_MS;
    return lineInfos.map((info) => {
      if (info.isBlank) return 0;
      cumulative += interval;
      return cumulative;
    });
  }, [lineInfos, multiplier]);

  const lastThreshold = thresholds.length ? thresholds[thresholds.length - 1] : 0;
  const [elapsed, setElapsed] = useState(reduceMotion ? Infinity : 0);

  useEffect(() => {
    if (reduceMotion) {
      setElapsed(Infinity);
      return;
    }
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - start;
      setElapsed(e);
      if (e >= lastThreshold) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [multiplier, text, lastThreshold, reduceMotion]);

  return (
    <div className={className} style={{ whiteSpace: "pre-wrap", ...style }}>
      {lineInfos.map((info, i) => (
        <InkLine
          key={i}
          text={info.text}
          weights={weights}
          lineStart={info.start}
          revealed={info.isBlank || elapsed >= thresholds[i]}
          animate={!reduceMotion}
        />
      ))}
    </div>
  );
}
