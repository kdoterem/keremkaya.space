"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import CryptoScramble from "@/app/components/CryptoScramble";
import MechButton, { SETTLE_EASE } from "@/app/components/MechButton";
import LandingTerrain from "@/app/components/LandingTerrain";
import ReadingJourney from "@/app/components/ReadingJourney";
import BrowseView from "@/app/components/BrowseView";

// ── /writing — the terrain is the landing, not a destination reached by
// clicking something. TAKE THE JOURNEY leads to a real choice: PLAY (the
// full reading journey, unchanged, just relocated) or BROWSE (a plainer,
// game-free "just let me read" mode, new). The flat chronological list
// this page used to be is gone — position on the range now carries the
// same meaning age used to erase in a list: an old, heavy entry is a
// mountain, not something that sank to the bottom. ──

interface TerrainMonth { month: string; count: number; words: number }
interface SearchDoc { slug: string; title: string; date: string; tags: string[]; body: string }

type Mode = "landing" | "choice" | "play" | "browse-range" | "browse-month";

const PROSE = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO  = '"SF Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace';

const TITLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&";
const TITLE_TICK_MS = 220; // same register as the tag-field core's resting churn
const TITLE_CHURN   = 1;   // one letter at a time — legible, just not still

const DODGE_RANGE = 64; // px the button can jump on its first click

let _monthsCache: TerrainMonth[] | null = null;
let _docsCache: SearchDoc[] | null = null;

function groupByMonth(docs: SearchDoc[]): Map<string, SearchDoc[]> {
  const map = new Map<string, SearchDoc[]>();
  for (const d of docs) {
    const key = d.date.slice(0, 7);
    if (!key) continue;
    const arr = map.get(key) ?? [];
    arr.push(d);
    map.set(key, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
  return map;
}

export default function WritingPage() {
  const [months, setMonths] = useState<TerrainMonth[]>(_monthsCache ?? []);
  const [postsByMonth, setPostsByMonth] = useState<Map<string, SearchDoc[]>>(
    _docsCache ? groupByMonth(_docsCache) : new Map(),
  );

  const [mode, setMode] = useState<Mode>("landing");
  const [browseMonth, setBrowseMonth] = useState<string | null>(null);

  const [dodged, setDodged] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!_monthsCache) {
      fetch("/api/terrain").then(r => r.json()).then((m: TerrainMonth[]) => {
        _monthsCache = m;
        setMonths(m);
      });
    }
    if (!_docsCache) {
      fetch("/api/search-index").then(r => r.json()).then((docs: SearchDoc[]) => {
        _docsCache = docs;
        setPostsByMonth(groupByMonth(docs));
      });
    }
  }, []);

  // Reset the button's dodge every time landing is (re)entered, so it's
  // fresh — not still sitting wherever it jumped to last time.
  useEffect(() => {
    if (mode === "landing") { setDodged(false); setOffset({ x: 0, y: 0 }); }
  }, [mode]);

  const handleTakeJourneyClick = useCallback(() => {
    if (!dodged) {
      const dx = (Math.random() - 0.5) * 2 * DODGE_RANGE;
      const dy = (Math.random() - 0.5) * 2 * DODGE_RANGE;
      setOffset({ x: dx, y: dy });
      setDodged(true);
      return;
    }
    setMode("choice");
  }, [dodged]);

  const handleMonthClick = useCallback((month: string) => {
    const posts = postsByMonth.get(month);
    if (!posts || posts.length === 0) return; // empty months aren't a real destination
    setBrowseMonth(month);
    setMode("browse-month");
  }, [postsByMonth]);

  const showTopReturn = mode === "landing" || mode === "choice" || mode === "browse-range";
  const showTitle     = mode === "landing" || mode === "choice" || mode === "browse-range";
  const terrainDim    = mode === "browse-month";
  const terrainClickable = mode === "browse-range";

  const orderedMonths = useMemo(() => months, [months]);

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw 6rem",
        fontFamily: PROSE,
      }}
    >
      {showTopReturn && (
        <Link
          href="/"
          style={{
            fontSize:       "0.7rem",
            fontWeight:     500,
            letterSpacing:  "0.15em",
            fontVariant:    "small-caps",
            color:          "#0a0a0a",
            textDecoration: "none",
            opacity:        0.5,
          }}
        >
          RETURN
        </Link>
      )}

      {showTitle && (
        <h2
          style={{
            fontSize:      "clamp(2rem, 5vw, 3.5rem)",
            fontWeight:    700,
            letterSpacing: "-0.02em",
            color:         "#0a0a0a",
            marginTop:     "2.5rem",
            marginBottom:  "2.5rem",
          }}
        >
          <CryptoScramble
            text="WRITING"
            infinite
            tickMs={TITLE_TICK_MS}
            churnCount={TITLE_CHURN}
            chars={TITLE_CHARS}
          />
        </h2>
      )}

      {/* One continuous LandingTerrain instance across landing/choice/browse —
          never remounted between them, so the fader's position (and its
          inertia mid-settle) survives the reader moving between modes
          instead of resetting to full-visibility every time. Only PLAY
          replaces it outright, with its own position-driven rendering. */}
      {mode !== "play" && months.length > 0 && (
        <LandingTerrain
          months={orderedMonths}
          dim={terrainDim}
          onMonthClick={terrainClickable ? handleMonthClick : undefined}
        />
      )}

      {(mode === "landing" || mode === "choice" || mode === "browse-range") && months.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", marginTop: "2.5rem", minHeight: "3.5rem" }}>
          {mode === "landing" && (
            <motion.button
              onClick={handleTakeJourneyClick}
              animate={{ x: offset.x, y: offset.y }}
              transition={{ duration: 0.35, ease: SETTLE_EASE }}
              whileHover={{ backgroundColor: "#0a0a0a", color: "#aaff00" }}
              style={{
                fontFamily:      MONO,
                fontSize:        "0.8rem",
                fontWeight:      600,
                letterSpacing:   "0.12em",
                textTransform:   "uppercase",
                background:      "transparent",
                border:          "1px solid #0a0a0a",
                color:           "#0a0a0a",
                padding:         "0.75rem 1.75rem",
                cursor:          "pointer",
                transition:      `background-color 0.2s, color 0.2s`,
              }}
            >
              Take the journey
            </motion.button>
          )}

          {mode === "choice" && (
            <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap", justifyContent: "center" }}>
              <MechButton label="Play" onClick={() => setMode("play")} />
              <MechButton label="Browse" onClick={() => setMode("browse-range")} />
            </div>
          )}

          {mode === "browse-range" && (
            <span style={{ fontSize: "0.7rem", letterSpacing: "0.08em", color: "rgba(10,10,10,0.4)" }}>
              tap a month on the terrain to read it
            </span>
          )}
        </div>
      )}

      {mode === "play" && (
        <div style={{ marginTop: "1.5rem" }}>
          <ReadingJourney onExit={() => setMode("landing")} />
        </div>
      )}

      {mode === "browse-month" && browseMonth && (
        <div style={{ marginTop: "2.5rem" }}>
          <BrowseView
            months={orderedMonths}
            postsByMonth={postsByMonth}
            month={browseMonth}
            onNavigate={(m) => setBrowseMonth(m)}
            onReturn={() => setMode("browse-range")}
          />
        </div>
      )}
    </main>
  );
}
