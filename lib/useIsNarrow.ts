"use client";

import { useEffect, useState } from "react";

// Matches the kismet mobile breakpoint in globals.css (max-width: 640px) —
// one definition of "narrow" for every component that needs to switch
// layout by hand (inline styles can't carry @media queries themselves).
export default function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return narrow;
}
