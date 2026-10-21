"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { ScanCollection } from "@/lib/scans";

// ── Opening a collection is not a pop-up — no scrim, no separate darker
// room, same ground color as the grid it replaces. The clicked cover becomes
// the hero; the collection's other pages sit alongside it as a plain
// filmstrip, Helvetica throughout. There's no separate "back" control here;
// ScansPage makes the SCANS heading itself clickable while a collection is
// open, so closing doesn't cost its own line of chrome.
//
// Two layouts, picked by `narrow` (ScansPage's useIsNarrow, same instance
// driving its own fixed-height/no-scroll choice — kept in one place so they
// can't disagree):
//  - Desktop: hero + filmstrip side by side, hero sized by HEIGHT (100% of
//    the flex row ScansPage hands it), so it fills exactly the space left
//    after the header — fits one screen by construction.
//  - Narrow: there's no width for that — a hero sized to fill the height of
//    a phone screen would need to be wider than the phone. So it stacks:
//    hero sized by WIDTH instead (100% of the column, height follows from
//    its own aspect ratio), filmstrip becomes a horizontal scroll strip
//    beneath it. ScansPage already dropped the no-scroll constraint for
//    this case — stacked content is free to run past one screen and scroll,
//    same as every other page on the site does on mobile.
//    The hero itself is a swipeable track of every page (native scroll-snap,
//    so momentum and feel are the phone's own), not a single image you can
//    only change by hitting a thumbnail. Slides are a little narrower than
//    the screen so the neighbouring page peeks in at the edges — the only
//    hint that it swipes. The track is the source of truth for which page is
//    showing: scrolling it sets heroIndex, and thumbnails/arrow keys just
//    scroll it (never the other way round, so the two can't fight mid-swipe).
const SLIDE_VW = 84;
const SLIDE_GAP_VW = 3;
// Pages aren't all sheets — some collections (the ghost ship scans) include
// torn strips 3-4x taller or wider than they are long, and every size below
// was originally derived from width alone, so one tall strip made the whole
// phone swipe row (and a desktop thumbnail column) balloon to fit it. Each
// box is now the smaller of its usual width and the width that keeps it
// under a height cap, so ordinary sheets render exactly as before.
const SLIDE_MAX_H = "72svh";
const slideWidth = (ratio: number) => `min(${SLIDE_VW}vw, calc(${SLIDE_MAX_H} * ${ratio}))`;
// Tap/click-to-zoom. Nothing on the page signals it beyond the cursor on
// desktop — the page just answers where it's touched. ZOOM is how far in;
// pages are saved at 2400px on the long edge, so 3x stays sharp.
const ZOOM = 3;
// x/y: the tapped point, as fractions of the page. low: the resized copy
// already on screen, shown zoomed at once while the full-size original
// downloads, so a zoom never opens onto a blank (white) box.
type Zoom = { x: number; y: number; low?: string };
const shownSrc = (el: HTMLElement) => el.querySelector("img")?.currentSrc || undefined;

const LABEL_STYLE: React.CSSProperties = {
  fontSize:      "0.7rem",
  fontWeight:    500,
  letterSpacing: "0.15em",
  fontVariant:   "small-caps",
  color:         "#ffa31a",
};

