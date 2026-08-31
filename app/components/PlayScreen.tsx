"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import PlayRevealText from "./PlayRevealText";
import PlayPoemBody from "./PlayPoemBody";
import PiecePopup from "./PiecePopup";

// ── PLAY's actual play screen — one (poem, tag) pair. Only the chosen
// tag's provenanced lines are legible on load, each followed immediately
// by its own write-in zone (PlayPoemBody) — writing happens right where
// the thought was, not disconnected in a box at the end. Repeatable by
// design (see the saved-writings list below): this is meant to be
// returned to, not a once-per-poem quiz — which is also why there's no
// "start over" control: nothing here is being graded, so editing a zone
// directly IS starting over.
//
// Two popups (PiecePopup), not a page-state reveal: "see kerem's
// version" and the writing popup SAVE opens both show their piece in the
// same plain reading format /writing itself uses — neither one touches
// the poem's own obscured/write-in state underneath, so closing either
// one always comes back to exactly where writing left off.
//
// Storage is two different things: a `draft` (the live set of zone
// values, autosaves continuously and silently so nothing is lost — keyed
// per poem+tag) and `saved` (only grows when SAVE is explicitly pressed
// — a real history of finished writings at this same doorway, distinct
// from the draft in progress). Both are plain localStorage, no accounts
// on this site, same pattern as useReadingPreference.ts and /kismet.
const DRAFT_KEY_PREFIX    = "kk-play-draft-v2";
const ATTEMPTS_KEY_PREFIX = "kk-play-attempts-v1";

interface SavedWriting {
  id:      string;
  text:    string;
  savedAt: string; // ISO
}

function draftKey(slug: string, tag: string): string {
  return `${DRAFT_KEY_PREFIX}:${slug}:${tag}`;
}
function savedKey(slug: string, tag: string): string {
  return `${ATTEMPTS_KEY_PREFIX}:${slug}:${tag}`;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Every zone's text, in line order, joined into the one string a saved
// writing actually stores — keeps the shape (and the /play/saved archive
// reading it) simple regardless of how many zones a given poem had.
function composeWritingText(zoneValues: Record<string, string>): string {
  return Object.entries(zoneValues)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, v]) => v.trim())
    .filter(Boolean)
    .join("\n\n");
}

