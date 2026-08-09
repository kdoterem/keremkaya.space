"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CARDS, type Card } from "@/lib/cards";

const STORAGE_KEY = "art:draw";
const WEEK_MS     = 7 * 24 * 60 * 60 * 1000;

interface StoredDraw {
  cards:   Card[];
  drawnAt: number;
}

// Exactly one "double" card, plus two more from everything else (any group,
// including other "double" cards) — no duplicates, order shuffled so the
// guaranteed slot can't be inferred by position.
function drawSpread(): Card[] {
  const doubles    = CARDS.filter(c => c.group === "double");
  const doubleCard = doubles[Math.floor(Math.random() * doubles.length)];
  const remaining  = CARDS.filter(c => c !== doubleCard);
  const rest       = [...remaining].sort(() => Math.random() - 0.5).slice(0, 2);
  return [doubleCard, ...rest].sort(() => Math.random() - 0.5);
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export default function ArtPage() {
  const [loaded,     setLoaded]     = useState(false);
  const [spread,     setSpread]     = useState<Card[] | null>(null);
  const [nextDrawAt, setNextDrawAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: StoredDraw = JSON.parse(raw);
        const elapsed = Date.now() - saved.drawnAt;

        if (elapsed < WEEK_MS) {
          // Within the week — same spread, no redraw.
          setSpread(saved.cards);
          setNextDrawAt(saved.drawnAt + WEEK_MS);
        } else {
          // Lock expired — a fresh spread on this visit, no click required.
          const fresh   = drawSpread();
          const drawnAt = Date.now();
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: fresh, drawnAt }));
          setSpread(fresh);
          setNextDrawAt(drawnAt + WEEK_MS);
        }
      }
      // else: no record at all — true first visit, wait for the click below.
    } catch {
      // localStorage unavailable — behave like a first visit.
    }
    setLoaded(true);
  }, []);

  const handleDraw = useCallback(() => {
    const fresh   = drawSpread();
    const drawnAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: fresh, drawnAt }));
    } catch {
      // ignore — spread still shows for this session even if it can't persist
    }
    setSpread(fresh);
    setNextDrawAt(drawnAt + WEEK_MS);
  }, []);

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw 8rem",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      {/* Back */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
      </div>

      {/* Card spread */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="art-spread"
        style={{ marginTop: "5rem" }}
      >
        {[0, 1, 2].map((i) => {
          const card = spread?.[i];
          return (
            <div key={i} className="art-card">
              {card && (
                <span
                  style={{
                    fontSize:      "clamp(0.95rem, 2.4vw, 1.1rem)",
                    fontWeight:    500,
                    color:         "#0a0a0a",
                    lineHeight:    1.5,
                    letterSpacing: "-0.01em",
                    textAlign:     "left",
                  }}
                >
                  {card.text}
                </span>
              )}
            </div>
          );
        })}
      </motion.div>

      {/* Invite (first visit) / weekly-lock date-stamp */}
      {loaded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          style={{ textAlign: "center", marginTop: "2.5rem" }}
        >
          {!spread ? (
            <button
              onClick={handleDraw}
              className="art-invite"
              style={{
                fontSize:      "0.88rem",
                fontWeight:    500,
                letterSpacing: "0.06em",
              }}
            >
              draw
            </button>
          ) : nextDrawAt ? (
            <p
              style={{
                fontSize:      "0.75rem",
                color:         "rgba(10,10,10,0.4)",
                letterSpacing: "0.05em",
              }}
            >
              next draw available {formatDate(nextDrawAt)}
            </p>
          ) : null}
        </motion.div>
      )}

      {/* Reserved for image export / notes / email — not built yet */}
      <div style={{ minHeight: "6rem" }} />
    </main>
  );
}
