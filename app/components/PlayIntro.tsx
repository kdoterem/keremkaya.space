"use client";

import { useState, useLayoutEffect, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import MechButton from "./MechButton";

// ── The contract — shown before a first-time (and, deliberately, every
// return) visit to /play. States what the system actually is and what
// the rules are; says nothing about what happens after submit, since
// that ceremony only works if it isn't pre-announced as theater ("not
// having control" has to be discovered, not read about first).
//
// Deliberately NOT the full-bleed lime takeover every other PLAY screen
// uses (the write screen, the fake-eval modal) — that register is for
// being immersed IN something. A contract is something you look AT, so
// it borrows PiecePopup's language instead: a dark scrim behind a
// bounded panel, the site's own existing "this is weightier" pattern.
// Matching the write screen would have made this read as just another
// poem-shaped block of text, no more consequential than anything else
// on the page. No backdrop-click-to-close either, unlike PiecePopup —
// a contract shouldn't be dismissible by accident.
//
// Two ways out, on purpose: "begin" only dismisses for this visit — by
// default the contract shows again next time, like something you keep
// re-agreeing to rather than a one-off tutorial. "don't remind me
// again" is the actual opt-out, small and quiet on purpose (this is a
// choice to stop seeing it, not the main action).
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
const DISMISSED_KEY = "kk-play-intro-dismissed-v1";

export default function PlayIntro() {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useIsomorphicLayoutEffect(() => {
    try {
      setOpen(localStorage.getItem(DISMISSED_KEY) !== "1");
    } catch {
      setOpen(true);
    }
    setHydrated(true);
  }, []);

  const begin = () => setOpen(false);
  const dontRemind = () => {
    setOpen(false);
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Shows again next visit if it can't persist — not worth surfacing.
    }
  };

  if (!hydrated || !open) return null;

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 400,
          background: "rgba(10,10,10,0.72)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          style={{
            background: "#aaff00",
            border: "1px solid rgba(10,10,10,0.2)",
            maxWidth: "34rem",
            width: "100%",
            maxHeight: "85vh",
            overflowY: "auto",
            padding: "2.5rem",
          }}
        >
          <p style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.14em", fontVariant: "small-caps", color: "rgba(10,10,10,0.45)", marginBottom: "1rem" }}>
            PLAY — before you begin
          </p>
          <h1 style={{ fontSize: "clamp(1.6rem, 4vw, 2.2rem)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "1.5rem", color: "#0a0a0a" }}>
            the terms are simple
          </h1>
          <div style={{ fontSize: "0.95rem", lineHeight: 1.8, color: "rgba(10,10,10,0.75)", display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2.5rem" }}>
            <p>you'll be given one passage at a time — a real stretch of something I wrote, quoted exactly, stopped somewhere it's still moving.</p>
            <p>write onward from it, however you want. continue it, answer it, argue, drift — there's no wrong way in.</p>
            <p>there's a minimum before you can submit. no maximum — say as much as you need to.</p>
            <p>passages get harder to answer as you go — four tiers, each unlocking once you've cleared enough of the last.</p>
            <p>everything you write autosaves to this browser as you go. you can also send what you write straight to me, if you want. never required.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "flex-start" }}>
            <MechButton label="begin" onClick={begin} />
            <button
              onClick={dontRemind}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: "0.75rem",
                fontStyle: "italic",
                color: "rgba(10,10,10,0.45)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              }}
            >
              don't remind me again
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
