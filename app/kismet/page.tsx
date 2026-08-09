"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CARDS, type Card } from "@/lib/cards";
import CryptoScramble from "@/app/components/CryptoScramble";

const STORAGE_KEY = "art:draw";
const LOCK_DAYS   = 7;

const LABEL             = "draw";
const DISSOLVE_MS       = 700;  // button breaking apart, before cards begin
const CARD_STAGGER_MS   = 500;  // fixed gap between each card's reveal starting
const CARD_SCRAMBLE_MS  = 1100; // per-card resolve — noticeably longer than /writing's 500ms
const CARD_TICK_MS      = 75;   // glyph substitution rate — legible cycling, not noise (60-90ms range)
// Symbol pool, not letters — random lowercase letters read as garbled fake
// words ("fire war xvbtw"); a single repeated dot was too static. Non-alphabetic
// glyphs sit between the two: a classic decryption look that can't be misread
// as language. Spaces still pass through as spaces (see CryptoScramble).
const CARD_CHARS        = "!@#$%^&*()_+-=[]{}|;:,.<>?/~█▓▒░┃╱╲╳";

interface StoredDraw {
  cards:   Card[];
  drawnAt: number;
}

// pending  — still reading localStorage, nothing rendered yet (avoids a flash)
// invite   — true first-ever visit, empty boxes + draw button
// dissolving — button breaking apart after a click, cards not drawn yet
// revealing  — a fresh spread (from a click, or a just-expired lock) scrambling in one at a time
// static     — an existing, still-locked spread — shown instantly, no animation, no button
type Phase = "pending" | "invite" | "dissolving" | "revealing" | "static";

interface Particle { dx: number; dy: number; rot: number }

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

// Local midnight, `days` days after the calendar day `ts` falls on — so a
// lock always expires at the start of a day rather than at the exact
// time-of-day someone happened to draw (draw at 11pm, still unlock at
// midnight seven days later, not 11pm).
function startOfLocalDayPlus(ts: number, days: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

const cardTextStyle: React.CSSProperties = {
  fontSize:      "clamp(1.3rem, 6vw, 1.85rem)",
  fontWeight:    600,
  color:         "#0a0a0a",
  lineHeight:    1.25,
  letterSpacing: "-0.015em",
  textAlign:     "left",
};

export default function ArtPage() {
  const [phase,      setPhase]      = useState<Phase>("pending");
  const [spread,     setSpread]     = useState<Card[] | null>(null);
  const [nextDrawAt, setNextDrawAt] = useState<number | null>(null);
  const [particles,  setParticles]  = useState<Particle[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);

  const revealTimeouts = useRef<number[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: StoredDraw = JSON.parse(raw);
        const unlockAt = startOfLocalDayPlus(saved.drawnAt, LOCK_DAYS);

        if (Date.now() < unlockAt) {
          // Within the week — same spread, shown instantly. No redraw, no animation.
          setSpread(saved.cards);
          setNextDrawAt(unlockAt);
          setPhase("static");
        } else {
          // Lock expired — a fresh spread on this visit, no click required, but it's
          // still a real draw, so it gets the same scramble-in as a clicked one.
          const fresh   = drawSpread();
          const drawnAt = Date.now();
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: fresh, drawnAt }));
          setSpread(fresh);
          setNextDrawAt(startOfLocalDayPlus(drawnAt, LOCK_DAYS));
          setPhase("revealing");
        }
      } else {
        setPhase("invite");
      }
    } catch {
      setPhase("invite");
    }
  }, []);

  // Stagger the three cards' reveals whenever a fresh draw starts resolving —
  // a fixed beat so the spread lands as one movement: one, two, three.
  useEffect(() => {
    if (phase !== "revealing") return;
    setRevealedCount(0);
    revealTimeouts.current.forEach(clearTimeout);
    revealTimeouts.current = [0, 1, 2].map(i =>
      window.setTimeout(() => setRevealedCount(c => Math.max(c, i + 1)), i * CARD_STAGGER_MS)
    );
    return () => { revealTimeouts.current.forEach(clearTimeout); revealTimeouts.current = []; };
  }, [phase]);

  const handleDraw = useCallback(() => {
    // Letters scatter like ash — random drift, rotation, and shrink, each
    // slightly offset so the word breaks apart rather than vanishing at once.
    setParticles(
      LABEL.split("").map(() => ({
        dx:  (Math.random() - 0.5) * 70,
        dy:  -20 - Math.random() * 55,
        rot: (Math.random() - 0.5) * 200,
      }))
    );
    setPhase("dissolving");

    window.setTimeout(() => {
      const fresh   = drawSpread();
      const drawnAt = Date.now();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ cards: fresh, drawnAt }));
      } catch {
        // ignore — spread still shows for this session even if it can't persist
      }
      setSpread(fresh);
      setNextDrawAt(startOfLocalDayPlus(drawnAt, LOCK_DAYS));
      setPhase("revealing");
    }, DISSOLVE_MS);
  }, []);

  const showButton  = phase === "invite" || phase === "dissolving";
  const showDateLine = (phase === "revealing" || phase === "static") && nextDrawAt !== null;

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
              {phase === "static" && card && (
                <span style={cardTextStyle}>{card.text}</span>
              )}
              {phase === "revealing" && card && i < revealedCount && (
                <CryptoScramble
                  text={card.text}
                  duration={CARD_SCRAMBLE_MS}
                  tickMs={CARD_TICK_MS}
                  chars={CARD_CHARS}
                  style={cardTextStyle}
                />
              )}
            </div>
          );
        })}
      </motion.div>

      {/* Invite (first visit) / weekly-lock date-stamp */}
      {(showButton || showDateLine) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          style={{ textAlign: "center", marginTop: "2.5rem" }}
        >
          {showButton ? (
            <button
              onClick={phase === "invite" ? handleDraw : undefined}
              disabled={phase === "dissolving"}
              className="art-invite"
              style={{
                fontSize:      "0.88rem",
                fontWeight:    500,
                letterSpacing: "0.06em",
                display:       "inline-flex",
                cursor:        phase === "dissolving" ? "default" : "pointer",
              }}
            >
              {LABEL.split("").map((ch, i) => (
                <motion.span
                  key={i}
                  style={{ display: "inline-block" }}
                  animate={
                    phase === "dissolving"
                      ? {
                          opacity: 0,
                          x:       particles[i]?.dx ?? 0,
                          y:       particles[i]?.dy ?? 0,
                          rotate:  particles[i]?.rot ?? 0,
                          scale:   0.3,
                        }
                      : { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }
                  }
                  transition={{ duration: DISSOLVE_MS / 1000, ease: "easeOut", delay: i * 0.04 }}
                >
                  {ch}
                </motion.span>
              ))}
            </button>
          ) : nextDrawAt ? (
            <p
              style={{
                fontSize:      "0.75rem",
                color:         "rgba(10,10,10,0.4)",
                letterSpacing: "0.05em",
              }}
            >
              one draw a week. next: {formatDate(nextDrawAt)}
            </p>
          ) : null}
        </motion.div>
      )}

      {/* Reserved for image export / notes / email — not built yet */}
      <div style={{ minHeight: "6rem" }} />
    </main>
  );
}
