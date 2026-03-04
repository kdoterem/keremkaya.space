"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function useScrambleReveal(text: string, startDelay: number, duration = 600) {
  const [displayed, setDisplayed] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setActive(true), startDelay);
    return () => clearTimeout(t);
  }, [startDelay]);

  useEffect(() => {
    if (!active) return;
    let raf: number;
    let start: number | null = null;

    const run = (now: number) => {
      if (start === null) start = now;
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const lockIndex = Math.floor(progress * text.length);

      setDisplayed(
        text.split("").map((char, i) => {
          if (char === " ") return " ";
          if (i < lockIndex) return char;
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        }).join("")
      );

      if (progress < 1) raf = requestAnimationFrame(run);
      else setDisplayed(text);
    };

    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [active, text, duration]);

  return displayed;
}

export default function NotFound() {
  const line1 = useScrambleReveal("nothing here.", 0);
  const line2 = useScrambleReveal("you may have followed a broken link.", 300);

  return (
    <main
      style={{
        minHeight:      "100vh",
        display:        "flex",
        flexDirection:  "column",
        justifyContent: "center",
        padding:        "4rem 5vw",
        fontFamily:     '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      <Link
        href="/"
        style={{
          position:      "absolute",
          top:           "2.5rem",
          left:          "3rem",
          fontSize:      "0.7rem",
          fontWeight:    500,
          letterSpacing: "0.15em",
          fontVariant:   "small-caps",
          color:         "#0a0a0a",
          textDecoration: "none",
          opacity:       0.5,
        }}
      >
        RETURN
      </Link>

      <div style={{ maxWidth: "640px" }}>
        <p
          style={{
            fontSize:      "clamp(1.8rem, 5vw, 3rem)",
            fontWeight:    700,
            letterSpacing: "-0.02em",
            lineHeight:    1.1,
            color:         "#0a0a0a",
            marginBottom:  "1.2rem",
          }}
        >
          {line1 || "\u00A0"}
        </p>

        <p
          style={{
            fontSize:      "clamp(1rem, 2.5vw, 1.4rem)",
            fontWeight:    400,
            letterSpacing: "0.01em",
            lineHeight:    1.5,
            color:         "rgba(10,10,10,0.5)",
          }}
        >
          {line2 || "\u00A0"}
        </p>
      </div>
    </main>
  );
}
