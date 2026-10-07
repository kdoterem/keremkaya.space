"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import type { ScanCollection } from "@/lib/scans";
import ScanExpanded from "@/app/components/ScanExpanded";
import useIsNarrow from "@/lib/useIsNarrow";

// ── SCANS — the warm gray (#A49B9C) this page was designed around is now
// the whole site's ground color (see globals.css), so this page just
// inherits it rather than setting its own — the paper is still the only
// color doing active work on the page, same as before, it's just no longer
// a departure from the rest of the site to get there. Nothing here is a
// pop-up: opening a collection swaps the grid out for ScanExpanded in the
// same spot, same page, header untouched. Covers are small and plain on
// purpose — no stack cue, no sheet-count caption; everybody clicks a cover
// regardless, so a tile shouldn't spend effort telegraphing "there's more"
// before it's clicked.

export default function ScansPage() {
  const [collections, setCollections] = useState<ScanCollection[] | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  // Opening a collection replaces main's own scroll (height:100dvh + hidden
  // overflow — see `fitToScreen` below) with the expanded view's, so the
  // grid's scroll position is gone the moment you open one — nothing left
  // to return to without saving it first. Restored after a delay matching
  // AnimatePresence's exit transition (0.3s) so the grid has actually
  // remounted — and is tall again — before the browser tries to scroll it.
  const savedScrollY = useRef(0);
  const openSlugRef = useRef(openSlug);
  openSlugRef.current = openSlug;

  // An open collection gets its own history entry, so the phone's back
  // gesture/button closes it instead of leaving SCANS altogether. The entry
  // spreads Next's own history state (__NA etc.) — without it the app
  // router treats the entry as foreign and reloads the page on back.
  // popstate is the single place that actually opens/closes from history,
  // so RETURN, the heading, Escape and the back button all end up there.
  useEffect(() => {
    fetch("/api/scans").then(r => r.json()).then((cs: ScanCollection[]) => {
      setCollections(cs);
      // A reload while a collection was open lands back on that entry.
      const slug = window.history.state?.scan;
      if (slug && cs.some(c => c.slug === slug)) setOpenSlug(slug);
    });
  }, []);

  useEffect(() => {
    const onPop = () => {
      const slug: string | null = window.history.state?.scan ?? null;
      if (openSlugRef.current && !slug) setTimeout(() => window.scrollTo(0, savedScrollY.current), 320);
      setOpenSlug(slug);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openCollectionAt = (slug: string) => {
    savedScrollY.current = window.scrollY;
    window.history.pushState({ ...window.history.state, scan: slug }, "");
    setOpenSlug(slug);
  };
  const closeCollection = () => {
    if (window.history.state?.scan) {
      window.history.back();
      return;
    }
    setOpenSlug(null);
    setTimeout(() => window.scrollTo(0, savedScrollY.current), 320);
  };

  const openCollection = collections?.find(c => c.slug === openSlug) ?? null;
  const expanded = openCollection !== null;
  const narrow = useIsNarrow();
  // The fixed-height, no-scroll "fits one screen" treatment was a desktop
  // request — on a phone there's no side-by-side room for hero + filmstrip
  // to begin with (see ScanExpanded), so it needs to scroll like any other
  // mobile page rather than fight to cram everything above the fold.
  const fitToScreen = expanded && !narrow;

  return (
    <main
      style={{
        minHeight:       "100vh",
        height:          fitToScreen ? "100dvh" : undefined,
        overflow:        fitToScreen ? "hidden" : undefined,
        display:         expanded ? "flex" : undefined,
        flexDirection:   expanded ? "column" : undefined,
        padding:         expanded ? "1.75rem 5vw 1.25rem" : "4rem 5vw 6rem",
        fontFamily:      '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      {expanded ? (
        <button
          onClick={closeCollection}
          style={{
            fontSize:       "0.7rem",
            fontWeight:     500,
            letterSpacing:  "0.15em",
            fontVariant:    "small-caps",
            color:          "#0a0a0a",
            textDecoration: "none",
            opacity:        0.76,
            flexShrink:     0,
            background:     "none",
            border:         "none",
            padding:        0,
            cursor:         "pointer",
          }}
        >
          RETURN
        </button>
      ) : (
        <Link
          href="/"
          style={{
            fontSize:       "0.7rem",
            fontWeight:     500,
            letterSpacing:  "0.15em",
            fontVariant:    "small-caps",
            color:          "#0a0a0a",
            textDecoration: "none",
            opacity:        0.76,
            flexShrink:     0,
          }}
        >
          RETURN
        </Link>
      )}

      <motion.h2
        onClick={expanded ? closeCollection : undefined}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        style={{
          fontSize:      expanded ? "clamp(1.4rem, 3vw, 2rem)" : "clamp(2rem, 5vw, 3.5rem)",
          fontWeight:    700,
          letterSpacing: "-0.02em",
          color:         "#0a0a0a",
          marginTop:     expanded ? "0.75rem" : "2.5rem",
          marginBottom:  expanded ? "1rem" : "3rem",
          cursor:        expanded ? "pointer" : undefined,
          flexShrink:    0,
        }}
      >
        SCANS
      </motion.h2>

      {collections === null ? null : collections.length === 0 ? (
        <p
          style={{
            fontSize:      "0.95rem",
            fontStyle:     "italic",
            color:         "rgba(10,10,10,0.72)",
            letterSpacing: "0.01em",
          }}
        >
          work in progress.
        </p>
      ) : (
        <AnimatePresence mode="wait">
          {openCollection ? (
            <ScanExpanded key="expanded" collection={openCollection} onClose={closeCollection} narrow={narrow} />
          ) : (
            <motion.div
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                display:             "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
                gap:                 "2.5rem 1.75rem",
              }}
            >
              {collections.map((c) => (
                <ScanTile key={c.slug} collection={c} onOpen={() => openCollectionAt(c.slug)} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </main>
  );
}

function ScanTile({
  collection,
  onOpen,
}: {
  collection: ScanCollection;
  onOpen: () => void;
}) {
  const cover = collection.cover;
  const ratio = collection.pages[0].ratio;

  return (
    <motion.button
      onClick={onOpen}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      style={{
        background: "none",
        border:     "none",
        padding:    0,
        cursor:     "pointer",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "flex-start",
        gap:            "0.5rem",
        width:          "100%",
      }}
    >
      <div
        style={{
          position:    "relative",
          width:       "100%",
          aspectRatio: String(ratio),
          boxShadow:   "0 8px 20px rgba(10,10,10,0.43)",
        }}
      >
        <Image
          src={cover}
          alt={collection.title}
          fill
          sizes="(max-width: 600px) 45vw, (max-width: 1000px) 25vw, 180px"
          style={{ objectFit: "cover" }}
        />
      </div>

      <span
        style={{
          fontSize:      "0.8rem",
          fontWeight:    500,
          letterSpacing: "0.04em",
          color:         "#0a0a0a",
          opacity:       0.79,
        }}
      >
        {collection.title}
      </span>
    </motion.button>
  );
}
