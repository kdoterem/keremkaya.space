"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import LandingTerrain from "@/app/components/LandingTerrain";
import ReadingJourney from "@/app/components/ReadingJourney";
import BrowseView from "@/app/components/BrowseView";

// ── /writing — the terrain is the landing. TAKE THE JOURNEY (leading to
// PLAY/BROWSE) is temporarily removed from this page while the terrain
// itself is being iterated on — it was sitting spatially on top of the
// old full-viewport 3D backdrop, which is exactly what broke both the
// drag-to-rotate interaction (its own empty space silently ate the pointer
// events meant for the canvas underneath) and the occlusion bug (the mesh
// painting over it). The terrain is now a normal, bounded, in-flow block
// instead of a full-page backdrop, which removes that spatial overlap
// entirely. The mode state machine, ReadingJourney, and BrowseView are all
// left wired up and untouched below — dormant without their entry point,
// ready to reconnect the instant the button returns in a later pass. ──

interface PoemTextProfile { words: number; lineLens: number[]; punctDensity: number; capsRatio: number; repetition: number }
interface TerrainMonth { month: string; count: number; words: number; poems: PoemTextProfile[] }
interface SearchDoc { slug: string; title: string; date: string; tags: string[]; body: string }

type Mode = "landing" | "choice" | "play" | "browse-range" | "browse-month";

const PROSE = '"Helvetica Neue", Helvetica, Arial, sans-serif';

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

  const terrainDim = mode === "browse-month";

  const orderedMonths = useMemo(() => months, [months]);

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw 6rem",
        fontFamily: PROSE,
      }}
    >
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

      {/* A normal, bounded, in-flow block now — sized and centred by its
          own component styles, with visible green margin on all sides.
          Nothing else on the page spatially overlaps it. */}
      {mode !== "play" && months.length > 0 && (
        <LandingTerrain months={orderedMonths} dim={terrainDim} />
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
