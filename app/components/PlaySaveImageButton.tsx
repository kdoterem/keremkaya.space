"use client";

import { useCallback, useState } from "react";

// ── A PLAY-specific save-image button — deliberately not SaveImageButton
// reused wholesale (that one's a 1080x1920 story-format canvas+video
// pipeline built for full published poems with provenance-weighted
// text). This is the lighter version: a single static PNG, category
// label plus the reader's own writing, plain canvas + toBlob, no
// dependency. Lives inside the saved-writing popup — the moment the
// full, permanent piece is actually being looked at, same as
// SaveImageButton's own placement on /writing.
const W = 1080;
const H = 1350; // 4:5 — a feed-post ratio, not the story ratio /writing uses
const PAD_X = 90;
const PAD_TOP = 130;
const PAD_BOTTOM = 110;
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const MAX_FONT = 52;
const MIN_FONT = 28;
const LINE_HEIGHT_RATIO = 1.38;

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, fontSize: number): string[] {
  ctx.font = `500 ${fontSize}px ${FONT}`;
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") {
      lines.push("");
      continue;
    }
    let cur = "";
    for (const word of para.split(" ")) {
      const test = cur ? `${cur} ${word}` : word;
      if (cur && ctx.measureText(test).width > maxWidth) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

export default function PlaySaveImageButton({ category, text }: { category: string; text: string }) {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(() => {
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      return;
    }

    ctx.fillStyle = "#aaff00";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(10,10,10,0.45)";
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(category.toUpperCase(), PAD_X, PAD_TOP);

    const maxWidth = W - PAD_X * 2;
    const contentTop = PAD_TOP + 60;
    const contentBottom = H - PAD_BOTTOM;
    const budget = contentBottom - contentTop;

    // Shrink to fit rather than a fixed size — no ceiling on how long a
    // PLAY writing can be, so this has to hold a one-liner and a genuine
    // essay equally gracefully.
    let fontSize = MAX_FONT;
    let lines = wrapText(ctx, text, maxWidth, fontSize);
    while (fontSize > MIN_FONT && lines.length * (fontSize * LINE_HEIGHT_RATIO) > budget) {
      fontSize -= 2;
      lines = wrapText(ctx, text, maxWidth, fontSize);
    }

    const lineHeight = fontSize * LINE_HEIGHT_RATIO;
    const maxLines = Math.max(1, Math.floor(budget / lineHeight));
    let renderLines = lines;
    if (lines.length > maxLines) {
      // Still doesn't fit even at the smallest size — truncate rather
      // than overflow the canvas; a long real essay clipped with an
      // ellipsis is honest, an overflowing image is just broken.
      renderLines = lines.slice(0, maxLines);
      renderLines[maxLines - 1] = `${renderLines[maxLines - 1].trimEnd()} …`;
    }

    const usedHeight = renderLines.length * lineHeight;
    let y = contentTop + Math.max(0, (budget - usedHeight) / 2) + fontSize;
    ctx.fillStyle = "#0a0a0a";
    ctx.font = `500 ${fontSize}px ${FONT}`;
    for (const line of renderLines) {
      ctx.fillText(line, PAD_X, y);
      y += lineHeight;
    }

    ctx.fillStyle = "rgba(10,10,10,0.4)";
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText("PLAY · KEREMKAYA.SPACE", PAD_X, H - 50);

    canvas.toBlob((blob) => {
      if (!blob) {
        setBusy(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "play.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBusy(false);
    }, "image/png");
  }, [category, text]);

  return (
    <button onClick={handleClick} disabled={busy} className="export-btn">
      {busy ? "saving…" : "save image"}
    </button>
  );
}
