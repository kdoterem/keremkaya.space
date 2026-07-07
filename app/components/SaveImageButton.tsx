'use client';

import { useState } from 'react';

interface Props {
  title: string;
  content: string;
  date: string;
}

// ── constants ────────────────────────────────────────────────────────────────
const W     = 1080;
const H     = 1920;
const SCALE = 2;
const PAD_X = 100;
const CW    = W - PAD_X * 2;  // content width

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const TOP_RESERVE    = 240;
const FOOTER_RESERVE = 180;
const GAP            = 80;   // gap between title block and content

const TITLE_SIZE   = 80;
const TITLE_LINE_H = 98;

const CONT_TITLE_SIZE   = 36;   // continuation-page title
const CONT_TITLE_LINE_H = 50;

const MAX_FONT = 46;
const MIN_FONT = 28;

type Line = string | null;  // null = paragraph-gap sentinel

// ── helpers ──────────────────────────────────────────────────────────────────

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/\*([\s\S]*?)\*/g, '$1')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) { out.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}

function drawCentered(ctx: CanvasRenderingContext2D, text: string, y: number, color: string) {
  const x = (W - ctx.measureText(text).width) / 2;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawRule(ctx: CanvasRenderingContext2D, y: number) {
  ctx.strokeStyle = 'rgba(10,10,10,0.12)';
  ctx.lineWidth   = 1;
  const rw = Math.min(320, CW * 0.35);
  ctx.beginPath();
  ctx.moveTo((W - rw) / 2, y);
  ctx.lineTo((W + rw) / 2, y);
  ctx.stroke();
}

// ── build pages ──────────────────────────────────────────────────────────────

function buildPages(title: string, content: string) {
  const mc  = document.createElement('canvas');
  const ctx = mc.getContext('2d')!;

  // Title block height
  ctx.font = `bold ${TITLE_SIZE}px ${FONT}`;
  const titleWrapped = wrapLine(ctx, title, CW);
  const titleBlockH  = titleWrapped.length * TITLE_LINE_H;

  // Available content height per page type
  const availPage1 = H - TOP_RESERVE - FOOTER_RESERVE - titleBlockH        - GAP;
  const availCont  = H - TOP_RESERVE - FOOTER_RESERVE - CONT_TITLE_LINE_H  - GAP;

  // Parse content
  const paragraphs = stripMarkdown(content).split('\n');

  // Find largest font that fits everything on one page (or fall back to MIN_FONT)
  let fontSize = MAX_FONT;
  let allLines: Line[] = [];

  while (fontSize >= MIN_FONT) {
    ctx.font = `${fontSize}px ${FONT}`;
    const lines: Line[] = [];
    for (const para of paragraphs) {
      if (!para.trim()) { if (lines.length) lines.push(null); continue; }
      lines.push(...wrapLine(ctx, para.trim(), CW));
    }
    while (lines.length && lines[lines.length - 1] === null) lines.pop();
    allLines = lines;

    const lh = Math.round(fontSize * 1.8);
    const gh = Math.round(lh * 0.5);
    const total = lines.reduce((h, l) => h + (l === null ? gh : lh), 0);
    if (total <= availPage1) break;
    fontSize -= 2;
  }

  const lineH = Math.round(fontSize * 1.8);
  const gapH  = Math.round(lineH * 0.5);

  // Split all lines into pages
  const pages: Line[][] = [];
  let remaining = [...allLines];
  while (remaining.length && remaining[0] === null) remaining.shift();

  let firstPage = true;
  while (remaining.length > 0) {
    const capacity  = firstPage ? availPage1 : availCont;
    const pageLines: Line[] = [];
    let usedH = 0;

    while (remaining.length > 0) {
      const next = remaining[0];
      const inc  = next === null ? gapH : lineH;
      if (usedH + inc > capacity) {
        if (pageLines.length === 0) pageLines.push(remaining.shift()!); // never stall
        break;
      }
      pageLines.push(remaining.shift()!);
      usedH += inc;
    }

    while (pageLines.length  && pageLines[pageLines.length - 1]  === null) pageLines.pop();
    while (remaining.length && remaining[0] === null) remaining.shift();

    if (pageLines.length) pages.push(pageLines);
    firstPage = false;
  }

  if (pages.length === 0) pages.push([]);
  return { titleWrapped, pages, fontSize, lineH, gapH };
}

// ── render one page ──────────────────────────────────────────────────────────

function renderPage(
  titleWrapped: string[],
  contentLines: Line[],
  title: string,
  pageNum: number,
  totalPages: number,
  fontSize: number,
  lineH: number,
  gapH: number,
  baseFilename: string,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas    = document.createElement('canvas');
    canvas.width    = W * SCALE;
    canvas.height   = H * SCALE;
    const ctx       = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = 'top';

    // Background
    ctx.fillStyle = '#aaff00';
    ctx.fillRect(0, 0, W, H);

    const contentBlockH = contentLines.reduce((h, l) => h + (l === null ? gapH : lineH), 0);
    const available     = H - TOP_RESERVE - FOOTER_RESERVE;
    let y: number;

    if (pageNum === 1) {
      const titleBlockH = titleWrapped.length * TITLE_LINE_H;
      const totalBlock  = titleBlockH + GAP + contentBlockH;
      y = TOP_RESERVE + Math.max(0, Math.round((available - totalBlock) / 2));

      ctx.font = `bold ${TITLE_SIZE}px ${FONT}`;
      for (const line of titleWrapped) {
        drawCentered(ctx, line, y, '#0a0a0a');
        y += TITLE_LINE_H;
      }
    } else {
      const totalBlock = CONT_TITLE_LINE_H + GAP + contentBlockH;
      y = TOP_RESERVE + Math.max(0, Math.round((available - totalBlock) / 2));

      // Small faded title on continuation pages
      ctx.font = `${CONT_TITLE_SIZE}px ${FONT}`;
      let display = title;
      while (ctx.measureText(display).width > CW && display.length > 1)
        display = display.slice(0, -1);
      if (display !== title) display = display.trimEnd() + '…';
      drawCentered(ctx, display, y, 'rgba(10,10,10,0.28)');
      y += CONT_TITLE_LINE_H;
    }

    // Rule
    drawRule(ctx, y + Math.round(GAP / 2) - 1);
    y += GAP;

    // Content lines
    ctx.font = `${fontSize}px ${FONT}`;
    for (const line of contentLines) {
      if (line === null) { y += gapH; continue; }
      drawCentered(ctx, line, y, '#0a0a0a');
      y += lineH;
    }

    // Footer
    const footerY = H - 130;
    ctx.font      = `26px ${FONT}`;
    ctx.fillStyle = 'rgba(10,10,10,0.32)';
    drawCentered(ctx, 'keremkaya.space', footerY, 'rgba(10,10,10,0.32)');

    if (totalPages > 1) {
      ctx.font = `22px ${FONT}`;
      drawCentered(ctx, `${pageNum} / ${totalPages}`, footerY + 36, 'rgba(10,10,10,0.22)');
    }

    const filename = totalPages > 1
      ? `${baseFilename}-${pageNum}.png`
      : `${baseFilename}.png`;

    canvas.toBlob(blob => {
      if (!blob) { reject(new Error('toBlob failed')); return; }
      resolve(new File([blob], filename, { type: 'image/png' }));
    }, 'image/png');
  });
}

