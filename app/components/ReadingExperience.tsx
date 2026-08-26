"use client";

import { useState } from "react";
import { useReadingPreference, type ReadingPreference } from "@/lib/useReadingPreference";
import InvisibleInkText, { SUGGESTED_MULTIPLIER } from "./InvisibleInkText";
import AliveWeightedText from "./AliveWeightedText";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

// Panel is the site's own lime green (#aaff00), not black — a stark black
// box read as a separate thing dropped onto the page rather than part of
// it. The backdrop behind it stays a dark scrim (dims the page, gives the
// panel something to pop against); the panel itself and all its text now
// use exactly the same palette as everything else on /writing (dark text
// on the site's green, same secondary-text opacities as the tag links and
// date stamp) so it reads as a continuation of the page, not an overlay
// from somewhere else.
function ReadingModeModal({
  onChoose,
  onDismiss,
}: {
  onChoose: (pref: ReadingPreference) => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
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
        aria-labelledby="reading-mode-heading"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "#aaff00",
          color: "#0a0a0a",
          maxWidth: "26rem",
          width: "100%",
          padding: "2rem 1.75rem",
          fontFamily: FONT,
        }}
      >
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Close"
            style={{
              position: "absolute", top: "0.9rem", right: "0.9rem",
              background: "none", border: "none", cursor: "pointer",
              color: "rgba(10,10,10,0.4)", fontSize: "0.9rem", padding: "0.25rem",
            }}
          >
            ×
          </button>
        )}

        <h2 id="reading-mode-heading" style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem", color: "#0a0a0a", letterSpacing: "-0.01em" }}>
          how do you want to read?
        </h2>
        <p style={{ fontSize: "0.8rem", lineHeight: 1.6, color: "rgba(10,10,10,0.6)", marginBottom: "1.5rem" }}>
          poems can unravel themselves as you read, line by line, at a considered pace —
          or just sit there, fully visible, like normal.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
          <button
            onClick={() => onChoose({ mode: "paced", multiplier: SUGGESTED_MULTIPLIER })}
            style={optionButtonStyle}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#0a0a0a"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(10,10,10,0.25)"; }}
          >
            <span style={{ display: "block", fontWeight: 500 }}>read how it&rsquo;s suggested</span>
            <span style={{ display: "block", fontSize: "0.68rem", opacity: 0.6, marginTop: "0.15rem" }}>unravels line by line, one at a time</span>
          </button>
          <button
            onClick={() => onChoose({ mode: "normal" })}
            style={optionButtonStyle}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#0a0a0a"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(10,10,10,0.25)"; }}
          >
            <span style={{ display: "block", fontWeight: 500 }}>read the usual way</span>
            <span style={{ display: "block", fontSize: "0.68rem", opacity: 0.6, marginTop: "0.15rem" }}>fully visible, like normal</span>
          </button>
        </div>

        <p style={{ fontSize: "0.66rem", color: "rgba(10,10,10,0.45)", lineHeight: 1.5 }}>
          change this anytime — look for &ldquo;reading: &hellip;&rdquo; near the top of any poem.
        </p>
      </div>
    </div>
  );
}

const optionButtonStyle: React.CSSProperties = {
  textAlign: "left",
  background: "transparent",
  border: "1px solid rgba(10,10,10,0.25)",
  color: "#0a0a0a",
  padding: "0.65rem 0.85rem",
  fontFamily: FONT,
  fontSize: "0.82rem",
  cursor: "pointer",
  transition: "border-color 0.15s",
};

function ReadingModeControl({ pref, onOpen }: { pref: ReadingPreference; onOpen: () => void }) {
  const label =
    pref.mode === "paced" ? "reading: paced" :
    pref.mode === "normal" ? "reading: normal" :
    "reading: choose";

  return (
    <button
      onClick={onOpen}
      style={{
        fontSize: "0.65rem",
        fontWeight: 500,
        letterSpacing: "0.08em",
        fontVariant: "small-caps",
        color: "rgba(10,10,10,0.4)",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        fontFamily: FONT,
        textDecoration: "underline",
        textUnderlineOffset: "3px",
      }}
    >
      {label} ↻
    </button>
  );
}

// ── The client-side wrapper for a poem's body — owns the reading
// preference, shows the first-visit prompt, renders the "change reading
// mode" control, and switches between the three possible renderings:
//
//   paced   → InvisibleInkText, works on ANY post (provenance optional)
//   normal  → exactly what existed before this feature: AliveWeightedText
//             for the posts with provenance data, plain MDXRemote otherwise
//   unset   → same as normal, until (or unless) the visitor makes a choice
//             — the safe, always-fully-visible default, so a first-time
//             visitor's first paint (and anyone with JS disabled, since
//             mdxContent/the alive fallback are both server-rendered)
//             never depends on this feature working at all.
export default function ReadingExperience({
  bodyText,
  bodyWeights,
  showProvenance,
  mdxContent,
}: {
  bodyText: string;
  bodyWeights: number[] | undefined;
  showProvenance: boolean;
  mdxContent: React.ReactNode;
}) {
  const [pref, setPref] = useReadingPreference();
  const [modalOpen, setModalOpen] = useState(false);

  const showOnboarding = pref.mode === "unset";

  const handleChoose = (next: ReadingPreference) => {
    setPref(next);
    setModalOpen(false);
  };

  return (
    <>
      <div style={{ marginBottom: "1.25rem" }}>
        <ReadingModeControl pref={pref} onOpen={() => setModalOpen(true)} />
      </div>

      {pref.mode === "paced" && pref.multiplier ? (
        <InvisibleInkText text={bodyText} weights={bodyWeights} multiplier={pref.multiplier} />
      ) : showProvenance ? (
        <div style={{ whiteSpace: "pre-wrap" }}>
          <AliveWeightedText text={bodyText} weights={bodyWeights} />
        </div>
      ) : (
        mdxContent
      )}

      {(showOnboarding || modalOpen) && (
        <ReadingModeModal
          onChoose={handleChoose}
          onDismiss={showOnboarding ? undefined : () => setModalOpen(false)}
        />
      )}
    </>
  );
}
