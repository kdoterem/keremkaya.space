"use client";

import { useEffect } from "react";

// ── Shared modal chrome for PLAY's two "read it properly" moments — your
// own writing and Kerem's real version — same lime-panel-over-dark-scrim
// language as ReadingModeModal (app/components/ReadingExperience.tsx), so
// this reads as one more piece of the same site's own vocabulary rather
// than a new pattern invented for this one feature.
export default function PiecePopup({
  label,
  title,
  body,
  onClose,
}: {
  label: string;
  title?: string;
  body: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        background: "rgba(10,10,10,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "#aaff00",
          color: "#0a0a0a",
          maxWidth: "36rem",
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          padding: "2.5rem 2rem",
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: "1rem", right: "1rem",
            background: "none", border: "none", cursor: "pointer",
            color: "rgba(10,10,10,0.4)", fontSize: "1.1rem", padding: "0.25rem",
          }}
        >
          ×
        </button>

        <p
          style={{
            fontSize: "0.65rem",
            fontWeight: 500,
            letterSpacing: "0.14em",
            fontVariant: "small-caps",
            color: "rgba(10,10,10,0.45)",
            marginBottom: "0.6rem",
          }}
        >
          {label}
        </p>
        {title && (
          <h2
            style={{
              fontSize: "clamp(1.4rem, 3.5vw, 2rem)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
              marginBottom: "1.5rem",
            }}
          >
            {title}
          </h2>
        )}
        <div style={{ whiteSpace: "pre-wrap", fontSize: "1.05rem", lineHeight: 1.8 }}>
          {body}
        </div>
      </div>
    </div>
  );
}
