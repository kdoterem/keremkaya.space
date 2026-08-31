"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import PlayRevealText from "./PlayRevealText";

// ── PLAY's actual play screen — one (poem, tag) pair. Only the chosen
// tag's provenanced spans are legible on load; everything else stays
// glittered until the reader asks to see "Kerem's version." Repeatable by
// design (see the attempts list below): this is meant to be returned to,
// not a once-per-poem quiz.
//
// Storage is two different things, matching what was actually asked for:
// a `draft` (autosaves continuously, silent, just so nothing is lost —
// keyed per poem+tag) and `attempts` (only grows when SAVE is explicitly
// pressed — a real history of finished tries at this same doorway,
// distinct from the draft in progress). Both are plain localStorage,
// no accounts on this site, same pattern as useReadingPreference.ts and
// /kismet.
const DRAFT_KEY_PREFIX    = "kk-play-draft-v1";
const ATTEMPTS_KEY_PREFIX = "kk-play-attempts-v1";

interface SavedAttempt {
  id:      string;
  text:    string;
  savedAt: string; // ISO
}

function draftKey(slug: string, tag: string): string {
  return `${DRAFT_KEY_PREFIX}:${slug}:${tag}`;
}
function attemptsKey(slug: string, tag: string): string {
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

export default function PlayScreen({
  slug,
  tag,
  categoryTitle,
  title,
  titleWeights,
  body,
  bodyWeights,
  backHref,
}: {
  slug: string;
  tag: string;
  categoryTitle: string;
  title: string;
  titleWeights: number[] | undefined;
  body: string;
  bodyWeights: number[] | undefined;
  backHref: string;
}) {
  const [draft, setDraft]         = useState("");
  const [attempts, setAttempts]   = useState<SavedAttempt[]>([]);
  const [hydrated, setHydrated]   = useState(false);
  const [askReveal, setAskReveal] = useState(false);
  const [revealed, setRevealed]   = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [attemptsOpen, setAttemptsOpen] = useState(false);

  // Load whatever's already there for this exact (poem, tag) doorway.
  // Deliberately after mount, not during render — localStorage doesn't
  // exist during SSR, same reasoning as useReadingPreference.ts.
  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem(draftKey(slug, tag));
      if (rawDraft) setDraft(rawDraft);
      const rawAttempts = localStorage.getItem(attemptsKey(slug, tag));
      if (rawAttempts) setAttempts(JSON.parse(rawAttempts));
    } catch {
      // Private browsing / storage disabled — just start blank.
    }
    setHydrated(true);
  }, [slug, tag]);

  // Silent continuous autosave of the in-progress draft — only once
  // hydration has actually happened, so the empty initial state never
  // stomps a real stored draft before it's had a chance to load.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (draft) localStorage.setItem(draftKey(slug, tag), draft);
      else localStorage.removeItem(draftKey(slug, tag));
    } catch {
      // Storage failed — draft still holds for this page view via state.
    }
  }, [draft, hydrated, slug, tag]);

  const handleSave = useCallback(() => {
    if (!draft.trim()) return;
    const next: SavedAttempt = { id: newId(), text: draft, savedAt: new Date().toISOString() };
    const updated = [...attempts, next];
    setAttempts(updated);
    try {
      localStorage.setItem(attemptsKey(slug, tag), JSON.stringify(updated));
    } catch {
      // Still holds in state for this page view even if it can't persist.
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }, [draft, attempts, slug, tag]);

  const handleDone = useCallback(() => {
    setAskReveal(true);
  }, []);

  const startAnother = useCallback(() => {
    setDraft("");
    setAskReveal(false);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#fff",
        color: "#0a0a0a",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        padding: "4rem 5vw 6rem",
      }}
    >
      <Link
        href={backHref}
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
        ← {tag.toUpperCase()}
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

        <h1
          style={{
            fontSize: "clamp(1.6rem, 4vw, 2.4rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            marginBottom: "2.5rem",
          }}
        >
          <PlayRevealText text={title} weights={titleWeights} revealed={revealed} />
        </h1>

        <div style={{ fontSize: "1.05rem", lineHeight: 1.8, marginBottom: "3rem" }}>
          <PlayRevealText text={body} weights={bodyWeights} revealed={revealed} />
        </div>

        {!revealed && (
          <>
            <label
              style={{
                display: "block",
                fontSize: "0.65rem",
                fontWeight: 500,
                letterSpacing: "0.14em",
                fontVariant: "small-caps",
                color: "rgba(10,10,10,0.45)",
                marginBottom: "0.6rem",
              }}
            >
              your own continuation
            </label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="write from what's visible…"
              rows={8}
              style={{
                width: "100%",
                fontFamily: "inherit",
                fontSize: "1rem",
                lineHeight: 1.7,
                color: "#0a0a0a",
                background: "transparent",
                border: "1px solid rgba(10,10,10,0.18)",
                borderRadius: "4px",
                padding: "0.9rem 1rem",
                resize: "vertical",
                marginBottom: "1rem",
              }}
            />

            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={handleSave} disabled={!draft.trim()} className="export-btn">
                save
              </button>
              <button onClick={handleDone} disabled={!draft.trim()} className="export-btn">
                done — compare
              </button>
              {savedFlash && (
                <span style={{ fontSize: "0.7rem", color: "rgba(10,10,10,0.5)", fontStyle: "italic" }}>
                  saved.
                </span>
              )}
            </div>
          </>
        )}

        {askReveal && !revealed && (
          <div
            style={{
              marginTop: "2rem",
              paddingTop: "1.5rem",
              borderTop: "1px solid rgba(10,10,10,0.12)",
            }}
          >
            <p style={{ fontSize: "0.95rem", marginBottom: "1rem" }}>
              want to see Kerem's version?
            </p>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={() => setRevealed(true)} className="export-btn">
                yes, show me
              </button>
              <button onClick={() => setAskReveal(false)} className="export-btn">
                not yet
              </button>
            </div>
          </div>
        )}

        {revealed && (
          <div
            style={{
              marginTop: "1rem",
              paddingTop: "1.5rem",
              borderTop: "1px solid rgba(10,10,10,0.12)",
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
            }}
          >
            <button onClick={startAnother} className="export-btn">
              write another attempt
            </button>
            <Link
              href={backHref}
              className="export-btn"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              try a different poem
            </Link>
          </div>
        )}

        {attempts.length > 0 && (
          <div style={{ marginTop: "2.5rem" }}>
            <button
              onClick={() => setAttemptsOpen((v) => !v)}
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
              {attemptsOpen ? "hide" : "show"} your {attempts.length} saved attempt{attempts.length === 1 ? "" : "s"} here
            </button>
            {attemptsOpen && (
              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {[...attempts].reverse().map((a) => (
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
    </main>
  );
}