export default function ScanExpanded({
  collection,
  onClose,
  narrow,
}: {
  collection: ScanCollection;
  onClose: () => void;
  narrow: boolean;
}) {
  const [heroIndex, setHeroIndex] = useState(0);
  const hero = collection.pages[heroIndex];
  // Zoom always belongs to the page being shown; moving to another page
  // (thumbnail, arrow key, or a swipe once zoom is off) drops it.
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => { setZoom(null); }, [heroIndex]);
  const pointIn = (e: React.MouseEvent, el: HTMLElement): Zoom => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      low: shownSrc(el),
    };
  };
  // The zoomed layer uses the original file rather than Next's resized one;
  // starting the download on hover means it's usually there by the click.
  const warm = (src: string) => { const img = new window.Image(); img.src = src; };
  const count = collection.pages.length;

  const trackRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const indexRef = useRef(0);
  indexRef.current = heroIndex;

  // Desktop: the filmstrip's width depends on how many columns its
  // thumbnails wrap into, which only the browser knows. The hero needs it so
  // a very wide page can shrink to fit beside the strip rather than pushing
  // the strip onto a hidden second line.
  const [stripWidth, setStripWidth] = useState(0);
  useEffect(() => {
    const strip = stripRef.current;
    if (narrow || !strip) return;
    setStripWidth(strip.offsetWidth);
    const ro = new ResizeObserver(() => setStripWidth(strip.offsetWidth));
    ro.observe(strip);
    return () => ro.disconnect();
  }, [narrow]);

  // Slides can differ in width (see slideWidth), so positions come from the
  // slides themselves rather than index × one fixed step.
  const slideCenter = (track: HTMLDivElement, i: number) => {
    const el = track.children[i] as HTMLElement | undefined;
    return el ? el.offsetLeft + el.offsetWidth / 2 : 0;
  };

  const goTo = (i: number) => {
    const next = (i + count) % count;
    const track = trackRef.current;
    if (narrow && track) track.scrollTo({ left: slideCenter(track, next) - track.clientWidth / 2, behavior: "smooth" });
    else setHeroIndex(next);
  };

  const onTrackScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const mid = track.scrollLeft + track.clientWidth / 2;
    let i = 0;
    for (let j = 1; j < count; j++) {
      if (Math.abs(slideCenter(track, j) - mid) < Math.abs(slideCenter(track, i) - mid)) i = j;
    }
    if (i !== indexRef.current) setHeroIndex(i);
  };

  // DOWNLOAD IMAGE hands over the full-size file of the page being shown
  // (not "SAVE" — that's the writing popup's word for keeping a piece). On touch
  // devices that's the share sheet (Save Image to Photos, or straight into
  // an Instagram story); on a computer, a plain download. Safari only lets
  // share() open inside the tap's own gesture window, so the file starts
  // fetching on pointerdown and the click just awaits that same request.
  const fileRequests = useRef(new Map<string, Promise<File>>());
  const pageFile = (i: number) => {
    const page = collection.pages[i];
    let req = fileRequests.current.get(page.src);
    if (!req) {
      const ext = page.src.split(".").pop() ?? "jpg";
      const name = `${collection.slug}-${String(i + 1).padStart(2, "0")}.${ext}`;
      req = fetch(page.src)
        .then((r) => r.blob())
        .then((b) => new File([b], name, { type: b.type || "image/jpeg" }));
      // A failed fetch shouldn't stick — the next tap tries again.
      req.catch(() => fileRequests.current.delete(page.src));
      fileRequests.current.set(page.src, req);
    }
    return req;
  };
  const savePage = async () => {
    const file = await pageFile(heroIndex);
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // closed the sheet
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Opening from far down the grid would otherwise leave the phone scrolled
  // past the top of a much shorter page.
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Pinch is the phone's own instinct for "let me see that closer", so it
  // opens the same zoom a tap does — centred between the fingers — and
  // pinching back in closes it. Native listeners rather than React's,
  // because stopping the browser's page zoom needs preventDefault, which
  // React's passive touch handlers can't call. Safari also sends its own
  // gesture* events for pinches; those are cancelled too.
  useEffect(() => {
    const track = trackRef.current;
    if (!narrow || !track) return;
    let pinch: { d0: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      pinch = { d0: dist(e.touches) };
      warm(collection.pages[indexRef.current].src);
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const ratio = dist(e.touches) / pinch.d0;
      if (!zoomRef.current && ratio > 1.15) {
        const slide = track.children[indexRef.current] as HTMLElement | undefined;
        if (!slide) return;
        const r = slide.getBoundingClientRect();
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        setZoom({
          x: Math.min(1, Math.max(0, (mx - r.left) / r.width)),
          y: Math.min(1, Math.max(0, (my - r.top) / r.height)),
          low: shownSrc(slide),
        });
        pinch = null;
      } else if (zoomRef.current && ratio < 0.85) {
        setZoom(null);
        pinch = null;
      }
    };
    const onEnd = () => { pinch = null; };
    const stopGesture = (e: Event) => e.preventDefault();
    track.addEventListener("touchstart", onStart, { passive: false });
    track.addEventListener("touchmove", onMove, { passive: false });
    track.addEventListener("touchend", onEnd);
    track.addEventListener("touchcancel", onEnd);
    track.addEventListener("gesturestart", stopGesture);
    track.addEventListener("gesturechange", stopGesture);
    return () => {
      track.removeEventListener("touchstart", onStart);
      track.removeEventListener("touchmove", onMove);
      track.removeEventListener("touchend", onEnd);
      track.removeEventListener("touchcancel", onEnd);
      track.removeEventListener("gesturestart", stopGesture);
      track.removeEventListener("gesturechange", stopGesture);
    };
  }, [narrow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (zoomRef.current) setZoom(null);
        else onClose();
      }
      if (e.key === "ArrowRight") goTo(indexRef.current + 1);
      if (e.key === "ArrowLeft")  goTo(indexRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Keep the current page's thumbnail in view as you swipe. Scrolls the
  // strip directly rather than scrollIntoView, which would also yank the
  // window vertically if the strip happened to be off screen.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = thumbRefs.current[heroIndex];
    if (!narrow || !strip || !thumb) return;
    strip.scrollTo({ left: thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2, behavior: "smooth" });
  }, [heroIndex, narrow]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={
        narrow
          ? { width: "100%" }
          : { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", width: "100%" }
      }
    >
      <div
        style={
          narrow
            ? { display: "flex", flexDirection: "column", gap: "1rem" }
            : { flex: 1, minHeight: 0, display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: "1.5rem" }
        }
      >
        {narrow ? (
          <div
            ref={trackRef}
            onScroll={onTrackScroll}
            style={{
              position:                "relative",
              display:                 "flex",
              alignItems:              "center",
              gap:                     `${SLIDE_GAP_VW}vw`,
              // Zoomed in, a drag pans the page instead of swiping away.
              overflowX:               zoom ? "hidden" : "auto",
              scrollSnapType:          "x mandatory",
              overscrollBehaviorX:     "contain",
              scrollbarWidth:          "none",
              WebkitOverflowScrolling: "touch",
              // Bleed past main's 5vw gutter to the screen edges so the
              // neighbouring pages can peek in, and pad the bottom so the
              // overflow doesn't clip the slides' drop shadow.
              margin:                  "0 -5vw -1.75rem",
              // Enough edge room for the first and last slide to center —
              // with ordinary sheets this works out to (100 - SLIDE_VW) / 2.
              paddingTop:              0,
              paddingBottom:           "2.75rem",
              paddingLeft:             `calc((100vw - ${slideWidth(collection.pages[0].ratio)}) / 2)`,
              paddingRight:            `calc((100vw - ${slideWidth(collection.pages[count - 1].ratio)}) / 2)`,
            }}
          >
            {collection.pages.map((page, i) => (
              <div
                key={page.src}
                // A tap only counts once the finger lifts — starting the
                // full-size download on touch-down wins that time back.
                onPointerDown={() => { if (i === heroIndex) warm(page.src); }}
                onClick={(e) => {
                  if (i !== heroIndex) { goTo(i); return; } // a peeking neighbour
                  if (!zoom) setZoom(pointIn(e, e.currentTarget));
                }}
                style={{
                  position:        "relative",
                  overflow:        "hidden",
                  // Swipes and page scrolling stay native; the browser's own
                  // pinch and double-tap page zoom are switched off here, so a
                  // pinch reaches the page zoom below instead of enlarging the
                  // whole site, and two quick taps mean zoom in, zoom out.
                  touchAction:     "pan-x pan-y",
                  flex:            `0 0 ${slideWidth(page.ratio)}`,
                  aspectRatio:     String(page.ratio),
                  scrollSnapAlign: "center",
                  scrollSnapStop:  "always",
                  boxShadow:       "0 14px 32px rgba(8,0,20,0.47)",
                }}
              >
                <Image
                  src={page.src}
                  alt={`${collection.title}, page ${i + 1}`}
                  fill
                  sizes={`${SLIDE_VW}vw`}
                  style={{ objectFit: "cover" }}
                  priority={i === 0}
                  // The pages either side are fetched up front so a swipe
                  // never lands on a blank slide.
                  // (Page 1 is `priority`, which already loads it eagerly —
                  // Next refuses priority together with loading="lazy".)
                  loading={i === 0 ? undefined : Math.abs(i - heroIndex) <= 1 ? "eager" : "lazy"}
                />
                {zoom && i === heroIndex && (
                  <PhoneZoom src={page.src} ratio={page.ratio} at={zoom} onDone={() => setZoom(null)} />
                )}
              </div>
            ))}
          </div>
        ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={heroIndex}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onPointerEnter={() => warm(hero.src)}
            onClick={(e) => setZoom(zoom ? null : pointIn(e, e.currentTarget))}
            // While zoomed the view follows the mouse: the point under the
            // cursor stays under it, so reading is just moving the hand.
            onMouseMove={(e) => { if (zoom) setZoom(pointIn(e, e.currentTarget)); }}
            style={
              narrow
                ? {
                    position:    "relative",
                    width:       "100%",
                    aspectRatio: String(hero.ratio),
                    boxShadow:   "0 14px 32px rgba(8,0,20,0.47)",
                  }
                : {
                    position:    "relative",
                    overflow:    "hidden",
                    cursor:      zoom ? "zoom-out" : "zoom-in",
                    // A very wide strip at full row height would be wider than
                    // the space beside the filmstrip and get clamped by
                    // maxWidth into a box of the wrong shape (cropping the
                    // page) — cap its height instead.
                    height:      `min(100%, calc((90vw - ${stripWidth}px - 2rem) / ${hero.ratio}))`,
                    maxWidth:    "100%",
                    alignSelf:   "center",
                    aspectRatio: String(hero.ratio),
                    boxShadow:   "0 14px 32px rgba(8,0,20,0.47)",
                    flexShrink:  0,
                  }
            }
          >
            <Image
              src={hero.src}
              alt={`${collection.title}, page ${heroIndex + 1}`}
              fill
              sizes={narrow ? "100vw" : "90vw"}
              style={{ objectFit: "cover" }}
              priority
            />
            <AnimatePresence>
              {zoom && (
                <motion.div
                  key="zoom"
                  initial={{ scale: 1 }}
                  animate={{ scale: ZOOM }}
                  exit={{ scale: 1 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                  style={{
                    position:        "absolute",
                    inset:           0,
                    transformOrigin: `${zoom.x * 100}% ${zoom.y * 100}%`,
                    pointerEvents:   "none",
                  }}
                >
                  <ZoomImage src={hero.src} low={zoom.low} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
        )}

        {collection.pages.length > 1 && (
          <div
            ref={stripRef}
            style={
              narrow
                ? { position: "relative", display: "flex", flexDirection: "row", alignItems: "center", gap: "0.65rem", overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "5px 5px 0.25rem" }
                : { display: "flex", flexDirection: "column", flexWrap: "wrap", gap: "0.75rem", height: "100%" }
            }
          >
            {collection.pages.map((page, i) => (
              <button
                key={page.src}
                ref={(el) => { thumbRefs.current[i] = el; }}
                onClick={() => goTo(i)}
                aria-label={`Page ${i + 1}`}
                style={{
                  position:    "relative",
                  width:       narrow
                    ? `min(calc(68px * ${page.ratio}), 136px)`
                    : `min(clamp(56px, 7vw, 84px), calc(140px * ${page.ratio}))`,
                  aspectRatio: String(page.ratio),
                  background:  "none",
                  border:      "none",
                  padding:     0,
                  cursor:      "pointer",
                  flexShrink:  0,
                  opacity:     i === heroIndex ? 1 : 0.55,
                  outline:     i === heroIndex ? "2px solid rgba(255,163,26,0.72)" : "none",
                  outlineOffset: "3px",
                  boxShadow:   "0 6px 14px rgba(8,0,20,0.39)",
                }}
              >
                <Image
                  src={page.src}
                  alt={`${collection.title}, page ${i + 1} thumbnail`}
                  fill
                  sizes="84px"
                  style={{ objectFit: "cover" }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The download sits at the far right, apart from the title/count —
          smaller and dimmer than the labels, brightening on hover, so it's
          there when wanted without competing with the page above it. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "2rem", marginTop: "0.85rem", flexShrink: 0 }}>
        <p style={{ ...LABEL_STYLE, opacity: 0.45, margin: 0 }}>
          {collection.title} · {heroIndex + 1}/{count}
        </p>
        <motion.button
          onPointerDown={() => { pageFile(heroIndex); }}
          onClick={savePage}
          aria-label={`Download image ${heroIndex + 1} of ${count}`}
          initial={{ opacity: 0.5 }}
          whileHover={{ opacity: 0.9 }}
          whileTap={{ opacity: 0.9 }}
          transition={{ duration: 0.2 }}
          style={{ ...LABEL_STYLE, fontSize: "0.6rem", letterSpacing: "0.2em", background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
        >
          DOWNLOAD IMAGE
        </motion.button>
      </div>
      {/* One line, same quiet gray as the counter above it — on desktop
          every extra line comes out of the hero's height, so captions are
          kept to a sentence rather than allowed to grow into a paragraph. */}
      {hero.caption && (
        <p
          style={{
            fontSize:      "0.8rem",
            letterSpacing: "0.01em",
            lineHeight:    1.4,
            color:         "#ffa31a",
            opacity:       0.62,
            marginTop:     "0.3rem",
            maxWidth:      "60ch",
            flexShrink:    0,
          }}
        >
          {hero.caption}
        </p>
      )}
    </motion.div>
  );
}

// Phone zoom: the slide's own box becomes a scroll window onto the page at
// ZOOM x, opened centred on the tapped point. Panning is the phone's native
// scroll (momentum and all); a tap that doesn't pan closes it. The swipe
// track behind it is locked while this is open, so a drag can't change page.
function PhoneZoom({ src, ratio, at, onDone }: { src: string; ratio: number; at: Zoom; onDone: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      ref={(el) => {
        if (!el || el.dataset.placed) return;
        el.dataset.placed = "1";
        const w = el.clientWidth * ZOOM;
        const h = w / ratio;
        el.scrollLeft = at.x * w - el.clientWidth / 2;
        el.scrollTop  = at.y * h - el.clientHeight / 2;
      }}
      onClick={(e) => { e.stopPropagation(); onDone(); }}
      style={{
        position:                "absolute",
        inset:                   0,
        overflow:                "auto",
        overscrollBehavior:      "contain",
        touchAction:             "pan-x pan-y",
        scrollbarWidth:          "none",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{ width: `${ZOOM * 100}%`, aspectRatio: String(ratio) }}>
        <ZoomImage src={src} low={at.low} />
      </div>
    </motion.div>
  );
}

// The resized copy already on screen, enlarged straight away, with the
// full-size original fading in over it once it has arrived — so zooming
// in is instant and only gets sharper, never blank.
function ZoomImage({ src, low }: { src: string; low?: string }) {
  const [sharp, setSharp] = useState(false);
  const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" };
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* eslint-disable @next/next/no-img-element -- plain imgs: one reuses the already-loaded resized copy, one is the full-size original */}
      {low && <img src={low} alt="" draggable={false} style={fill} />}
      <img
        src={src}
        alt=""
        draggable={false}
        // Already cached (warmed on hover / touch-down): no fade needed.
        ref={(el) => { if (el?.complete && el.naturalWidth && !sharp) setSharp(true); }}
        onLoad={() => setSharp(true)}
        style={{ ...fill, opacity: sharp ? 1 : 0, transition: "opacity 0.3s" }}
      />
      {/* eslint-enable @next/next/no-img-element */}
    </div>
  );
}
