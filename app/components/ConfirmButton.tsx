"use client";

import { useCallback, useState } from "react";

// ── A genuinely two-tap button: the first tap doesn't commit anything,
// it just arms it (and changes its label); only a second, real tap
// commits. Built for "send this to Kerem" specifically — sending
// someone's private writing to an actual person should cost a small,
// deliberate beat of hesitation, not be a one-tap accident. (Not
// MechButton: that's a single press with a delayed-but-guaranteed
// commit, a different mechanic this site already uses elsewhere — this
// one can be walked away from.)
//
// Was a dodge-then-commit button (the first tap displaced it to a random
// nearby spot) — dropped the jump on request, kept the arm/commit
// two-step. Still disarms on a tap elsewhere, so an abandoned first tap
// doesn't leave it primed for an unrelated later click to trip.
export default function ConfirmButton({
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

  const handleClick = useCallback(() => {
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onCommit();
  }, [armed, disabled, onCommit]);

  const handleBlur = useCallback(() => {
    setArmed(false);
  }, []);

  return (
    <button
      type="button"
      onClick={handleClick}
      onBlur={handleBlur}
      disabled={disabled}
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
        ...style,
      }}
    >
      {armed ? (armedLabel ?? label) : label}
    </button>
  );
}
