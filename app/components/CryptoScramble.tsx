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
  style?:     React.CSSProperties;
  className?: string;
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
  style,
  className,
}: Props) {
  const [displayed, setDisplayed] = useState(text);
  const rafRef      = useRef<number | null>(null);
  const startRef     = useRef<number | null>(null);
  const lastTickRef  = useRef(0);
  const glyphsRef    = useRef<string[]>([]);
  const fakeMaskRef  = useRef<boolean[]>([]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current  = null;
    lastTickRef.current = 0;
    glyphsRef.current = text.split("").map(() => chars[Math.floor(Math.random() * chars.length)]);
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
      // substitution on screen long enough to read as a character.
      if (now - lastTickRef.current >= tickMs) {
        lastTickRef.current = now;
        glyphsRef.current = text.split("").map(() => chars[Math.floor(Math.random() * chars.length)]);
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
  }, [text, trigger, duration, tickMs, chars, scrambleSpaces, infinite, onTick]);

  return <span className={className} style={style}>{displayed}</span>;
}
