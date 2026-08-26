"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { weightedTintFor } from "@/lib/tagProvenance";

// ── Invisible-ink reveal — the whole poem sits in its real layout from the
// first frame (that's the point: you can SEE there's more, further down,
// still shimmering — curiosity about what hasn't unravelled yet, not
// something hidden until you scroll to it), and a wave of word-by-word
// reveal moves through it on its own clock, timed to a reading pace picked
// at the reading-mode prompt. One-way: once a word is revealed it stays
// revealed, no re-hiding mid-read.
//
// Doesn't need provenance data to work at all — every word goes through the
// same shimmer→reveal timeline regardless of tags, so this works on any
// post. Tag-carrying words (when there is provenance data) just keep
// weightedTintFor's color once revealed, as a quiet bonus layer on top —
// see lib/tagProvenance.tsx.

const SHIMMER_GRADIENT =
  "linear-gradient(100deg, rgba(10,10,10,0.10) 30%, rgba(10,10,10,0.55) 50%, rgba(10,10,10,0.10) 70%)";

// A short pause before the cascade starts — a beat to take in the whole
// poem shimmering before anything moves.
const START_DELAY_MS = 600;
const TICK_MS = 100;

// One word. The real text is always in the DOM and always accessible —
// only its `color` toggles between transparent and its final shade, which
// means screen readers, Ctrl+F, and copy/paste all see the complete poem
// immediately regardless of the visual pacing. The shimmer is a separate,
// purely decorative, aria-hidden overlay that fades out on reveal — this
// is a sighted-reading flourish, not a content gate, and it would be bad
// practice to make assistive tech wait through a shimmer to get content
// that was never actually hidden from it.
function InkWord({ word, revealed, tint, animate }: { word: string; revealed: boolean; tint: string; animate: boolean }) {
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span style={{ color: revealed ? tint : "transparent", transition: "color 0.7s ease" }}>
        {word}
      </span>
      {animate && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            color: "transparent",
            backgroundImage: SHIMMER_GRADIENT,
            backgroundSize: "250% 100%",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            animation: revealed ? "none" : "ink-shimmer-sweep 2.4s ease-in-out infinite",
            opacity: revealed ? 0 : 1,
            transition: "opacity 0.7s ease",
          }}
        >
          {word}
        </span>
      )}
    </span>
  );
}

function wordWeightLevel(weights: number[], start: number, len: number): number {
  let max = 0;
  for (let i = start; i < start + len; i++) {
    if (weights[i] !== undefined) max = Math.max(max, weights[i]);
  }
  return max;
}

export default function InvisibleInkText({
  text,
  weights,
  wpm,
  style,
  className,
}: {
  text: string;
  weights: number[] | undefined;
  wpm: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  // Split on whitespace, keeping the whitespace runs (the capturing group)
  // so spacing/newlines render exactly as-is through the parent's
  // white-space: pre-wrap — only non-whitespace tokens count as "words"
  // toward the reveal pace.
  const tokens = text.split(/(\s+)/);
  const totalWords = tokens.filter((t) => t && !/^\s+$/.test(t)).length;

  const [revealedCount, setRevealedCount] = useState(reduceMotion ? totalWords : 0);

  useEffect(() => {
    if (reduceMotion) {
      // Reduced motion: show everything immediately, no cascade, no
      // shimmer animation ever runs — same reasoning as AliveWeightedText's
      // fallback elsewhere in this system.
      setRevealedCount(totalWords);
      return;
    }

    setRevealedCount(0);
    const msPerWord = 60000 / wpm;
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start - START_DELAY_MS;
      const count = Math.max(0, Math.floor(elapsed / msPerWord));
      if (count >= totalWords) {
        setRevealedCount(totalWords);
        clearInterval(id);
      } else {
        setRevealedCount(count);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [wpm, text, totalWords, reduceMotion]);

  let wordIndex = -1;
  let charOffset = 0;

  return (
    <span className={className} style={style}>
      {tokens.map((tok, i) => {
        const start = charOffset;
        charOffset += tok.length;
        if (!tok || /^\s+$/.test(tok)) return <span key={i}>{tok}</span>;

        wordIndex++;
        const revealed = wordIndex < revealedCount;
        const level = weights ? wordWeightLevel(weights, start, tok.length) : 0;
        const tint = level > 0 ? weightedTintFor(level) : "#0a0a0a";
        return <InkWord key={i} word={tok} revealed={revealed} tint={tint} animate={!reduceMotion} />;
      })}
    </span>
  );
}
