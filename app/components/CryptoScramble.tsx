"use client";

import { useEffect, useRef, useState } from "react";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

interface Props {
  text: string;
  trigger?: number; // re-trigger when this increments
  duration?: number; // ms — total reveal time
  tickMs?: number; // ms between random-glyph substitutions; 0 = every frame (default, original behaviour)
  chars?: string; // glyph pool to draw random substitutions from
  style?: React.CSSProperties;
}

export default function CryptoScramble({
  text,
  trigger,
  duration = 700,
  tickMs = 0,
  chars = CHARS,
  style,
}: Props) {
  const [displayed, setDisplayed] = useState(text);
  const rafRef      = useRef<number | null>(null);
  const startRef     = useRef<number | null>(null);
  const lastTickRef  = useRef(0);
  const glyphsRef    = useRef<string[]>([]);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current  = null;
    lastTickRef.current = 0;
    glyphsRef.current = text.split("").map(() => chars[Math.floor(Math.random() * chars.length)]);

    const run = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Reveal left-to-right: characters before index are locked, rest are random
      const lockIndex = Math.floor(progress * text.length);

      // Random glyphs only churn every tickMs — at tickMs=0 this is every
      // frame (unchanged default behaviour); slower rates keep each
      // substitution on screen long enough to read as a character.
      if (now - lastTickRef.current >= tickMs) {
        lastTickRef.current = now;
        glyphsRef.current = text.split("").map(() => chars[Math.floor(Math.random() * chars.length)]);
      }

      const result = text
        .split("")
        .map((char, i) => {
          if (char === " ") return " ";
          if (i < lockIndex) return char;
          return glyphsRef.current[i];
        })
        .join("");

      setDisplayed(result);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(run);
      } else {
        setDisplayed(text);
      }
    };

    rafRef.current = requestAnimationFrame(run);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [text, trigger, duration, tickMs, chars]);

  return <span style={style}>{displayed}</span>;
}
