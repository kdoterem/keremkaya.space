"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePlayProgress } from "@/lib/usePlayProgress";
import { getPassage } from "@/lib/playPassages";
import { getDifficulty, wordFloorForTier, pickNextPassage, tierForCompletedCount, tierProgressFraction, TIER_COUNT } from "@/lib/playDifficulty";
import { countWords, looksUnfinished, randomUnderFloorMessage } from "@/lib/playWriting";
import PlayFakeEvalModal from "./PlayFakeEvalModal";
import PlayIntro from "./PlayIntro";

// ── PLAY's primary screen, replacing the old gateway → category → tag →
// poem tree entirely. No upfront choice of mode ("push back" vs "write
// here") — that asked the reader to declare an intent before they'd even
// seen anything to react to. Now a passage is simply served, off the
// reader's own difficulty tier (see lib/playDifficulty.ts), and whatever
// they do with it — continue it, argue with it, describe past it — is
// theirs to find, not a fork picked in advance. The old system's
// per-word obscuring (ObscurableRun/PlayPoemBody) doesn't apply here
// either: a passage is already the hand-picked, complete-in-itself unit
// (see the passage-selection brief) — there's nothing left to hide, it's
// meant to be read cold and continued, not searched through.
//
// One write-in zone, not one per line — there's only one passage per
// screen now. No ceiling on length (deliberate); a floor scaled to the
// tier (harder tiers give less, so ask for less back) plus a soft
// "doesn't look finished yet" nudge are the only gates, both from
// lib/playWriting.ts.

const DRAFT_KEY_PREFIX = "kk-play-next-draft-v1";
const HISTORY_KEY = "kk-play-history-v1";

interface HistoryEntry {
  slug: string;
  text: string;
  completedAt: string; // ISO
}

function draftKey(slug: string): string {
  return `${DRAFT_KEY_PREFIX}:${slug}`;
}

function appendHistory(entry: HistoryEntry) {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list: HistoryEntry[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // Not persisted, but the completion itself (progress) still counts.
  }
}

