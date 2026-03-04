"use client";

import { useEffect, useRef, useState } from "react";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

interface Props {
  text: string;
  trigger?: number; // re-trigger when this increments
  duration?: number; // ms
  style?: React.CSSProperties;
}

export default function CryptoScramble({
  text,
  trigger,
  duration = 700,
  style,
}: Props) {
  const [displayed, setDisplayed] = useState(text);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = null;

    const run = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Reveal left-to-right: characters before index are locked, rest are random
      const lockIndex = Math.floor(progress * text.length);
      const result = text
        .split("")
        .map((char, i) => {
          if (char === " ") return " ";
          if (i < lockIndex) return char;
          return CHARS[Math.floor(Math.random() * CHARS.length)];
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
  }, [text, trigger, duration]);

  return <span style={style}>{displayed}</span>;
}
