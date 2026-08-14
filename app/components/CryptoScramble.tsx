"use client";

import { useEffect, useRef, useState } from "react";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

interface Props {
  text: string;
  trigger?: number; // re-trigger when this increments
  duration?: number; // ms — total reveal time
  tickMs?: number; // ms between random-glyph substitutions; 0 = every frame (default, original behaviour)
  chars?: string; // glyph pool to draw random substitutions from
  // If true, the unresolved region is broken into randomly-sized chunks
  // (2-9 chars) with a space between each, instead of mirroring the real
  // word boundaries — keeps normal wrapping without spelling out real word
  // shapes. Default false = original behaviour: real spaces always shown.
  scrambleSpaces?: boolean;
  // Never resolves — every character stays randomised forever at tickMs,
  // ignoring duration/lockIndex entirely. text still sets the fixed length.
  infinite?: boolean;
  // Fires each time the glyph pool actually refreshes (every tickMs) — lets
  // a caller drive something else off the same jump, rather than running an
  // independent, out-of-phase timer of its own.
  onTick?: () => void;
  // If provided, the tick interval is read from tickMsRef.current every
  // frame instead of the fixed tickMs prop — lets a caller change the rate
  // continuously (e.g. driven by cursor proximity) without restarting the
  // scramble on every update, which passing a changing tickMs prop would do
  // (the effect below depends on it). tickMs is still used as the seed value
  // before the ref's first write.
  tickMsRef?: React.MutableRefObject<number>;
  // If set (via either prop), only this many positions are re-rolled per
  // tick instead of the whole string — the rest hold their current glyph.
  // Selection is biased toward the neighbours of whichever positions
  // changed last tick, so activity reads as travelling through the text
  // rather than flickering evenly. Omit both to keep the original
  // reroll-everything-every-tick behaviour.
  churnCount?: number;
  churnCountRef?: React.MutableRefObject<number>;
  style?:     React.CSSProperties;
  className?: string;
}

// Weighted sample of `count` distinct positions out of `length`, biased
// toward prevActive and its immediate neighbours (weight boosted, never
// zero elsewhere) — a soft random walk rather than a hard-confined one, so
// the "current" can still occasionally seed somewhere new.
function pickChurnIndices(length: number, count: number, prevActive: number[]): number[] {
  const n = Math.max(0, Math.min(count, length));
  if (n === 0) return [];
  const weights = new Array(length).fill(1);
  for (const p of prevActive) {
    for (const idx of [p - 1, p, p + 1]) {
      if (idx >= 0 && idx < length) weights[idx] += 6;
    }
  }
  const chosen = new Set<number>();
  let guard = 0;
  while (chosen.size < n && guard < n * 25) {
    guard++;
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let idx = length - 1;
    for (let i = 0; i < length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }
    chosen.add(idx);
  }
  return Array.from(chosen);
}

// 2-9 non-space characters per chunk, decorrelated from the text's real
// word lengths, each chunk separated by one fake space.
function buildFakeSpaceMask(length: number): boolean[] {
  const mask = new Array(length).fill(false);
  let i = 0;
  while (i < length) {
    const chunkLen = 2 + Math.floor(Math.random() * 8); // 2..9
    i += chunkLen;
    if (i < length) {
      mask[i] = true;
      i += 1;
    }
  }
  return mask;
}

export default function CryptoScramble({
  text,
  trigger,
  duration = 700,
  tickMs = 0,
  chars = CHARS,
  scrambleSpaces = false,
  infinite = false,
  onTick,
  tickMsRef,
  churnCount,
  churnCountRef,
  style,
  className,
}: Props) {
  const [displayed, setDisplayed] = useState(text);
  const rafRef      = useRef<number | null>(null);
  const startRef     = useRef<number | null>(null);
  const lastTickRef  = useRef(0);
  const glyphsRef    = useRef<string[]>([]);
  const fakeMaskRef  = useRef<boolean[]>([]);
  const activeRef    = useRef<number[]>([]); // positions changed on the most recent tick — biases the next one

  const partial = churnCount != null || churnCountRef != null;

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current  = null;
    lastTickRef.current = 0;
    glyphsRef.current = text.split("").map(() => chars[Math.floor(Math.random() * chars.length)]);
    activeRef.current = [];
    // Chunk boundaries computed once per run and held fixed for its
    // duration — they must not jitter every tick.
    fakeMaskRef.current = scrambleSpaces ? buildFakeSpaceMask(text.length) : [];

    const run = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = infinite ? 0 : Math.min(elapsed / duration, 1);

      // Reveal left-to-right: characters before index are locked, rest are
      // random. infinite mode never locks anything — lockIndex stays 0.
      const lockIndex = infinite ? 0 : Math.floor(progress * text.length);

      // Random glyphs only churn every tickMs — at tickMs=0 this is every
      // frame (unchanged default behaviour); slower rates keep each
      // substitution on screen long enough to read as a character. Reading
      // tickMsRef.current (when given) fresh every frame, rather than the
      // value tickMs held when the effect last (re)started, is what lets
      // the interval itself change live.
      const activeTickMs = tickMsRef ? tickMsRef.current : tickMs;
      if (now - lastTickRef.current >= activeTickMs) {
        lastTickRef.current = now;
        if (partial) {
          // Hold everything except a small, neighbour-biased subset — the
          // rest of the string keeps whatever glyph it already had.
          const count = churnCountRef ? churnCountRef.current : (churnCount ?? text.length);
          const indices = pickChurnIndices(text.length, Math.round(count), activeRef.current);
          for (const idx of indices) {
            glyphsRef.current[idx] = chars[Math.floor(Math.random() * chars.length)];
          }
          activeRef.current = indices;
        } else {
          glyphsRef.current = text.split("").map(() => chars[Math.floor(Math.random() * chars.length)]);
        }
        onTick?.();
      }

      const result = text
        .split("")
        .map((char, i) => {
          if (i < lockIndex) return char; // resolved — always the real character
          if (!scrambleSpaces) return char === " " ? " " : glyphsRef.current[i];
          return fakeMaskRef.current[i] ? " " : glyphsRef.current[i];
        })
        .join("");

      setDisplayed(result);

      if (infinite || progress < 1) {
        rafRef.current = requestAnimationFrame(run);
      } else {
        setDisplayed(text);
      }
    };

    rafRef.current = requestAnimationFrame(run);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [text, trigger, duration, tickMs, chars, scrambleSpaces, infinite, onTick, tickMsRef, partial, churnCount, churnCountRef]);

  return <span className={className} style={style}>{displayed}</span>;
}
