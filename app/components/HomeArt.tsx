"use client";

import { useEffect, useRef } from "react";

// ── The home page's drawing layer: KILL, and the knife man holding the nav.
// Both are cut from no-smile-smile p02 (the page is scanned sideways; it's
// turned upright here). They're stored as white + alpha and tinted the old
// site lime at draw time, so the paint colour lives in one place.
//
// The knife man isn't placed at a fixed spot — he's sized off the nav row
// itself, so the row always sits inside his arm: knife standing up just
// before WRITING, his head just past FIND ME. On a narrow screen the row is
// tightened (gaps, then letter-spacing, then font size) until he fits, but
// the buttons never drop under 13px — past that he simply runs a little off
// both edges, which was preferred over smaller buttons people already miss.

const LIME = "#aaff00";
const PRESENCE = 0.8;

// [centre x, centre y (fractions of the art area), height (fraction of art
// height), turn in degrees] — reference frames 1440×830 / 390×774.
const KILL = { desk: [0.5, 0.4, 0.3, -3], phone: [0.5, 0.38, 0.17, -3] } as const;
// the stretch of the knife man's arm (fractions of his width) that holds the
// whole nav row, and the height (fraction of his height) the row sits at
const ARM = { desk: { row: [0.22, 0.72], y: 0.685 }, phone: { row: [0.14, 0.82], y: 0.685 } } as const;
const NAV_BASE_PX = 17;
const NAV_MIN_PX  = 13;

function load(src: string) {
  return new Promise<HTMLImageElement | null>((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

export default function HomeArt({ navRef }: { navRef: React.RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let imgs: [HTMLImageElement | null, HTMLImageElement | null] = [null, null];

    const draw = () => {
      const cv = canvasRef.current, nav = navRef.current;
      if (!cv || !nav || cancelled) return;
      const [kill, knife] = imgs;
      const W = window.innerWidth, H = window.innerHeight, h0 = H - 70;
      const phone = W / h0 < 1;
      const ref = phone ? [390, 774] : [1440, 830];
      const sc = Math.min(W / ref[0], h0 / ref[1]);
      const arm = phone ? ARM.phone : ARM.desk;

      // fit the nav row to the arm before measuring it
      const links = [...nav.querySelectorAll<HTMLElement>("a")];
      nav.style.removeProperty("--navfs");
      nav.style.removeProperty("--navgap");
      nav.style.removeProperty("--navls");
      nav.style.transform = "";
      const rowW = () => links[links.length - 1].getBoundingClientRect().right - links[0].getBoundingClientRect().left;
      const maxW = (arm.row[1] - arm.row[0]) * W * 0.97;
      if (rowW() > maxW) {
        nav.style.setProperty("--navgap", "0.5em");
        nav.style.setProperty("--navls", "0.02em");
        const w1 = rowW();
        if (w1 > maxW) nav.style.setProperty("--navfs", `${Math.max(NAV_MIN_PX, NAV_BASE_PX * maxW / w1)}px`);
      }
      // centre his whole figure (knife tip to the back of his head), not just the row
      let first = links[0].getBoundingClientRect();
      const kw = rowW() / (arm.row[1] - arm.row[0]);
      nav.style.transform = `translateX(${W / 2 - (first.left + (0.49 - arm.row[0]) * kw)}px)`;
      first = links[0].getBoundingClientRect();
      const rowL = first.left, rowY = first.top + first.height / 2;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const c = cv.getContext("2d");
      if (!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);

      if (kill) {
        const [x, y, hf, rot] = phone ? KILL.phone : KILL.desk;
        const h = hf * ref[1] * sc, w = kill.width * h / kill.height;
        c.save(); c.translate(x * W, y * h0); c.rotate(rot * Math.PI / 180);
        c.drawImage(kill, -w / 2, -h / 2, w, h); c.restore();
      }
      if (knife) {
        const w = kw, h = w * knife.height / knife.width;
        c.drawImage(knife, rowL - arm.row[0] * w, rowY - arm.y * h, w, h);
      }
      // the masks are white; turn them lime
      c.globalCompositeOperation = "source-in";
      c.fillStyle = LIME;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = "source-over";
    };

    // drawn after the tags are already up, then faded in — never blocks them
    Promise.all([load("/home/kill.webp"), load("/home/knife-man.webp")]).then((r) => {
      imgs = r;
      if (cancelled) return;
      draw();
      canvasRef.current?.style.setProperty("opacity", String(PRESENCE));
    });
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(t); t = setTimeout(draw, 120); };
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(() => { if (!cancelled) draw(); });
    return () => { cancelled = true; clearTimeout(t); window.removeEventListener("resize", onResize); };
  }, [navRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        pointerEvents: "none", zIndex: 0, opacity: 0, transition: "opacity 0.9s ease",
      }}
    />
  );
}
