"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";

interface PostMeta {
  slug:  string;
  title: string;
  date:  string;
  tags:  string[];
}

const CHARS      = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&";
const LABEL      = "take me somewhere";
const SCRAMBLE_MS = 500;

export default function WritingPage() {
  const [posts,          setPosts]          = useState<PostMeta[]>([]);
  const [hoveredSlug,    setHoveredSlug]    = useState<string | null>(null);
  const [highlightedSlug,setHighlightedSlug]= useState<string | null>(null);
  const [btnLabel,       setBtnLabel]       = useState(LABEL);
  const [firing,         setFiring]         = useState(false);

  const [scrolled, setScrolled] = useState(false);
  const rafRef    = useRef<number | null>(null);
  const firingRef = useRef(false);
  const rowRefs   = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    fetch("/api/posts").then(r => r.json()).then(setPosts);
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    firingRef.current = false;
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleTakeMe = useCallback(() => {
    if (firingRef.current || posts.length === 0) return;
    firingRef.current = true;
    setFiring(true);
    setHighlightedSlug(null);

    const target = posts[Math.floor(Math.random() * posts.length)];
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
  }, [posts]);

  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      {/* Back */}
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
          marginBottom:  "3rem",
        }}
      >
        WRITING
      </motion.h2>

      {/* Post list */}
      <div style={{ display: "flex", flexDirection: "column", paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
        {posts.map((post, i) => {
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
