"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

// ── A genuinely two-tap button: the first tap doesn't commit anything, it
// just displaces the button to a random nearby spot and arms it; only a
// second, real tap on the now-moved button actually fires onCommit. Built
// for "send this to Kerem" specifically — sending someone's private
// writing to an actual person should cost a small, deliberate beat of
// hesitation, not be a one-tap accident. (Not MechButton: that's a single
// press with a delayed-but-guaranteed commit, a different mechanic this
// site already uses elsewhere — this one can be walked away from.)
//
// Disarms on a second tap elsewhere too (clicking off it) rather than
// staying armed forever — an abandoned first tap shouldn't leave a
// landmine sitting nearby for an unrelated later click to trip.

const JUMP_RANGE_PX = 70;
const JUMP_MIN_PX = 24; // never so close it reads as not having moved at all

function randomOffset(): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const dist = JUMP_MIN_PX + Math.random() * (JUMP_RANGE_PX - JUMP_MIN_PX);
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}

export default function DodgeCommitButton({
  label,
  armedLabel,
  onCommit,
  disabled,
  style,
}: {
  label: string;
  armedLabel?: string; // shown once armed, defaults to `label` unchanged
  onCommit: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [armed, setArmed] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const reduceMotion = useReducedMotion();

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (!armed) {
      setOffset(reduceMotion ? { x: 0, y: 0 } : randomOffset());
      setArmed(true);
      return;
    }
    setArmed(false);
    setOffset({ x: 0, y: 0 });
    onCommit();
  }, [armed, disabled, onCommit, reduceMotion]);

  const handleBlur = useCallback(() => {
    // A tap elsewhere disarms rather than leaving a moved button primed
    // for an unrelated click to accidentally commit.
    setArmed(false);
    setOffset({ x: 0, y: 0 });
  }, []);

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      onBlur={handleBlur}
      disabled={disabled}
      animate={{ x: offset.x, y: offset.y }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      style={{
        display: "inline-block",
        background: "none",
        border: "none",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        fontSize: "0.8rem",
        fontStyle: "italic",
        color: "rgba(10,10,10,0.55)",
        textDecoration: "underline",
        textUnderlineOffset: "3px",
        opacity: disabled ? 0.5 : 1,
        position: "relative",
        ...style,
      }}
    >
      {armed ? (armedLabel ?? label) : label}
    </motion.button>
  );
}
