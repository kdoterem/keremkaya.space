"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MechButton from "./MechButton";
import { getDifficulty } from "@/lib/playDifficulty";
import { getCategoriesForSlug, type PlayCategory } from "@/lib/playCategories";

// ── Shown once, right when a reader clears a tier — before they're
// dropped into the next one's first passage. Same dark-scrim-behind-a-
// bounded-panel register as PlayIntro (a milestone deserves the same
// "this is a different kind of moment" weight the contract gets, not
// the full-bleed lime the write screen and fake-eval ceremony use).
//
// Groups everything completed in that tier by the categories its
// provenance actually touches (lib/playCategories.ts) — a passage
// touching two categories shows up under both, not forced into one.
// Each category gets its own "see what you wrote" disclosure rather
// than dumping all the text at once; passages with no real category
// (a real ~25% of the archive, see lib/playCategories.ts) are counted
// but not expandable — nothing to label them with, so nothing invented.
const HISTORY_KEY = "kk-play-history-v1";

interface HistoryEntry {
  slug: string;
  text: string;
  completedAt: string;
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function CategoryBlock({ category, entries }: { category: PlayCategory; entries: HistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.9rem" }}>
        <span style={{ fontSize: "0.95rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
          {category.title}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: "0.72rem", fontStyle: "italic", color: "rgba(10,10,10,0.5)",
            textDecoration: "underline", textUnderlineOffset: "3px",
          }}
        >
          {open ? "hide" : "see what you wrote"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: "0.7rem", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {entries.map((e, i) => (
            <p key={i} style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", lineHeight: 1.7, color: "rgba(10,10,10,0.75)" }}>
              {e.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlayTierOverview({
  tier,
  onContinue,
}: {
  tier: number;
  onContinue: () => void;
}) {
  // Read once, on mount — this screen only shows right after a
  // completion that changed the tier, so a fresh read is always current.
  const [grouped] = useState(() => {
    const history = readHistory();
    const forTier = history.filter((h) => getDifficulty(h.slug)?.tier === tier);
    const byCategory = new Map<string, { category: PlayCategory; entries: HistoryEntry[] }>();
    let uncategorized = 0;
    for (const entry of forTier) {
      const cats = getCategoriesForSlug(entry.slug);
      if (cats.length === 0) {
        uncategorized++;
        continue;
      }
      for (const c of cats) {
        const bucket = byCategory.get(c.key) ?? { category: c, entries: [] };
        bucket.entries.push(entry);
        byCategory.set(c.key, bucket);
      }
    }
    return { blocks: Array.from(byCategory.values()), uncategorized };
  });

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
            tier {tier} — done
          </p>
          <h1 style={{ fontSize: "clamp(1.5rem, 4vw, 2rem)", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "1.8rem", color: "#0a0a0a" }}>
            {grouped.blocks.length > 0 ? "what you were circling" : "onward"}
          </h1>

          {grouped.blocks.length > 0 ? (
            <div style={{ marginBottom: "1rem" }}>
              {grouped.blocks.map(({ category, entries }) => (
                <CategoryBlock key={category.key} category={category} entries={entries} />
              ))}
            </div>
          ) : (
            <p style={{ fontSize: "0.9rem", color: "rgba(10,10,10,0.6)", marginBottom: "1.5rem" }}>
              nothing here settled into one thread — onward.
            </p>
          )}

          {grouped.uncategorized > 0 && (
            <p style={{ fontSize: "0.78rem", fontStyle: "italic", color: "rgba(10,10,10,0.45)", marginBottom: "2rem" }}>
              plus {grouped.uncategorized} answer{grouped.uncategorized === 1 ? "" : "s"} that weren't circling any one thing in particular.
            </p>
          )}

          <MechButton label="continue" onClick={onContinue} />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
