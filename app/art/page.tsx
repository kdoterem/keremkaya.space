"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Painting {
  title: string;
  date: string;
}

// Add paintings here: { title, date } — images go in /public/art/ as painting-1.jpg, etc.
const PAINTINGS: Painting[] = [
  { title: "untitled I", date: "2023" },
  { title: "untitled II", date: "2023" },
  { title: "untitled III", date: "2024" },
];

export default function ArtPage() {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1); // 1 = forward (from right), -1 = back

  const goTo = useCallback(
    (index: number) => {
      if (index === current) return;
      setDirection(index > current ? 1 : -1);
      setCurrent(index);
    },
    [current]
  );

  // Wheel scroll handler
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY > 0 && current < PAINTINGS.length - 1) {
        goTo(current + 1);
      } else if (e.deltaY < 0 && current > 0) {
        goTo(current - 1);
      }
    };
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => window.removeEventListener("wheel", handleWheel);
  }, [current, goTo]);

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? "100%" : "-100%",
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? "-30%" : "30%",
      opacity: 0,
    }),
  };

  const painting = PAINTINGS[current];

  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      {/* Back nav */}
      <Link
        href="/"
        style={{
          position: "absolute",
          top: "2.5rem",
          left: "3rem",
          fontSize: "0.7rem",
          fontWeight: 500,
          letterSpacing: "0.15em",
          fontVariant: "small-caps",
          color: "#0a0a0a",
          textDecoration: "none",
          opacity: 0.5,
          zIndex: 10,
        }}
      >
        RETURN
      </Link>

      {/* Painting */}
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={current}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.55, ease: [0.76, 0, 0.24, 1] }}
          style={{
            position: "absolute",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "80vw",
            height: "80vh",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(10,10,10,0.12)",
              color: "rgba(10,10,10,0.3)",
              fontSize: "0.75rem",
              letterSpacing: "0.12em",
              fontVariant: "small-caps",
            }}
          >
            coming soon
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Caption — bottom right */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`caption-${current}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          style={{
            position: "absolute",
            bottom: "2.5rem",
            right: "3rem",
            textAlign: "right",
            zIndex: 10,
          }}
        >
          <p
            style={{
              fontSize: "0.8rem",
              fontWeight: 500,
              color: "#0a0a0a",
              letterSpacing: "-0.01em",
            }}
          >
            {painting.title}
          </p>
          <p
            style={{
              fontSize: "0.65rem",
              color: "rgba(10,10,10,0.45)",
              letterSpacing: "0.05em",
              marginTop: "0.15rem",
            }}
          >
            {painting.date}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* Dot navigation */}
      <div
        style={{
          position: "absolute",
          bottom: "2.5rem",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: "0.6rem",
          zIndex: 10,
        }}
      >
        {PAINTINGS.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: i === current ? "#0a0a0a" : "rgba(10,10,10,0.25)",
              border: "none",
              cursor: "pointer",
              padding: 0,
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      {/* Scroll hint */}
      {current === 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.35 }}
          transition={{ delay: 1.5 }}
          style={{
            position: "absolute",
            bottom: "2.5rem",
            left: "3rem",
            fontSize: "0.65rem",
            letterSpacing: "0.1em",
            fontVariant: "small-caps",
            color: "#0a0a0a",
          }}
        >
          scroll to navigate
        </motion.p>
      )}
    </main>
  );
}
