"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

interface AnswerMeta {
  slug:     string;
  question: string;
  answer:   string;
  date:     string;
}

export default function AnswersPage() {
  const [answers, setAnswers] = useState<AnswerMeta[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/answers").then(r => r.json()).then(setAnswers);
  }, []);

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      <Link
        href="/"
        style={{
          fontSize:       "0.7rem",
          fontWeight:     500,
          letterSpacing:  "0.15em",
          fontVariant:    "small-caps",
          color:          "#0a0a0a",
          textDecoration: "none",
          opacity:        0.5,
        }}
      >
        RETURN
      </Link>

      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        style={{
          fontSize:      "clamp(2rem, 5vw, 3.5rem)",
          fontWeight:    700,
          letterSpacing: "-0.02em",
          color:         "#0a0a0a",
          marginTop:     "2.5rem",
          marginBottom:  "3rem",
        }}
      >
        ANSWERS
      </motion.h2>

      <div style={{ display: "flex", flexDirection: "column", maxWidth: "720px" }}>
        {answers.map((a) => {
          const isHovered = hovered === a.slug;
          return (
            <Link
              key={a.slug}
              href={`/answers/${a.slug}`}
              style={{ textDecoration: "none" }}
              onMouseEnter={() => setHovered(a.slug)}
              onMouseLeave={() => setHovered(null)}
            >
              <motion.div
                animate={{ backgroundColor: isHovered ? "#0a0a0a" : "rgba(0,0,0,0)" }}
                transition={{ duration: 0.15 }}
                style={{
                  padding:      "1.1rem 1rem",
                  cursor:       "pointer",
                  borderBottom: "1px solid rgba(10,10,10,0.08)",
                }}
              >
                <div
                  style={{
                    fontSize:      "clamp(0.95rem, 2.2vw, 1.1rem)",
                    fontWeight:    500,
                    color:         isHovered ? "#aaff00" : "#0a0a0a",
                    letterSpacing: "-0.01em",
                    transition:    "color 0.15s",
                    marginBottom:  "0.3rem",
                  }}
                >
                  {a.question}
                </div>
                <div
                  style={{
                    fontSize:      "0.82rem",
                    color:         isHovered ? "rgba(170,255,0,0.7)" : "rgba(10,10,10,0.4)",
                    letterSpacing: "0.01em",
                    transition:    "color 0.15s",
                    fontStyle:     "italic",
                  }}
                >
                  {a.answer.length > 80 ? a.answer.slice(0, 80) + "…" : a.answer}
                </div>
              </motion.div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