export default function PlayScreen({
  slug,
  tag,
  categoryTitle,
  title,
  titleWeights,
  body,
  bodyWeights,
}: {
  slug: string;
  tag: string;
  categoryTitle: string;
  title: string;
  titleWeights: number[] | undefined;
  body: string;
  bodyWeights: number[] | undefined;
}) {
  const [zoneValues, setZoneValues] = useState<Record<string, string>>({});
  const [saved, setSaved]           = useState<SavedWriting[]>([]);
  const [hydrated, setHydrated]     = useState(false);
  const [savedListOpen, setSavedListOpen] = useState(false);
  const [popup, setPopup] = useState<"mine" | "kerem" | null>(null);

  // Load whatever's already there for this exact (poem, tag) doorway.
  // Deliberately after mount, not during render — localStorage doesn't
  // exist during SSR, same reasoning as useReadingPreference.ts.
  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem(draftKey(slug, tag));
      if (rawDraft) setZoneValues(JSON.parse(rawDraft));
      const rawSaved = localStorage.getItem(savedKey(slug, tag));
      if (rawSaved) setSaved(JSON.parse(rawSaved));
    } catch {
      // Private browsing / storage disabled — just start blank.
    }
    setHydrated(true);
  }, [slug, tag]);

  // Silent continuous autosave of the in-progress zone values — only
  // once hydration has actually happened, so the empty initial state
  // never stomps a real stored draft before it's had a chance to load.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (Object.keys(zoneValues).length) {
        localStorage.setItem(draftKey(slug, tag), JSON.stringify(zoneValues));
      } else {
        localStorage.removeItem(draftKey(slug, tag));
      }
    } catch {
      // Storage failed — draft still holds for this page view via state.
    }
  }, [zoneValues, hydrated, slug, tag]);

  const handleZoneChange = useCallback((id: string, value: string) => {
    setZoneValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const composedText = useMemo(() => composeWritingText(zoneValues), [zoneValues]);

  const handleSave = useCallback(() => {
    if (!composedText) return;
    const next: SavedWriting = { id: newId(), text: composedText, savedAt: new Date().toISOString() };
    const updated = [...saved, next];
    setSaved(updated);
    try {
      localStorage.setItem(savedKey(slug, tag), JSON.stringify(updated));
    } catch {
      // Still holds in state for this page view even if it can't persist.
    }
    setPopup("mine");
  }, [composedText, saved, slug, tag]);

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#aaff00",
        color: "#0a0a0a",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        padding: "4rem 5vw 6rem",
      }}
    >
      <Link
        href="/play"
        style={{
          fontSize: "0.7rem",
          fontWeight: 500,
          letterSpacing: "0.15em",
          fontVariant: "small-caps",
          color: "#0a0a0a",
          textDecoration: "none",
          opacity: 0.5,
        }}
      >
        RETURN
      </Link>

      <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "3.5rem" }}>
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
          {categoryTitle} · {tag}
        </p>

        {/* Title is never obscured — it's the reader's orientation for what
            they're looking at, not part of the guessing. Any part of it the
            tag does anchor to still gets the alive-motion treatment. */}
        <h1
          style={{
            fontSize: "clamp(1.6rem, 4vw, 2.4rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            marginBottom: "0.6rem",
          }}
        >
          <PlayRevealText text={title} weights={titleWeights} revealed={true} />
        </h1>

        <p
          style={{
            fontSize: "0.8rem",
            fontStyle: "italic",
            color: "rgba(10,10,10,0.55)",
            marginBottom: "2.5rem",
            maxWidth: "36em",
          }}
        >
          the glittering gaps are yours — write in them, right where the feeling was.
          stuck? tap a glimmer to see what's there.
        </p>

        <div style={{ fontSize: "1.05rem", lineHeight: 1.8, marginBottom: "1.5rem" }}>
          <PlayPoemBody
            text={body}
            weights={bodyWeights}
            zoneValues={zoneValues}
            onZoneChange={handleZoneChange}
          />
        </div>

        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "1rem" }}>
          <button onClick={handleSave} disabled={!composedText} className="export-btn">
            save
          </button>
          <button
            onClick={() => setPopup("kerem")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontSize: "0.8rem",
              fontStyle: "italic",
              color: "rgba(10,10,10,0.55)",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            see kerem's version
          </button>
        </div>

        {saved.length > 0 && (
          <div style={{ marginTop: "2.5rem" }}>
            <button
              onClick={() => setSavedListOpen((v) => !v)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                fontSize: "0.65rem",
                fontWeight: 500,
                letterSpacing: "0.14em",
                fontVariant: "small-caps",
                color: "rgba(10,10,10,0.45)",
              }}
            >
              {savedListOpen ? "hide" : "show"} your {saved.length} saved writing{saved.length === 1 ? "" : "s"} here
            </button>
            {savedListOpen && (
              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {[...saved].reverse().map((a) => (
                  <div key={a.id}>
                    <p style={{ fontSize: "0.7rem", color: "rgba(10,10,10,0.4)", marginBottom: "0.3rem" }}>
                      {fmtDateTime(a.savedAt)}
                    </p>
                    <p style={{ whiteSpace: "pre-wrap", fontSize: "0.95rem", lineHeight: 1.7 }}>
                      {a.text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {popup === "mine" && (
        <PiecePopup label={`your writing · ${tag}`} body={composedText} onClose={() => setPopup(null)} />
      )}
      {popup === "kerem" && (
        <PiecePopup label={`${categoryTitle} · ${tag}`} title={title} body={body} onClose={() => setPopup(null)} />
      )}
    </main>
  );
}
