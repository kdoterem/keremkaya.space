"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";

interface PostMeta {
  slug:  string;
  title: string;
  date:  string;
  tags:  string[];
}

interface SearchDoc extends PostMeta {
  body: string;
}

interface Result extends PostMeta {
  score:   number;
  snippet: string;
}

const CHARS      = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&";
const LABEL      = "take me somewhere";
const SCRAMBLE_MS = 500;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Cheap morphology so "voices" finds poems tagged/worded "voice", "loving" finds
// "love", etc. — a reader's exact word form shouldn't decide whether the closest
// poem shows up at all.
function wordStems(w: string): Set<string> {
  const s = w.toLowerCase();
  const out = new Set([s]);
  if (s.endsWith("ing") && s.length > 5) { const b = s.slice(0, -3); out.add(b); out.add(b + "e"); }
  if (s.endsWith("ed")  && s.length > 4) { const b = s.slice(0, -2); out.add(b); out.add(b + "e"); }
  if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) out.add(s.slice(0, -1));
  return out;
}
function stemsOverlap(a: string, b: string): boolean {
  const sb = wordStems(b);
  for (const x of wordStems(a)) if (sb.has(x)) return true;
  return false;
}

// Count whole-word occurrences of a term inside text, matching stemmed variants.
function countWholeWord(text: string, term: string): number {
  const words = text.match(/[a-z']+/gi);
  if (!words) return 0;
  let count = 0;
  for (const w of words) if (stemsOverlap(w, term)) count++;
  return count;
}

// Relevance score: whole-title match > title > tags > whole-word body hits > substring hits.
function scorePost(title: string, tags: string[], body: string, terms: string[]): number {
  const t     = title.toLowerCase();
  const tgs   = tags.map(x => x.toLowerCase());
  const b     = body.toLowerCase();
  const query = terms.join(" ");             // the full phrase the reader typed

  let score = 0;
  let matchedTerms = 0;

  // Typing a poem's name should surface that poem, period — a whole-title match
  // dominates any amount of common-word body noise. A contiguous phrase in the
  // title (e.g. "shrinking star") gets a strong, lesser boost.
  if (t === query)            score += 100_000;
  else if (t.includes(query)) score += 500;

  for (const term of terms) {
    let hit = 0;
    if (t === term)                        hit += 120;
    else if (countWholeWord(t, term))      hit += 45;
    else if (t.includes(term))             hit += 16;

    if (tgs.includes(term) || tgs.some(tag => tag.split(/\s+/).some(w => stemsOverlap(w, term))))
      hit += 30;
    else if (tgs.some(x => x.includes(term))) hit += 9;

    // Cap per-term body contribution so a stopword ("a", "the") repeated dozens
    // of times in one long poem can't outweigh a real title match.
    const whole = countWholeWord(b, term);
    hit += Math.min(whole, 6) * 7;
    const subs = b.split(term).length - 1;                 // total substring occurrences
    hit += Math.min(Math.max(0, subs - whole), 6) * 1.5;   // partial matches count for less

    if (hit > 0) matchedTerms += 1;
    score += hit;
  }

  // Reward poems that contain every term the reader typed.
  if (terms.length > 1 && matchedTerms === terms.length) score += 25;

  return score;
}

// Pull a short excerpt from the body centred on the first matched term.
function snippetFor(body: string, terms: string[]): string {
  if (!body) return "";
  const clean = body.replace(/\s+/g, " ").trim();
  const low   = clean.toLowerCase();

  let at = -1;
  for (const term of terms) {
    const i = low.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return "";

  const start = Math.max(0, at - 32);
  const end   = Math.min(clean.length, at + 64);
  let s = clean.slice(start, end).trim();
  if (start > 0)          s = "…" + s;
  if (end < clean.length) s = s + "…";
  return s;
}

// Split a snippet so matched terms can be rendered emphasised.
function highlightParts(text: string, terms: string[]): React.ReactNode[] {
  if (!terms.length) return [text];
  const re = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "ig");
  return text.split(re).map((part, i) =>
    terms.some(t => t === part.toLowerCase())
      ? <mark key={i} style={{ background: "none", color: "inherit", fontWeight: 700, textDecoration: "underline", textUnderlineOffset: "0.15em" }}>{part}</mark>
      : <span key={i}>{part}</span>
  );
}

// Persist list + scroll across navigation to a poem and back.
// Module-level so it survives client-side route changes (the bundle stays loaded),
// mirroring the tag-cloud caching on the home page.
let _postsCache: PostMeta[] | null = null;
let _scrollY = 0;

export default function WritingPage() {
  const [posts,          setPosts]          = useState<PostMeta[]>(_postsCache ?? []);
  const [hoveredSlug,    setHoveredSlug]    = useState<string | null>(null);
  const [highlightedSlug,setHighlightedSlug]= useState<string | null>(null);
  const [btnLabel,       setBtnLabel]       = useState(LABEL);
  const [firing,         setFiring]         = useState(false);

  const [searchQuery,  setSearchQuery]  = useState("");
  const [searchOpen,   setSearchOpen]   = useState(false);
  const [scrolled,     setScrolled]     = useState(false);
  const [bodies,       setBodies]       = useState<Record<string, string>>({});
  const rafRef         = useRef<number | null>(null);
  const firingRef      = useRef(false);
  const rowRefs        = useRef<Map<string, HTMLDivElement>>(new Map());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const terms = useMemo(
    () => searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [searchQuery],
  );

  // No query → the full list in date order. Query → poems that match any term,
  // ranked by relevance, each with a snippet of where the word appears.
  const results = useMemo<Result[]>(() => {
    if (terms.length === 0) return posts.map(p => ({ ...p, score: 0, snippet: "" }));
    return posts
      .map(p => {
        const body = bodies[p.slug] ?? "";
        const score = scorePost(p.title, p.tags, body, terms);
        return { ...p, score, snippet: score > 0 ? snippetFor(body, terms) : "" };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [posts, bodies, terms]);

  useEffect(() => {
    if (_postsCache) return;               // already loaded — no refetch, no flicker
    fetch("/api/posts").then(r => r.json()).then((p: PostMeta[]) => {
      _postsCache = p;
      setPosts(p);
    });
  }, []);

  // Restore the scroll offset once the list is in the DOM, so returning from a
  // poem lands you exactly where you clicked instead of jumping to the top.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current || posts.length === 0) return;
    didRestore.current = true;
    if (_scrollY > 0) window.scrollTo(0, _scrollY);
  }, [posts.length]);

  // Load poem bodies lazily the first time search is opened.
  useEffect(() => {
    if (!searchOpen || Object.keys(bodies).length > 0) return;
    fetch("/api/search-index").then(r => r.json()).then((docs: SearchDoc[]) => {
      const map: Record<string, string> = {};
      for (const d of docs) map[d.slug] = d.body;
      setBodies(map);
    });
  }, [searchOpen, bodies]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    firingRef.current = false;
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 200);
      _scrollY = window.scrollY;           // remember position for the return trip
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
    else setSearchQuery("");
  }, [searchOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleTakeMe = useCallback(() => {
    const pool = results.length > 0 ? results : posts;
    if (firingRef.current || pool.length === 0) return;
    firingRef.current = true;
    setFiring(true);
    setHighlightedSlug(null);

    const target = pool[Math.floor(Math.random() * pool.length)];
    let start: number | null = null;

    const run = (now: number) => {
      if (!start) start = now;
      const progress  = Math.min((now - start) / SCRAMBLE_MS, 1);
      const lockIndex = Math.floor(progress * LABEL.length);

      setBtnLabel(
        LABEL.split("").map((char, i) => {
          if (char === " ") return " ";
          if (i < lockIndex) return char;
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        }).join("")
      );

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(run);
      } else {
        setBtnLabel(LABEL);
        firingRef.current = false;
        setFiring(false);

        // Highlight the chosen post and scroll it into view
        setHighlightedSlug(target.slug);
        setTimeout(() => {
          rowRefs.current.get(target.slug)?.scrollIntoView({
            behavior: "smooth",
            block:    "center",
          });
        }, 40); // small tick so React has painted the highlight first
      }
    };

    rafRef.current = requestAnimationFrame(run);
  }, [posts, results]);

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      {/* Back + Search toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
        <button
          onClick={() => setSearchOpen(o => !o)}
          style={{
            background:    "none",
            border:        "none",
            cursor:        "pointer",
            fontSize:      "0.7rem",
            fontWeight:    500,
            letterSpacing: "0.15em",
            fontVariant:   "small-caps",
            fontFamily:    '"Helvetica Neue", Helvetica, Arial, sans-serif',
            color:         "#0a0a0a",
            opacity:       searchOpen ? 1 : 0.5,
            padding:       0,
            transition:    "opacity 0.15s",
          }}
        >
          {searchOpen ? "✕ close" : "⌕ search"}
        </button>
      </div>

      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        style={{
          fontSize:      "clamp(2rem, 5vw, 3.5rem)",
          fontWeight:    700,
          letterSpacing: "-0.02em",
          color:         "#0a0a0a",
          marginTop:     "2.5rem",
          marginBottom:  searchOpen ? "1.5rem" : "3rem",
        }}
      >
        WRITING
      </motion.h2>

      {/* Search input */}
      <motion.div
        initial={false}
        animate={{ opacity: searchOpen ? 1 : 0, height: searchOpen ? "auto" : 0 }}
        transition={{ duration: 0.2 }}
        style={{ overflow: "hidden", marginBottom: searchOpen ? "2rem" : 0 }}
      >
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="search the words in the poems…"
          style={{
            width:         "100%",
            background:    "none",
            border:        "none",
            borderBottom:  "1px solid rgba(10,10,10,0.2)",
            outline:       "none",
            fontFamily:    '"Helvetica Neue", Helvetica, Arial, sans-serif',
            fontSize:      "clamp(1rem, 2.5vw, 1.25rem)",
            fontWeight:    400,
            color:         "#0a0a0a",
            padding:       "0.5rem 0",
            letterSpacing: "-0.01em",
          }}
        />
        {searchQuery && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.7rem", opacity: 0.4, letterSpacing: "0.05em" }}>
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
        )}
      </motion.div>

      {/* Post list */}
      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
        {results.map((post) => {
          const isHighlighted = highlightedSlug === post.slug;
          const isHovered     = hoveredSlug     === post.slug;
          const isActive      = isHighlighted || isHovered;

          return (
            <div
              key={post.slug}
              ref={(el) => {
                if (el) rowRefs.current.set(post.slug, el);
                else    rowRefs.current.delete(post.slug);
              }}
            >
              <Link
                href={`/writing/${post.slug}`}
                style={{ textDecoration: "none" }}
                onMouseEnter={() => setHoveredSlug(post.slug)}
                onMouseLeave={() => setHoveredSlug(null)}
              >
                <motion.div
                  animate={{
                    backgroundColor: isActive ? "#0a0a0a" : "rgba(0,0,0,0)",
                  }}
                  transition={{ duration: isHighlighted && !isHovered ? 0.4 : 0.15 }}
                  style={{
                    display:        "flex",
                    alignItems:     "baseline",
                    justifyContent: "space-between",
                    padding:        "1.1rem 1rem",
                    cursor:         "pointer",
                  }}
                >
                  <span style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 0 }}>
                    <span
                      style={{
                        fontSize:      "clamp(1rem, 2.5vw, 1.25rem)",
                        fontWeight:    isHighlighted && !isHovered ? 700 : 500,
                        color:         isActive ? "#aaff00" : "#0a0a0a",
                        transition:    "color 0.15s, font-weight 0.15s",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {post.title}
                    </span>
                    {post.snippet && (
                      <span
                        style={{
                          fontSize:      "0.78rem",
                          fontWeight:    400,
                          fontStyle:     "italic",
                          lineHeight:    1.4,
                          color:         isActive ? "rgba(184,240,74,0.65)" : "rgba(10,10,10,0.5)",
                          transition:    "color 0.15s",
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {highlightParts(post.snippet, terms)}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontSize:      "0.75rem",
                      fontWeight:    400,
                      color:         isActive ? "rgba(184,240,74,0.6)" : "rgba(10,10,10,0.4)",
                      transition:    "color 0.15s",
                      letterSpacing: "0.05em",
                      flexShrink:    0,
                      marginLeft:    "2rem",
                    }}
                  >
                    {post.date}
                  </span>
                </motion.div>
              </Link>
            </div>
          );
        })}
      </div>

      {/* Gradient fade — fades posts out and blocks clicks in button zone */}
      <div
        style={{
          position:       "fixed",
          bottom:         0,
          left:           0,
          right:          0,
          height:         "calc(8rem + env(safe-area-inset-bottom))",
          background:     "linear-gradient(to top, #aaff00 55%, transparent)",
          zIndex:         49,
          pointerEvents:  "none",
        }}
      />

      {/* Take me somewhere — fixed bottom centre, only shown once posts are loaded */}
      <motion.button
        onClick={handleTakeMe}
        initial={{ opacity: 0 }}
        animate={{ opacity: posts.length > 0 ? 1 : 0, pointerEvents: posts.length > 0 ? "auto" : "none" }}
        transition={{ duration: 0.3 }}
        whileHover={firing ? {} : { backgroundColor: "#0a0a0a", color: "#aaff00", opacity: 1, transition: { duration: 0.15 } }}
        style={{
          position:        "fixed",
          bottom:          "calc(2rem + env(safe-area-inset-bottom))",
          left:            "50%",
          transform:       "translateX(-50%)",
          backgroundColor: "transparent",
          border:          "none",
          cursor:          firing ? "default" : "pointer",
          fontFamily:      '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize:        "0.88rem",
          fontWeight:      500,
          letterSpacing:   "0.06em",
          color:           "#0a0a0a",
          opacity:         1,
          padding:         "0.45rem 1rem",
          zIndex:          9999,
          whiteSpace:      "nowrap",
        }}
      >
        {btnLabel}
      </motion.button>

      {/* Back to top */}
      <motion.button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        initial={false}
        animate={{ opacity: scrolled ? 0.38 : 0, pointerEvents: scrolled ? "auto" : "none" }}
        whileHover={{ opacity: 0.8 }}
        transition={{ duration: 0.2 }}
        style={{
          position:    "fixed",
          bottom:      "2.5rem",
          right:       "3rem",
          background:  "none",
          border:      "none",
          cursor:      "pointer",
          fontFamily:    '"Helvetica Neue", Helvetica, Arial, sans-serif',
          fontSize:      "0.88rem",
          fontWeight:    500,
          letterSpacing: "0.06em",
          color:         "#0a0a0a",
          padding:     0,
          zIndex:      50,
        }}
      >
        ↑ top
      </motion.button>
    </main>
  );
}
