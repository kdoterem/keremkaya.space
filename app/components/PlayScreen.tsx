"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import PlayRevealText from "./PlayRevealText";
import PlayPoemBody from "./PlayPoemBody";
import PiecePopup from "./PiecePopup";
import { splitPoemLines, groupLegiblePassages, passageZoneId, ANYWHERE_ZONE_ID } from "@/lib/playLines";

// ── PLAY's actual play screen — one (poem, tag) pair, reached through one
// of the two gateways at /play. Only the chosen tag's provenanced lines
// are legible on load, each followed immediately by its own write-in
// zone (PlayPoemBody) — writing happens right where the thought was, not
// disconnected in a box at the end. The gateway already decided the
// prompt language for the whole screen (promptLabel — "write here" or
// "push back"), so there's exactly one zone per passage here, not a
// choice to make on every one. Repeatable by design (see the
// saved-writings list below): this is meant to be returned to, not a
// once-per-poem quiz — which is also why there's no "start over"
// control: nothing here is being graded, so editing a zone directly IS
// starting over.
//
// Two popups (PiecePopup), not a page-state reveal: "see kerem's
// version" and the writing popup SAVE opens both show their piece in the
// same plain reading format /writing itself uses — neither one touches
// the poem's own obscured/write-in state underneath, so closing either
// one always comes back to exactly where writing left off. "your
// writing" specifically interleaves each provenance line with what got
// written after it — showing only the fragments, stripped of what
// prompted them, made a saved piece unreadable as anything but orphaned
// notes.
//
// Storage is three different things, all plain localStorage (no accounts
// on this site — same pattern as useReadingPreference.ts and /kismet):
// - `draft` — the live set of zone values, autosaves continuously and
//   silently so nothing is lost.
// - `peeked` — which LINES have been tapped open (every obscured run in
//   a line reveals together, not word by word or run by run — see
//   PlayPoemBody's header comment), persisted so a reload doesn't
//   re-hide something already looked at. Toggleable (tap again to
//   re-obscure), unlike real provenance, since a peek is exploratory,
//   not a commitment.
// - `saved` — only grows when SAVE is explicitly pressed: a real history
//   of finished writings at this same doorway, distinct from the draft.
const DRAFT_KEY_PREFIX    = "kk-play-draft-v2";
// v2: the stored numbers used to be individual obscured-run offsets;
// now they're line offsets (the peek granularity changed from per-run
// to per-line) — bumped so a reload doesn't try to match old run
// offsets against the new line-keyed lookup and silently do nothing.
const PEEKED_KEY_PREFIX   = "kk-play-peeked-v2";
const ATTEMPTS_KEY_PREFIX = "kk-play-attempts-v1";

interface SavedWriting {
  id:      string;
  text:    string;
  savedAt: string; // ISO
}

