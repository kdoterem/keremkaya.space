"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
//
// The clock is the default, not the only way through: tapping anywhere
// skips the rest of the current wait and reveals the next line right away
// (handleAdvance, below). No formula can know how fast any one person
// actually reads a given line, so rather than keep re-tuning the pace
// itself, the reader gets to decide when a wait's gone on long enough —
// deliberately undocumented on this page itself (no hint, no label), the
// same trust-the-reader-to-find-it register as everything else here; it's
// mentioned once, in passing, in the reading-mode picker's own copy.

// Three independently-phased sparkle layers, stacked — real invisible ink
// (see iMessage's own effect, the reference for this) isn't one dot-noise
// pattern jumping around as a single block, it's many small points of light
// drifting out of sync with each other. A single animated background layer
// can never look like that, however it moves: every dot in it travels in
// lockstep because they're all one layer with one position. So: three
// layers, each its own dot pattern at its own scale, each on its own clock
// — same principle as the homepage tag cloud and AliveWeightedText's
// per-word drift elsewhere on this site, where every "alive" element gets
// its own seededPhase rather than sharing one timer.
//
// Sized and darkened to actually read as dots at a glance, not a faint
// haze — the reference invisible-ink effect is clearly visible texture,
// not a barely-there tint.
const SPARKLE_LAYERS: { image: string; size: string }[] = [
  {
    image:
      "radial-gradient(circle, rgba(10,10,10,0.78) 1.1px, transparent 1.3px), " +
      "radial-gradient(circle, rgba(10,10,10,0.48) 0.85px, transparent 1px)",
    size: "7px 7px, 10px 9px",
  },
  {
    image:
      "radial-gradient(circle, rgba(10,10,10,0.62) 1px, transparent 1.15px), " +
      "radial-gradient(circle, rgba(10,10,10,0.36) 0.75px, transparent 0.9px)",
    size: "9px 11px, 6px 8px",
  },
  {
    image:
      "radial-gradient(circle, rgba(10,10,10,0.50) 0.9px, transparent 1.05px), " +
      "radial-gradient(circle, rgba(10,10,10,0.28) 0.65px, transparent 0.8px)",
    size: "6px 9px, 11px 7px",
  },
];

// Slow and smooth (ease-in-out), not jumpy — see the long comment on
// @keyframes ink-twinkle in app/globals.css for why: a fast discrete jump
// read as text visibly scrambling, not as glitter sitting still. 4-8s per
// cycle is deliberately the same ambient, barely-there-until-you-notice-it
// cadence as AliveWeightedText's own drift (driftDurS = 4 + phase*4) — the
// "up down left right slowly" quality that was asked for. Each layer's
// duration is seeded off the line's own position (stable across
// re-renders, not random each time) and given a *negative* delay — a CSS
// trick that starts an animation as if it had already been running for
// that long, so every layer looks mid-drift from the very first frame
// instead of all three starting together at 0% and only drifting apart
// later.
function sparkleLayerStyle(lineSeed: number, layerIndex: number): React.CSSProperties {
  const layer = SPARKLE_LAYERS[layerIndex];
  const phase = seededPhase(lineSeed * 2.7 + layerIndex * 11.3 + 1);
  const duration = 4 + phase * 4; // 4s – 8s, varies per line and per layer
  const delay = -phase * duration;
  return {
    backgroundImage: layer.image,
    backgroundSize: layer.size,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    animation: `ink-twinkle ${duration}s ease-in-out infinite`,
    animationDelay: `${delay}s`,
  };
}

// Reveal cadence — a line arrives once you've had time to actually finish
// the one before it, gated to that PREVIOUS line's own length. Went through
// an in-between version that revealed the next line partway into the
// current one (a fixed ~3.5-word lookahead, regardless of that line's real
// length) — living with it said otherwise: seeing the next line arrive
// before you'd actually finished reading the current one was distracting,
// not inviting. The wait itself, sized to how much there really was to
// read, is what makes each line's arrival feel considered. A short line is
// read quickly and its successor follows quickly; a long line earns a
// longer wait before the next one lands — proportionate either way, never
// a flat interval that's wrong for most line lengths.
const BASE_SEC_PER_LINE = 0.55;
const SEC_PER_WORD = 0.32;

