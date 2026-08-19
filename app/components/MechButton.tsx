"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Mechanical button — hard edges, monospace caps, weighted response.
// A press commits immediately (visual invert) but the actual action lands
// after a short beat, so it reads as being thrown rather than tapped.
// Shared by ReadingJourney's PROCEED/PUSS OUT and /writing's PLAY/BROWSE
// choice — same register everywhere this kind of decision is made. ──

const MONO = '"SF Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace';

// A heavy, decelerating settle — no overshoot. Reused wherever this button
// (or anything transitioning at the same register) needs an easing curve.
export const SETTLE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const SETTLE_EASE_CSS = "cubic-bezier(0.16, 1, 0.3, 1)";

const BUTTON_HOVER_MS = 320; // slow, deliberate — no instant flicker
const BUTTON_PRESS_DELAY_MS = 240; // beat between commit and the action landing

export default function MechButton({
  label, onClick, disabled,
}: { label: string; onClick: () => void; disabled?: boolean }) {
  const [hover, setHover]     = useState(false);
  const [pressed, setPressed] = useState(false);
  const pendingRef = useRef(false);
  const timeoutRef  = useRef<number | null>(null);

  useEffect(() => () => { if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current); }, []);

  const handleActivate = useCallback(() => {
    if (disabled || pendingRef.current) return;
    pendingRef.current = true;
    setPressed(true);
    timeoutRef.current = window.setTimeout(() => {
      pendingRef.current = false;
      setPressed(false);
      onClick();
    }, BUTTON_PRESS_DELAY_MS);
  }, [disabled, onClick]);

  const active = (hover || pressed) && !disabled;

  return (
    <button
      onClick={handleActivate}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily:     MONO,
        fontSize:       "0.75rem",
        fontWeight:     600,
        letterSpacing:  "0.14em",
        textTransform:  "uppercase",
        border:         "1px solid #0a0a0a",
        borderRadius:   0,
        // Opaque at rest, not transparent — this button sits over the fixed
        // 3D terrain backdrop on /writing; a transparent resting state let
        // the mesh show through it, reading as "obscured by the terrain"
        // even where the button was already correctly stacked above it.
        background:     active ? "#0a0a0a" : "#aaff00",
        color:          active ? "#aaff00" : "#0a0a0a",
        padding:        "0.7rem 1.5rem",
        cursor:         disabled ? "default" : "pointer",
        opacity:        disabled ? 0.35 : 1,
        minWidth:       "9rem",
        transform:      pressed ? "scale(0.97)" : "scale(1)",
        transition:     `background-color ${BUTTON_HOVER_MS}ms ${SETTLE_EASE_CSS}, `
                       + `color ${BUTTON_HOVER_MS}ms ${SETTLE_EASE_CSS}, `
                       + `transform ${BUTTON_HOVER_MS}ms ${SETTLE_EASE_CSS}`,
      }}
    >
      {label}
    </button>
  );
}