// ── component ────────────────────────────────────────────────────────────────

export default function SaveImageButton({ title, content }: Props) {
  const [generating, setGenerating] = useState(false);
  const [hint,       setHint]       = useState<string | null>(null);

  const handleSave = () => {
    setGenerating(true);
    setHint(null);

    setTimeout(async () => {
      try {
        const { titleWrapped, pages, fontSize, lineH, gapH } = buildPages(title, content);
        const totalPages   = pages.length;
        const baseFilename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

        const files = await Promise.all(
          pages.map((lines, i) =>
            renderPage(titleWrapped, lines, title, i + 1, totalPages, fontSize, lineH, gapH, baseFilename)
          )
        );

        // Mobile: share sheet. Instagram (and most apps) only accept the FIRST
        // file from a web share — it can't receive a multi-image carousel — so
        // for long, multi-page poems steer the reader to "Save N Images" and let
        // them build the carousel in the Instagram app from their photos.
        // Only return on success — cancellation falls through to desktop download.
        if (navigator.canShare?.({ files })) {
          if (files.length > 1) {
            setHint(
              `long poem — ${files.length} images. in the share sheet choose ` +
              `“save ${files.length} images”, then post them as a carousel in instagram. ` +
              `(sharing straight to instagram only sends the first image.)`
            );
          }
          try {
            await navigator.share({ files, title });
            setGenerating(false);
            return;
          } catch { /* cancelled — fall through to download */ }
        }

        // Desktop: sequential download
        for (let i = 0; i < files.length; i++) {
          const url = URL.createObjectURL(files[i]);
          const a   = document.createElement('a');
          a.href = url; a.download = files[i].name;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a); URL.revokeObjectURL(url);
          if (i < files.length - 1) await new Promise(r => setTimeout(r, 150));
        }
      } catch (err) {
        console.error('image generation failed', err);
      }
      setGenerating(false);
    }, 30);
  };

  return (
    <>
    <button
      onClick={handleSave}
      disabled={generating}
      style={{
        display:         'inline-block',
        fontSize:        '0.65rem',
        fontWeight:      500,
        letterSpacing:   '0.12em',
        fontVariant:     'small-caps',
        fontFamily:      FONT,
        color:           generating ? 'rgba(10,10,10,0.35)' : '#0a0a0a',
        backgroundColor: 'transparent',
        border:          '1px solid rgba(10,10,10,0.22)',
        padding:         '0.55rem 1.2rem',
        cursor:          generating ? 'default' : 'pointer',
        transition:      'background-color 0.15s, color 0.15s, border-color 0.15s',
        marginTop:       '2.5rem',
        userSelect:      'none',
      }}
      onMouseEnter={e => {
        if (generating) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.backgroundColor = '#0a0a0a';
        el.style.color           = '#aaff00';
        el.style.borderColor     = '#0a0a0a';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.backgroundColor = 'transparent';
        el.style.color           = generating ? 'rgba(10,10,10,0.35)' : '#0a0a0a';
        el.style.borderColor     = 'rgba(10,10,10,0.22)';
      }}
    >
      {generating ? 'generating…' : '↑ share / save image'}
    </button>

    {hint && (
      <p
        style={{
          maxWidth:      '32rem',
          marginTop:     '0.9rem',
          fontSize:      '0.72rem',
          lineHeight:    1.5,
          letterSpacing: '0.01em',
          color:         'rgba(10,10,10,0.5)',
          fontFamily:    FONT,
        }}
      >
        {hint}
      </p>
    )}
    </>
  );
}
