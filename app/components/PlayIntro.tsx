"use client";

import { useState, useLayoutEffect, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import MechButton from "./MechButton";

// ── The contract — shown before a first-time (and, deliberately, every
// return) visit to /play, on the same green full-screen register as the
// fake-eval modal. States what the system actually is and what the
// rules are; says nothing about what happens after submit, since that
// ceremony only works if it isn't pre-announced as theater ("not having
// control" has to be discovered, not read about first).
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
          background: "#aaff00",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        <div style={{ maxWidth: "34rem" }}>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.6rem)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "1.5rem", color: "#0a0a0a" }}>
            before you play
          </h1>
          <div style={{ fontSize: "0.95rem", lineHeight: 1.8, color: "rgba(10,10,10,0.75)", display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2.5rem" }}>
            <p>you'll be given one passage at a time — a real stretch of something I wrote, quoted exactly, stopped somewhere it's still moving.</p>
            <p>write onward from it, however you want. continue it, answer it, argue, drift — there's no wrong way in.</p>
            <p>there's a minimum before you can submit. no maximum — say as much as you need to.</p>
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
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
