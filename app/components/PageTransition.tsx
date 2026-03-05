"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Blind-pull-open: a panel that starts fully covering the screen,
// then pulls away upward (revealing content from top to bottom).
// Preceded by a lime green flash on route change.

const DURATION = 0.25; // seconds
const EASE: [number, number, number, number] = [0.76, 0, 0.24, 1]; // cubic-bezier, no bounce

export default function PageTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [transitionStage, setTransitionStage] = useState<
    "idle" | "flash" | "reveal"
  >("idle");
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      setTransitionStage("flash");

      // After flash, swap content and start reveal
      const flashTimer = setTimeout(() => {
        setDisplayChildren(children);
        setTransitionStage("reveal");
      }, 150);

      // After reveal, go idle
      const revealTimer = setTimeout(() => {
        setTransitionStage("idle");
      }, 150 + DURATION * 1000 + 100);

      return () => {
        clearTimeout(flashTimer);
        clearTimeout(revealTimer);
      };
    } else {
      setDisplayChildren(children);
    }
  }, [pathname, children]);

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      {displayChildren}

      {/* Flash overlay */}
      <AnimatePresence>
        {transitionStage === "flash" && (
          <motion.div
            key="flash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "#aaff00",
              zIndex: 9999,
              pointerEvents: "none",
            }}
          />
        )}
      </AnimatePresence>

      {/* Blind panel — covers screen, then pulls away upward */}
      <AnimatePresence>
        {transitionStage === "reveal" && (
          <motion.div
            key={`blind-${pathname}`}
            initial={{ scaleY: 1, originY: 0 }}
            animate={{ scaleY: 0, originY: 0 }}
            exit={{}}
            transition={{ duration: DURATION, ease: EASE }}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "#aaff00",
              zIndex: 9998,
              pointerEvents: "none",
              transformOrigin: "top",
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
