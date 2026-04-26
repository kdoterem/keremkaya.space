"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const LINES = [
  { text: "kdoterem@gmail.com",    type: "email",     delay: 0   },
  { text: "instagram @kdoterem",  type: "instagram", delay: 300 },
  { text: "don't make it weird.", type: "plain",     delay: 700 },
];

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
      const elapsed   = now - start;
      const progress  = Math.min(elapsed / duration, 1);
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

function ContactLine({ text, type, delay }: { text: string; type: string; delay: number }) {
  const displayed = useScrambleReveal(text, delay);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const style: React.CSSProperties = {
    fontSize:      "clamp(1.1rem, 3vw, 1.8rem)",
    fontWeight:    500,
    lineHeight:    1.4,
    letterSpacing: "0.02em",
    fontFamily:    '"Helvetica Neue", Helvetica, Arial, sans-serif',
    color:         "#0a0a0a",
    display:       "block",
    marginBottom:  "1.2rem",
    opacity:       visible ? 1 : 0,
    transition:    "opacity 0.15s",
    textDecoration:      "underline",
    textDecorationColor: "rgba(10,10,10,0.25)",
    textUnderlineOffset: "3px",
    cursor:        "pointer",
  };

  if (type === "email") {
    return <a href="mailto:kdoterem@gmail.com" style={style}>{displayed || "\u00A0"}</a>;
  }

  if (type === "instagram") {
    return (
      <a href="https://instagram.com/kdoterem" target="_blank" rel="noopener noreferrer" style={style}>
        {displayed || "\u00A0"}
      </a>
    );
  }

  return (
    <span style={{ ...style, textDecoration: "none", cursor: "default", fontWeight: 400 }}>
      {displayed || "\u00A0"}
    </span>
  );
}

export default function FindMePage() {
  return (
    <main
      style={{
        minHeight:   "100vh",
        display:     "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding:     "4rem 5vw",
        fontFamily:  '"Helvetica Neue", Helvetica, Arial, sans-serif',
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
        {LINES.map((line, i) => (
          <ContactLine key={i} text={line.text} type={line.type} delay={line.delay} />
        ))}
        <a
          href="/feed.xml"
          style={{
            fontSize:            "clamp(1.1rem, 3vw, 1.8rem)",
            fontWeight:          500,
            lineHeight:          1.4,
            letterSpacing:       "0.02em",
            fontFamily:          '"Helvetica Neue", Helvetica, Arial, sans-serif',
            color:               "#0a0a0a",
            display:             "block",
            marginBottom:        "0.4rem",
            textDecoration:      "underline",
            textDecorationColor: "rgba(10,10,10,0.25)",
            textUnderlineOffset: "3px",
          }}
        >
          quiet follow — rss
        </a>
        <span style={{
          fontSize:      "0.85rem",
          fontWeight:    400,
          color:         "#0a0a0a",
          opacity:       0.45,
          display:       "block",
          marginBottom:  "1.2rem",
          fontFamily:    '"Helvetica Neue", Helvetica, Arial, sans-serif',
        }}>
          (paste in a feed reader)
        </span>
      </div>
    </main>
  );
}
