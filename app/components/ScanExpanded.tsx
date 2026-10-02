"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { ScanCollection } from "@/lib/scans";

// ── Opening a collection is not a pop-up — no scrim, no separate darker
// room, same ground color as the grid it replaces. The clicked cover becomes
// the hero; the collection's other pages sit alongside it as a plain
// filmstrip, Helvetica throughout. There's no separate "back" control here;
// ScansPage makes the SCANS heading itself clickable while a collection is
// open, so closing doesn't cost its own line of chrome.
//
// Two layouts, picked by `narrow` (ScansPage's useIsNarrow, same instance
// driving its own fixed-height/no-scroll choice — kept in one place so they
// can't disagree):
//  - Desktop: hero + filmstrip side by side, hero sized by HEIGHT (100% of
//    the flex row ScansPage hands it), so it fills exactly the space left
//    after the header — fits one screen by construction.
//  - Narrow: there's no width for that — a hero sized to fill the height of
//    a phone screen would need to be wider than the phone. So it stacks:
//    hero sized by WIDTH instead (100% of the column, height follows from
//    its own aspect ratio), filmstrip becomes a horizontal scroll strip
//    beneath it. ScansPage already dropped the no-scroll constraint for
//    this case — stacked content is free to run past one screen and scroll,
//    same as every other page on the site does on mobile.
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
  narrow,
}: {
  collection: ScanCollection;
  onClose: () => void;
  narrow: boolean;
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
      style={
        narrow
          ? { width: "100%" }
          : { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", width: "100%" }
      }
    >
      <div
        style={
          narrow
            ? { display: "flex", flexDirection: "column", gap: "1rem" }
            : { flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: "1.5rem" }
        }
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={heroIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={
              narrow
                ? {
                    position:    "relative",
                    width:       "100%",
                    aspectRatio: String(hero.ratio),
                    boxShadow:   "0 14px 32px rgba(10,10,10,0.47)",
                  }
                : {
                    position:    "relative",
                    height:      "100%",
                    maxWidth:    "100%",
                    aspectRatio: String(hero.ratio),
                    boxShadow:   "0 14px 32px rgba(10,10,10,0.47)",
                    flexShrink:  0,
                  }
            }
          >
            <Image
              src={hero.src}
              alt={`${collection.title}, page ${heroIndex + 1}`}
              fill
              sizes={narrow ? "100vw" : "90vw"}
              style={{ objectFit: "cover" }}
              priority
            />
          </motion.div>
        </AnimatePresence>

        {collection.pages.length > 1 && (
          <div
            style={
              narrow
                ? { display: "flex", flexDirection: "row", gap: "0.65rem", overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: "0.25rem" }
                : { display: "flex", flexDirection: "column", flexWrap: "wrap", gap: "0.75rem", height: "100%" }
            }
          >
            {collection.pages.map((page, i) => (
              <button
                key={page.src}
                onClick={() => setHeroIndex(i)}
                aria-label={`Page ${i + 1}`}
                style={{
                  position:    "relative",
                  width:       narrow ? `calc(68px * ${page.ratio})` : "clamp(56px, 7vw, 84px)",
                  aspectRatio: String(page.ratio),
                  background:  "none",
                  border:      "none",
                  padding:     0,
                  cursor:      "pointer",
                  flexShrink:  0,
                  opacity:     i === heroIndex ? 1 : 0.55,
                  outline:     i === heroIndex ? "2px solid rgba(10,10,10,0.72)" : "none",
                  outlineOffset: "3px",
                  boxShadow:   "0 6px 14px rgba(10,10,10,0.39)",
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
