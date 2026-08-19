"use client";

import { useMemo } from "react";
import {
  getProvenanceTags,
  computeWeights,
  bodyWeightStyle,
  titleWeightStyle,
  WeightedText,
} from "@/lib/tagProvenance";

// ── BROWSE — "just let me read." No permit, no waiver, no PROCEED/PUSS OUT
// ceremony, no stretch cards, no scramble-reveal. Landing on a month shows
// its poems in place, full text, stacked — forward/back to adjacent months
// that actually have something in them, and a way back to the range.
// Tag-provenance rendering is the same WeightedText/computeWeights path
// /writing/[slug] uses, so a post with provenance data reads identically
// here as everywhere else it appears. ──

const PROSE = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MONO  = '"SF Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, "Courier New", monospace';

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function formatMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

interface TerrainMonth { month: string; count: number; words: number }
interface SearchDoc { slug: string; title: string; date: string; tags: string[]; body: string }

function PoemBlock({ post }: { post: SearchDoc }) {
  const tags = getProvenanceTags(post.slug);
  const titleWeights = useMemo(() => computeWeights(post.title, tags), [post.title, tags]);
  const bodyWeights   = useMemo(() => computeWeights(post.body,  tags), [post.body,  tags]);

  return (
    <div style={{ marginBottom: "4rem" }}>
      <h2
        style={{
          fontFamily:    PROSE,
          fontSize:      "clamp(1.3rem, 3vw, 1.8rem)",
          fontWeight:    700,
          letterSpacing: "-0.02em",
          lineHeight:    1.15,
          color:         "#0a0a0a",
          marginBottom:  "0.35rem",
        }}
      >
        <WeightedText text={post.title} weights={titleWeights} weightStyle={titleWeightStyle} />
      </h2>
      <p style={{ fontFamily: PROSE, fontSize: "0.72rem", color: "rgba(10,10,10,0.4)", letterSpacing: "0.05em", marginBottom: "1.5rem" }}>
        {post.date}
      </p>
      <div style={{ fontFamily: PROSE, fontSize: "1rem", lineHeight: 1.75, color: "#0a0a0a", whiteSpace: "pre-wrap" }}>
        <WeightedText text={post.body} weights={bodyWeights} weightStyle={bodyWeightStyle} />
      </div>
    </div>
  );
}

interface Props {
  months:       TerrainMonth[];       // chronological, ascending
  postsByMonth: Map<string, SearchDoc[]>;
  month:        string;
  onNavigate:   (month: string) => void;
  onReturn:     () => void;
}

export default function BrowseView({ months, postsByMonth, month, onNavigate, onReturn }: Props) {
  const idx = months.findIndex(m => m.month === month);

  const prevMonth = useMemo(() => {
    for (let i = idx - 1; i >= 0; i--) if (months[i].count > 0) return months[i].month;
    return null;
  }, [months, idx]);

  const nextMonth = useMemo(() => {
    for (let i = idx + 1; i < months.length; i++) if (months[i].count > 0) return months[i].month;
    return null;
  }, [months, idx]);

  const posts = postsByMonth.get(month) ?? [];

  const navBtn = (label: string, target: string | null): React.ReactNode => (
    <button
      onClick={() => target && onNavigate(target)}
      disabled={!target}
      style={{
        fontFamily:     MONO,
        fontSize:       "0.7rem",
        fontWeight:     600,
        letterSpacing:  "0.12em",
        textTransform:  "uppercase",
        background:     "none",
        border:         "none",
        padding:        0,
        color:          "#0a0a0a",
        opacity:        target ? 0.55 : 0.2,
        cursor:         target ? "pointer" : "default",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <button
          onClick={onReturn}
          style={{
            fontFamily:     MONO,
            fontSize:       "0.7rem",
            fontWeight:     600,
            letterSpacing:  "0.14em",
            textTransform:  "uppercase",
            color:          "#0a0a0a",
            background:     "none",
            border:         "none",
            padding:        0,
            cursor:         "pointer",
            opacity:        0.5,
          }}
        >
          Return to range
        </button>
        <div style={{ display: "flex", gap: "1.5rem" }}>
          {navBtn("← older", prevMonth)}
          {navBtn("newer →", nextMonth)}
        </div>
      </div>

      <h1
        style={{
          fontFamily:    PROSE,
          fontSize:      "clamp(1.6rem, 4vw, 2.2rem)",
          fontWeight:    700,
          letterSpacing: "-0.02em",
          color:         "#0a0a0a",
          margin:        "2rem 0 2.5rem",
        }}
      >
        {formatMonth(month)}
      </h1>

      {posts.length === 0 ? (
        <p style={{ fontFamily: PROSE, fontSize: "0.85rem", color: "rgba(10,10,10,0.4)" }}>
          nothing here
        </p>
      ) : (
        posts.map(post => <PoemBlock key={post.slug} post={post} />)
      )}
    </div>
  );
}
