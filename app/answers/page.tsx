"use client";

import { motion } from "framer-motion";
import Link from "next/link";

// ── SCANS — repurposed from the old Q&A listing. That page fetched and
// rendered answers/[slug] entries via /api/answers; none of that data or
// those routes were touched, just this listing no longer shows them (the
// [slug] pages and API route still exist, just unreached from here now).
// Paper scans are the new content for this section, not built yet — this
// is the placeholder until they start coming in.
export default function AnswersPage() {
  return (
    <main
      style={{
        minHeight:  "100vh",
        padding:    "4rem 5vw",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
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
          marginBottom:  "1rem",
        }}
      >
        SCANS
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        style={{
          fontSize:      "0.95rem",
          fontStyle:     "italic",
          color:         "rgba(10,10,10,0.4)",
          letterSpacing: "0.01em",
        }}
      >
        work in progress.
      </motion.p>
    </main>
  );
}