function draftKey(slug: string, tag: string): string {
  return `${DRAFT_KEY_PREFIX}:${slug}:${tag}`;
}
function peekedKey(slug: string, tag: string): string {
  return `${PEEKED_KEY_PREFIX}:${slug}:${tag}`;
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

export default function PlayScreen({
  slug,
  tag,
  categoryTitle,
  title,
  titleWeights,
  body,
  bodyWeights,
  promptLabel,
  backHref,
}: {
  slug: string;
  tag: string;
  categoryTitle: string;
  title: string;
  titleWeights: number[] | undefined;
  body: string;
  bodyWeights: number[] | undefined;
  promptLabel: string;
  backHref: string;
}) {
  const [zoneValues, setZoneValues] = useState<Record<string, string>>({});
  const [peeked, setPeeked]         = useState<Set<number>>(new Set());
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
      const rawPeeked = localStorage.getItem(peekedKey(slug, tag));
      if (rawPeeked) setPeeked(new Set(JSON.parse(rawPeeked) as number[]));
      const rawSaved = localStorage.getItem(savedKey(slug, tag));
      if (rawSaved) setSaved(JSON.parse(rawSaved));
    } catch {
      // Private browsing / storage disabled — just start blank.
    }
    setHydrated(true);
  }, [slug, tag]);

  // Silent continuous autosave — only once hydration has actually
  // happened, so the empty initial state never stomps a real stored
  // value before it's had a chance to load.
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

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (peeked.size) {
        localStorage.setItem(peekedKey(slug, tag), JSON.stringify([...peeked]));
      } else {
        localStorage.removeItem(peekedKey(slug, tag));
      }
    } catch {
      // Storage failed — peeked state still holds for this page view.
    }
  }, [peeked, hydrated, slug, tag]);

  const handleZoneChange = useCallback((id: string, value: string) => {
    setZoneValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const handleTogglePeek = useCallback((start: number) => {
    setPeeked((prev) => {
      const next = new Set(prev);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  }, []);

  // Every legible PASSAGE (a run of consecutive tag-weighted lines — see
  // groupLegiblePassages) paired with whatever got written after it —
  // the actual shape of what was made, not the fragments alone, and
  // grouped the same way the on-page zone is so a multi-line passage
  // shows as the one unbroken thought it actually is, not several. Shared
  // by both the saved/localStorage text and the "your writing" popup so
  // they never drift apart from each other.
  const lines    = useMemo(() => splitPoemLines(body, bodyWeights), [body, bodyWeights]);
  const passages = useMemo(() => groupLegiblePassages(lines), [lines]);
  const myBlocks = useMemo(
    () =>
      passages.map((p) => ({
        provenance: p.lines.map((l) => l.text).join("\n"),
        mine: (zoneValues[passageZoneId(p.start)] ?? "").trim(),
      })),
    [passages, zoneValues],
  );
  const anywhereText = (zoneValues[ANYWHERE_ZONE_ID] ?? "").trim();
  const hasWriting = myBlocks.some((b) => b.mine) || !!anywhereText;

  const composedText = useMemo(() => {
    const parts: string[] = [];
    for (const b of myBlocks) {
      if (!b.mine) continue;
      parts.push(`${b.provenance}\n${b.mine}`);
    }
    if (anywhereText) parts.push(anywhereText);
    return parts.join("\n\n");
  }, [myBlocks, anywhereText]);

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
          <PlayRevealText text={title} weights={titleWeights} />
        </h1>

        <p
          style={{
            fontSize: "0.8rem",
            fontStyle: "italic",
            color: "rgba(10,10,10,0.55)",
            marginBottom: "2.5rem",
            maxWidth: "36em",
            lineHeight: 1.6,
          }}
        >
          kerem's marked lines stay legible, as written. "+ {promptLabel}" after any passage
          you want to answer, or use the open space at the end for anything else. stuck on
          a glimmer? tap it to peek — tap it again to hide it back.
        </p>

        <div style={{ fontSize: "1.05rem", lineHeight: 1.8, marginBottom: "1.5rem" }}>
          <PlayPoemBody
            text={body}
            weights={bodyWeights}
            promptLabel={promptLabel}
            zoneValues={zoneValues}
            onZoneChange={handleZoneChange}
            peeked={peeked}
            onTogglePeek={handleTogglePeek}
          />
        </div>

        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "1rem" }}>
          <button onClick={handleSave} disabled={!composedText} className="export-btn">
            save
          </button>
          {hasWriting && (
            <button
              onClick={() => setPopup("mine")}
              style={{
                background: "none", border: "none", padding: 0, cursor: "pointer",
                fontSize: "0.8rem", fontStyle: "italic", color: "rgba(10,10,10,0.55)",
                textDecoration: "underline", textUnderlineOffset: "3px",
              }}
            >
              see your writing
            </button>
          )}
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
        <PiecePopup label={`your writing · ${tag}`} onClose={() => setPopup(null)}>
          {myBlocks.map((b, i) => (
            <div key={i} style={{ marginBottom: "1.6rem" }}>
              <p style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", fontStyle: "italic", color: "rgba(10,10,10,0.55)", marginBottom: "0.35rem" }}>
                {b.provenance}
              </p>
              {b.mine && <p style={{ whiteSpace: "pre-wrap" }}>{b.mine}</p>}
            </div>
          ))}
          {anywhereText && (
            <div style={{ marginTop: "1.6rem", paddingTop: "1.6rem", borderTop: "1px solid rgba(10,10,10,0.15)" }}>
              <p style={{ whiteSpace: "pre-wrap" }}>{anywhereText}</p>
            </div>
          )}
        </PiecePopup>
      )}
      {popup === "kerem" && (
        <PiecePopup label={`${categoryTitle} · ${tag}`} title={title} onClose={() => setPopup(null)}>
          <div style={{ whiteSpace: "pre-wrap" }}>{body}</div>
        </PiecePopup>
      )}
    </main>
  );
}