// One suggested pace, calibrated by the constants above — not a user-facing
// dial. Earlier versions offered a couple of speed presets ("unhurried" /
// "brisk") to choose between; simplified to a single well-tuned default
// alongside the separate "read normally" (fully visible, unpaced) choice —
// see ReadingExperience.tsx. What people wanted was one reveal that felt
// right, not a knob to tune themselves.
//
// 1 read as a little slow on a real device once the reveal was gated to
// each line's own full length (see the comment above) — every line's wait
// got noticeably longer than under the earlier fixed-lookahead version, and
// the overall pace needed to come down a step to compensate. 0.8 rather
// than a bigger cut: the complaint was "a little too slow," not "much too
// slow" — this is a trim, not a rebalance.
export const SUGGESTED_MULTIPLIER = 0.8;

function lineDurationMs(wordCount: number, multiplier: number): number {
  return (BASE_SEC_PER_LINE + wordCount * SEC_PER_WORD) * multiplier * 1000;
}

// How a line ends changes how long its wait should feel. A trailing comma
// is mid-thought — the sentence keeps going onto the next line, so hold the
// reader less; a trailing period is a completed thought — worth an actual
// beat before moving on. Everything else (no punctuation, a line break
// mid-clause, ?, !, etc.) stays at the plain per-word rate above; only
// comma/period were asked for, and guessing at more risks being wrong in
// either direction where nothing was said.
function trailingPunctuationFactor(lineText: string): number {
  const lastChar = lineText.trimEnd().slice(-1);
  if (lastChar === ",") return 0.65;
  if (lastChar === ".") return 1.2;
  return 1;
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
    let cumulative = START_DELAY_MS;
    let prev: { wordCount: number; text: string } | null = null;
    return lineInfos.map((info) => {
      if (info.isBlank) return 0;
      // Gap before THIS line reveals is sized to the line before it — the
      // one the reader's actually reading right now — and nudged by how
      // that line ends (see trailingPunctuationFactor above). Blank stanza
      // gaps don't touch prev, so a break between verses doesn't erase how
      // long (or how it ended) the last real line was.
      if (prev !== null) {
        cumulative += lineDurationMs(prev.wordCount, multiplier) * trailingPunctuationFactor(prev.text);
      }
      prev = { wordCount: info.wordCount, text: info.text };
      return cumulative;
    });
  }, [lineInfos, multiplier]);

  const lastThreshold = thresholds.length ? thresholds[thresholds.length - 1] : 0;
  const [elapsed, setElapsed] = useState(reduceMotion ? Infinity : 0);

  // The clock's "start" instant lives in a ref, not just a closure-local
  // const, specifically so handleAdvance (below) can rewind it — moving
  // start earlier makes every future tick compute a larger elapsed, i.e.
  // fast-forwards the clock, without touching how the tick loop itself
  // works.
  const startRef = useRef(0);

  useEffect(() => {
    if (reduceMotion) {
      setElapsed(Infinity);
      return;
    }
    setElapsed(0);
    startRef.current = Date.now();
    const id = setInterval(() => {
      const e = Date.now() - startRef.current;
      setElapsed(e);
      if (e >= lastThreshold) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [multiplier, text, lastThreshold, reduceMotion]);

  // Tap/click anywhere in the poem to skip whatever's left of the current
  // wait and reveal the next pending line right away — the auto-timer
  // alone can only ever approximate how fast any one person actually reads
  // a given line, and being stuck waiting past when you've already
  // finished is the thing that actually costs attention. Doesn't touch the
  // clock's rate going forward, just fast-forwards it to the next
  // threshold — the reveal after that still lands on its own normal pace.
  // A no-op once nothing's left to reveal (nothing to advance to), and
  // with reduced motion everything's already visible, so there's nothing
  // to skip toward either.
  const handleAdvance = useCallback(() => {
    if (reduceMotion) return;
    const nextThreshold = thresholds.find((t, i) => !lineInfos[i].isBlank && elapsed < t);
    if (nextThreshold === undefined) return;
    startRef.current = Date.now() - nextThreshold;
    setElapsed(nextThreshold);
  }, [thresholds, lineInfos, elapsed, reduceMotion]);

  return (
    <div
      className={className}
      style={{ whiteSpace: "pre-wrap", ...style }}
      onClick={handleAdvance}
    >
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