export default function PlayNext() {
  const progress = usePlayProgress();
  // undefined = not decided yet (still hydrating / haven't picked a first
  // passage); null = decided, and there is genuinely nothing left; a slug
  // = the real thing to show. Collapsing "not decided" and "nothing left"
  // into the same null would show the wrong empty state for a beat on
  // every load.
  const [slug, setSlug] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [nudge, setNudge] = useState<string | null>(null);
  const [evalOpen, setEvalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pick the first passage once progress has hydrated from localStorage —
  // deliberately after hydration, not before, so a returning reader's
  // real tier decides what they see rather than always starting at tier 1
  // for one frame.
  useEffect(() => {
    if (!progress.hydrated || slug !== undefined) return;
    setSlug(pickNextPassage(progress.tier, progress.completedSet));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress.hydrated]);

  // Restore/autosave the draft for whichever passage is showing — same
  // continuous-silent-autosave pattern as the old PlayScreen.
  useEffect(() => {
    if (!slug) return;
    try {
      const raw = localStorage.getItem(draftKey(slug));
      setText(raw ?? "");
    } catch {
      setText("");
    }
    setNudge(null);
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    try {
      if (text) localStorage.setItem(draftKey(slug), text);
      else localStorage.removeItem(draftKey(slug));
    } catch {
      // Draft still holds in state for this page view.
    }
  }, [slug, text]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const passage = slug ? getPassage(slug) : undefined;
  const difficulty = slug ? getDifficulty(slug) : undefined;
  const tier = difficulty?.tier ?? progress.tier;
  const floor = wordFloorForTier(tier);
  const words = useMemo(() => countWords(text), [text]);
  const meetsFloor = words >= floor;

  // No persistent counter — a number sitting there the whole time turns
  // writing into watching a progress bar. Instead: clear whatever nudge
  // is showing the instant they type again, and if they're still under
  // the floor 3 seconds after their last keystroke, offer a quiet
  // check-in rather than a running tally. Only schedules while there's
  // something written but not enough of it — nothing to nudge about at
  // zero words, nothing to say once the floor's cleared.
  useEffect(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    setNudge(null);
    if (words > 0 && words < floor) {
      nudgeTimerRef.current = setTimeout(() => setNudge(randomUnderFloorMessage()), 3000);
    }
    return () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); };
  }, [text, floor, words]);

  const handleSubmit = useCallback(() => {
    if (!meetsFloor) {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      setNudge(randomUnderFloorMessage());
      return;
    }
    if (looksUnfinished(text)) {
      setNudge("doesn't look finished yet");
      return;
    }
    setNudge(null);
    setEvalOpen(true);
  }, [meetsFloor, text]);

  const handleProceed = useCallback(() => {
    if (!slug) return;
    appendHistory({ slug, text, completedAt: new Date().toISOString() });
    progress.markCompleted(slug);
    try {
      localStorage.removeItem(draftKey(slug));
    } catch {
      // Fine — history already has the finished text either way.
    }
    setEvalOpen(false);
    setText("");
    // progress.markCompleted's setState hasn't landed yet — figure out the
    // reader's tier post-completion by hand rather than trust progress.tier,
    // which still reflects the count from before this passage counted.
    const completedSetAfter = new Set([...progress.completedSet, slug]);
    const nextTier = tierForCompletedCount(completedSetAfter.size);
    setSlug(pickNextPassage(nextTier, completedSetAfter, slug));
  }, [slug, text, progress]);

  if (!progress.hydrated || slug === undefined) {
    return <main style={mainStyle} />;
  }

  if (slug === null) {
    return (
      <main style={mainStyle}>
        <PlayIntro />
        <TopBar tier={tier} finishedGame={progress.finishedGame} progressFraction={tierProgressFraction(progress.completed.length)} />
        <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "6rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.1rem", lineHeight: 1.7 }}>
            you've answered every passage there is, for now.
          </p>
        </div>
      </main>
    );
  }

  if (!passage) return null; // shouldn't happen — pickNextPassage only returns real slugs

  return (
    <main style={mainStyle}>
      <PlayIntro />
      <TopBar tier={tier} finishedGame={progress.finishedGame} progressFraction={tierProgressFraction(progress.completed.length)} />

      <div style={{ maxWidth: "640px", margin: "0 auto", marginTop: "3.5rem" }}>
        <div style={{ fontSize: "1.05rem", lineHeight: 1.85, whiteSpace: "pre-wrap", marginBottom: "2.5rem" }}>
          {passage.lines.map((line, i) => (
            <div key={i}>{line || " "}</div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…"
          rows={1}
          className="play-zone"
          style={{
            display: "block",
            width: "100%",
            margin: "0 0 0.6rem",
            padding: "0.2rem 0",
            fontFamily: "inherit",
            fontSize: "1rem",
            lineHeight: 1.7,
            color: "#0a0a0a",
            background: "transparent",
            resize: "none",
            overflow: "hidden",
          }}
        />

        {/* Fixed height whether or not a nudge is showing, so the submit
            button below does not hop up and down as messages appear/clear. */}
        <div style={{ minHeight: "1.4rem", marginBottom: "0.6rem" }}>
          {nudge && (
            <span style={{ fontSize: "0.7rem", fontStyle: "italic", color: "rgba(10,10,10,0.5)" }}>
              {nudge}
            </span>
          )}
        </div>

        <button onClick={handleSubmit} className="export-btn">
          submit
        </button>
      </div>

      <PlayFakeEvalModal
        open={evalOpen}
        passageLines={passage.lines}
        written={text}
        onProceed={handleProceed}
      />
    </main>
  );
}

const mainStyle: React.CSSProperties = {
  minHeight: "100vh",
  backgroundColor: "#aaff00",
  color: "#0a0a0a",
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  padding: "4rem 5vw 6rem",
};

function TopBar({
  tier, finishedGame, progressFraction,
}: {
  tier: number;
  finishedGame: boolean;
  progressFraction: number;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <Link
        href="/"
        style={{
          fontSize: "0.7rem", fontWeight: 500, letterSpacing: "0.15em",
          fontVariant: "small-caps", color: "#0a0a0a", textDecoration: "none", opacity: 0.5,
        }}
      >
        RETURN
      </Link>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.4rem" }}>
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.1em", fontVariant: "small-caps", color: "rgba(10,10,10,0.4)" }}>
            tier {tier} of {TIER_COUNT}
          </span>
          {finishedGame && (
            <Link
              href="/play/browse"
              style={{ fontSize: "0.7rem", fontStyle: "italic", color: "rgba(10,10,10,0.5)", textDecoration: "underline", textUnderlineOffset: "3px" }}
            >
              browse freely →
            </Link>
          )}
        </div>
        {/* Quiet fill bar toward the next unlock — no number alongside
            it on purpose, a count here would read like a countdown. */}
        <div style={{ width: "90px", height: "3px", background: "rgba(10,10,10,0.15)", borderRadius: "2px", overflow: "hidden" }}>
          <div
            style={{
              width: `${Math.round(progressFraction * 100)}%`,
              height: "100%",
              background: "rgba(10,10,10,0.55)",
              borderRadius: "2px",
              transition: "width 0.4s ease-out",
            }}
          />
        </div>
      </div>
    </div>
  );
}
