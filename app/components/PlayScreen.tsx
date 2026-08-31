"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import PlayRevealText from "./PlayRevealText";
import PlayPoemBody from "./PlayPoemBody";

// ── PLAY's actual play screen — one (poem, tag) pair. Only the chosen
// tag's provenanced lines are legible on load, each followed immediately
// by its own glittered write-in zone (PlayPoemBody) — writing happens
// right where the thought was, not disconnected in a box at the end.
// Repeatable by design (see the attempts list below): this is meant to
// be returned to, not a once-per-poem quiz.
//
// Storage is two different things, matching what was actually asked for:
// a `draft` (the live set of zone values, autosaves continuously and
// silently so nothing is lost — keyed per poem+tag) and `attempts` (only
// grows when SAVE is explicitly pressed — a real history of finished
// tries at this same doorway, distinct from the draft in progress). Both
// are plain localStorage, no accounts on this site, same pattern as
// useReadingPreference.ts and /kismet.
const DRAFT_KEY_PREFIX    = "kk-play-draft-v2";
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

// Every zone's text, in line order, joined into the one string an
// attempt actually stores — keeps the saved-attempt shape (and the
// /play/saved archive reading it) simple regardless of how many zones a
// given poem happened to have.
function composeAttemptText(zoneValues: Record<string, string>): string {
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
  const [zoneValues, setZoneValues] = useState<Record<string, string>>({});
  const [attempts, setAttempts]     = useState<SavedAttempt[]>([]);
  const [hydrated, setHydrated]     = useState(false);
  const [revealed, setRevealed]     = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [attemptsOpen, setAttemptsOpen] = useState(false);

  // Load whatever's already there for this exact (poem, tag) doorway.
  // Deliberately after mount, not during render — localStorage doesn't
  // exist during SSR, same reasoning as useReadingPreference.ts.
  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem(draftKey(slug, tag));
      if (rawDraft) setZoneValues(JSON.parse(rawDraft));
      const rawAttempts = localStorage.getItem(attemptsKey(slug, tag));
      if (rawAttempts) setAttempts(JSON.parse(rawAttempts));
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

  const composedText = useMemo(() => composeAttemptText(zoneValues), [zoneValues]);

  const handleSave = useCallback(() => {
    if (!composedText) return;
    const next: SavedAttempt = { id: newId(), text: composedText, savedAt: new Date().toISOString() };
    const updated = [...attempts, next];
    setAttempts(updated);
    try {
      localStorage.setItem(attemptsKey(slug, tag), JSON.stringify(updated));
    } catch {
      // Still holds in state for this page view even if it can't persist.
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  }, [composedText, attempts, slug, tag]);

  const startAnother = useCallback(() => {
    setZoneValues({});
    setRevealed(false);
  }, []);

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

        <h1
          style={{
            fontSize: "clamp(1.6rem, 4vw, 2.4rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
            marginBottom: "0.6rem",
          }}
        >
          <PlayRevealText text={title} weights={titleWeights} revealed={revealed} />
        </h1>

        {!revealed && (
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
          </p>
        )}
        {revealed && <div style={{ marginBottom: "2.5rem" }} />}

        <div style={{ fontSize: "1.05rem", lineHeight: 1.8, marginBottom: "1.5rem" }}>
          <PlayPoemBody
            text={body}
            weights={bodyWeights}
            revealed={revealed}
            zoneValues={zoneValues}
            onZoneChange={handleZoneChange}
          />
        </div>

        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "1rem" }}>
          <button onClick={handleSave} disabled={!composedText} className="export-btn">
            save
          </button>
          {savedFlash && (
            <span style={{ fontSize: "0.7rem", color: "rgba(10,10,10,0.5)", fontStyle: "italic" }}>
              saved.
            </span>
          )}
          {!revealed && (
            <button
              onClick={() => setRevealed(true)}
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
          )}
        </div>

        {revealed && (
          <div
            style={{
              marginTop: "2rem",
              paddingTop: "1.5rem",
              borderTop: "1px solid rgba(10,10,10,0.15)",
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
