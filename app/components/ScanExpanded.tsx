"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { ScanCollection } from "@/lib/scans";

// ── Opening a collection is not a pop-up — no scrim, no separate darker
// room, same ground color as the grid it replaces. The clicked cover becomes
// the hero; the collection's other pages sit beside it as a plain filmstrip,
// Helvetica throughout. The whole thing is sized by flexbox against the
// viewport (see ScansPage: main goes `height: 100dvh` + flex column while a
// collection is open) rather than a guessed vh fraction, so the hero fills
// exactly the space left after the header, no more, no less — it fits one
// screen by construction instead of by tuning a number until it happens to.
// There's no separate "back" control here; ScansPage makes the SCANS
// heading itself clickable while a collection is open, so closing doesn't
// cost its own line of chrome.
const LABEL_STYLE: React.CSSProperties = {
  fontSize:      "0.7rem",
  fontWeight:    500,
  letterSpacing: "0.15em",
  fontVariant:   "small-caps",
  color:         "#0a0a0a",
};

export default function ScanExpanded({
  collection,
  onClose,
}: {
  collection: ScanCollection;
  onClose: () => void;
}) {
  const [heroIndex, setHeroIndex] = useState(0);
  const hero = collection.pages[heroIndex];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setHeroIndex(i => (i + 1) % collection.pages.length);
      if (e.key === "ArrowLeft")  setHeroIndex(i => (i - 1 + collection.pages.length) % collection.pages.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, collection.pages.length]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", width: "100%" }}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: "1.5rem" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={heroIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              position:    "relative",
              height:      "100%",
              maxWidth:    "100%",
              aspectRatio: String(hero.ratio),
              boxShadow:   "0 14px 32px rgba(10,10,10,0.25)",
              flexShrink:  0,
            }}
          >
            <Image
              src={hero.src}
              alt={`${collection.title}, page ${heroIndex + 1}`}
              fill
              sizes="90vw"
              style={{ objectFit: "cover" }}
              priority
            />
          </motion.div>
        </AnimatePresence>

        {collection.pages.length > 1 && (
          <div style={{ display: "flex", flexDirection: "column", flexWrap: "wrap", gap: "0.75rem", height: "100%" }}>
            {collection.pages.map((page, i) => (
              <button
                key={page.src}
                onClick={() => setHeroIndex(i)}
                aria-label={`Page ${i + 1}`}
                style={{
                  position:    "relative",
                  width:       "clamp(56px, 7vw, 84px)",
                  aspectRatio: String(page.ratio),
                  background:  "none",
                  border:      "none",
                  padding:     0,
                  cursor:      "pointer",
                  flexShrink:  0,
                  opacity:     i === heroIndex ? 1 : 0.55,
                  outline:     i === heroIndex ? "2px solid rgba(10,10,10,0.55)" : "none",
                  outlineOffset: "3px",
                  boxShadow:   "0 6px 14px rgba(10,10,10,0.18)",
                }}
              >
                <Image
                  src={page.src}
                  alt={`${collection.title}, page ${i + 1} thumbnail`}
                  fill
                  sizes="84px"
                  style={{ objectFit: "cover" }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <p style={{ ...LABEL_STYLE, opacity: 0.45, marginTop: "0.85rem", flexShrink: 0 }}>
        {collection.title} · {heroIndex + 1}/{collection.pages.length}
      </p>
    </motion.div>
  );
}
