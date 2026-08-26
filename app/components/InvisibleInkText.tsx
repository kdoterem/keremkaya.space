"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { weightedTintFor } from "@/lib/tagProvenance";

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

// A fine dot-noise texture, not a smooth sweep — a smooth linear gradient
// sliding across text is the exact visual language of loading-skeleton
// placeholders (Facebook/LinkedIn's "content is loading" shimmer); this
// is deliberately jumpy/twinkling instead (see @keyframes ink-twinkle,
// app/globals.css — steps(1, end) makes every transition an instant jump).
const SPARKLE_STYLE: React.CSSProperties = {
  backgroundImage:
    "radial-gradient(circle, rgba(10,10,10,0.55) 0.8px, transparent 0.9px), " +
    "radial-gradient(circle, rgba(10,10,10,0.32) 0.6px, transparent 0.7px)",
  backgroundSize: "5px 5px, 7px 7px",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  animation: "ink-twinkle 1.4s steps(1, end) infinite",
};

// Reading-pace presets. The first version exposed raw words-per-minute
// (90/140/220) — user feedback: "natural" (140) felt too slow, "quick"
// (220) felt too fast, meaning their own comfortable pace sits somewhere
// between the two. Recentered around that gap and simplified to two
// options now that reveal is line-based (see header comment on why line
// granularity is more forgiving of imprecise timing than word granularity
// was) rather than three finicky wpm tiers.
const BASE_SEC_PER_LINE = 0.55;
const SEC_PER_WORD = 0.32;

export const PACE_OPTIONS: { label: string; multiplier: number; hint: string }[] = [
  { label: "unhurried", multiplier: 1.35, hint: "more time per line" },
  { label: "brisk",     multiplier: 0.7,  hint: "less time per line" },
];

function lineDurationMs(wordCount: number, multiplier: number): number {
  return (BASE_SEC_PER_LINE + wordCount * SEC_PER_WORD) * multiplier * 1000;
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
// content gate) and a decorative, aria-hidden sparkle overlay on top that
// fades out when the line's moment arrives. The real layer drops in from
// just above its resting position and settles with a soft spring bounce —
// the "gravity" landing feel — rather than a flat fade.
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
      {animate && (
        <motion.div
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, pointerEvents: "none", ...SPARKLE_STYLE }}
          animate={{ opacity: revealed ? 0 : 1 }}
          transition={{ duration: 0.45 }}
        >
          {text}
        </motion.div>
      )}
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
    return lineInfos.map((info) => {
      if (info.isBlank) return 0;
      cumulative += lineDurationMs(info.wordCount, multiplier);
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
