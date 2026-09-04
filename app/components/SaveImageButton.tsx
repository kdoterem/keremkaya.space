'use client';

import { useState } from 'react';
import {
  getProvenanceTags,
  computeWeights,
  titleWeightStyle,
  aliveScaleFor,
  seededPhase,
  ALIVE_REST_COLOR,
  weightedTintFor,
} from '@/lib/tagProvenance';
import {
  Output as MbOutput,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  Quality as MbQuality,
  canEncodeVideo,
} from 'mediabunny';

interface Props {
  title: string;
  content: string;
  date: string;
  slug?: string;
  tags?: string[];
}

// ── constants ────────────────────────────────────────────────────────────────
const W     = 1080;
const H     = 1920;
const SCALE = 3;
const PAD_X = 100;
const CW    = W - PAD_X * 2;  // content width

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const TOP_RESERVE    = 240;
const FOOTER_RESERVE = 180;
const GAP            = 80;   // gap between title block and content

// Hashtag row shown above the "keremkaya.space" footer line, every page.
// Deliberately small/quiet like the footer itself — it's there so the tags
// read as real hashtags matching the caption, not as a second headline.
const TAG_FONT_SIZE        = 24;
const TAG_LINE_H           = 32;
const TAG_GAP_ABOVE_FOOTER = 20; // gap between the tag row and the footer text above it (page reads top-to-bottom, footer/tags anchor from the bottom up)
const TAG_COLOR            = 'rgba(10,10,10,0.4)';

const TITLE_SIZE   = 80;
const TITLE_LINE_H = 98;

const CONT_TITLE_SIZE   = 36;   // continuation-page title
const CONT_TITLE_LINE_H = 50;

const MAX_FONT = 46;
const MIN_FONT = 28;

// ── the moving cover — page 1 only, exported as a video ────────────────────────
// Continuation pages (2+, long poems only) stay static PNGs as before — a
// carousel of one moving cover + N stills works fine on Instagram, and
// re-encoding every page would multiply generation time for little gain
// (only the first file is what a direct share/post actually shows).
//
// Three tiers, tried in order, each a graceful fallback for the last:
//   1. fastRecordAnimatedPage (mediabunny + WebCodecs) — offline encoding,
//      NOT bound to real time, so a 45s clip still takes only a couple of
//      real seconds to generate. This is the one that actually matters —
//      Instagram Stories/feed play a shared video at its own native length,
//      so a 3.5s source clip was giving a 3.5s story regardless of how the
//      export got made. Needs WebCodecs (Safari 16.4+/iOS 16.4+, current
//      Chrome/Edge; older Firefox falls through).
//   2. recordAnimatedPage (MediaRecorder + captureStream) — the original
//      real-time recorder, kept as a fallback for browsers without
//      WebCodecs. Bound to real time (a 3.5s clip takes ~3.5 real seconds),
//      so it stays short on purpose — it's the rare path now, not the
//      common one.
//   3. renderPage (static PNG) — the universal fallback, works everywhere.

// Tier 1 — fast, offline, real duration.
const FAST_VIDEO_SCALE     = 1;    // same reasoning as RECORD_SCALE below — no need for the PNG's 3x supersampling
// 24fps over the full 45s duration is 1080 individual frames, each a real
// canvas paint + encode — genuinely slow on a phone, reported as the
// export "taking too long." The motion itself is a slow ambient
// drift/breathe, not fast action, so it doesn't need a high frame rate to
// read as smooth — dropping to 12fps roughly halves the total work (540
// frames instead of 1080) for the same 45s length and the same
// resolution/quality, and should be close to imperceptible for this
// specific kind of slow motion.
const FAST_VIDEO_FPS       = 12;
const FAST_VIDEO_DURATION_S = 45;  // the actual on-screen length once shared — matches what worked before this whole video system existed
const FAST_ANIM_CYCLE_S    = 3.5;  // the breath's own pacing — same seamless loop as before, just replayed ~13x to fill the export instead of being the export

// The site's signature sound — a synthesized underwater arrival (a
// muffled swell that builds and settles, ~6.5s), not a recording. Public
// asset because it's fetched client-side at export time. Plays once at
// the front of every exported video; the rest of the clip stays silent
// rather than looping it — it was built as a single arrival, not an
// ambient loop, so repeating it would undercut the whole point of it.
const SIGNATURE_SOUND_URL = '/sounds/signature-underwater.wav';

// Tier 2 — real-time fallback, deliberately short (see header comment).
const RECORD_SCALE = 1;   // video compresses anyway — the PNG's 3x supersampling would just be slower to draw per-frame for nothing
const RECORD_FPS   = 24;
const LOOP_S        = 3.5; // seconds per loop — long enough to read as a full "breath," short enough to stay light while real-time-bound

// Preference order for tier 2: real .mp4 first (posts directly as an
// Instagram-native video; Safari/iOS supports MediaRecorder→mp4 natively),
// then webm variants for browsers that can record but not to mp4. If none
// of these are supported either, the caller falls back to tier 3.
const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function pickVideoMimeType(): string | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return null;
  for (const type of VIDEO_MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch { /* unsupported string — keep trying */ }
  }
  return null;
}

// Feature-detects tier 1 — real capability check (asks the browser whether
// it can actually encode 'avc'/H.264 at this resolution), not just an
// API-presence check, since mediabunny's canEncodeVideo does the real work
// of probing VideoEncoder.isConfigSupported under the hood.
async function supportsFastVideo(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    return await canEncodeVideo('avc', { width: W, height: H });
  } catch {
    return false;
  }
}

function supportsCaptureStream(): boolean {
  return typeof document !== 'undefined' &&
    typeof (document.createElement('canvas') as unknown as { captureStream?: unknown }).captureStream === 'function';
}

// A word plus its offset within the full stripped-content string — carried
// through wrapping so a per-character provenance weight array (computed
// against that same stripped string) can be sliced back out per word once
// paragraphs have been split apart and re-wrapped.
interface WordTok { word: string; start: number }

// null = paragraph-gap sentinel (unchanged). A line is either a plain string
// (the original, untouched path — every post without provenance data) or an
// array of word tokens (the weighted path, only ever produced when a weight
// array was passed into buildPages).
type Line = string | WordTok[] | null;
type TitleLine = string | WordTok[];

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

// ── weighted variants — same wrap/centering shape as above, but tracking
// each word's source offset (so its weight can be looked up) and drawing
// each word in its own font instead of one flat fillText call. Only ever
// invoked when a weight array exists; the plain functions above are
// untouched and still handle every post without provenance data. ──

function tokenizeWords(text: string): WordTok[] {
  const words: WordTok[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) words.push({ word: m[0], start: m.index });
  return words;
}

// Same greedy width-based wrap as wrapLine, operating on word tokens instead
// of raw split(' ') strings so each line keeps its words' source offsets.
function wrapLineWithOffsets(
  ctx: CanvasRenderingContext2D,
  words: WordTok[],
  maxWidth: number,
): WordTok[][] {
  const out: WordTok[][] = [];
  let cur: WordTok[] = [];
  let curText = '';
  for (const tok of words) {
    const test = curText ? `${curText} ${tok.word}` : tok.word;
    if (ctx.measureText(test).width > maxWidth && curText) {
      out.push(cur);
      cur = [tok];
      curText = tok.word;
    } else {
      cur.push(tok);
      curText = test;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

// Highest weight level touching any character of this word — a word gets
// bolded if a span covers any part of it, matching how it reads visually
// rather than requiring full-word coverage.
function wordWeightLevel(weights: number[], word: WordTok): number {
  let max = 0;
  for (let i = word.start; i < word.start + word.word.length; i++) {
    if (weights[i] !== undefined) max = Math.max(max, weights[i]);
  }
  return max;
}

// Maps a weightStyle's React.CSSProperties (fontWeight + optional em-based
// fontSize) onto a canvas font string, falling back to the run's base
// weight/size when a level-0 style leaves them unset.
function canvasFontForWeightStyle(
  baseFontSize: number,
  baseFontWeight: string,
  style: React.CSSProperties,
): string {
  const fw = style.fontWeight ?? baseFontWeight;
  const sizeStr = typeof style.fontSize === 'string' ? style.fontSize : undefined;
  const mult = sizeStr ? parseFloat(sizeStr) : 1;
  const size = Math.round(baseFontSize * mult);
  return `${fw} ${size}px ${FONT}`;
}

// ctx.measureText is one of the pricier canvas calls, and the animated
// export was calling it for the SAME words at the SAME font/size on every
// single frame — 540 of them for a full export — even though word widths
// never actually change frame to frame; only each weighted word's own
// drift/scale transform does. (drawWeightedLineCenteredAnimated's own
// header comment already claimed this was "a static layout pass...
// computed once" — the code just never actually did that.) A cache fixes
// it without restructuring the paint pipeline: the key is the exact
// (font, text) pair, so it's correct by construction — after the first
// frame, every later call for the same word at the same size is a hit
// instead of real measurement work. Cleared at the start of each export
// (see fastRecordAnimatedPage/recordAnimatedPage) so it can't grow
// unbounded across multiple saves in one page session.
let measureCache = new Map<string, number>();
function measureTextCached(ctx: CanvasRenderingContext2D, text: string): number {
  const key = `${ctx.font}|${text}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;
  const width = ctx.measureText(text).width;
  measureCache.set(key, width);
  return width;
}

// Draws one line word-by-word, each in its own weight-appropriate font,
// manually positioned (canvas has no inline flow) and centered as a whole —
// the direct canvas equivalent of CryptoScramble/WeightedText's styled runs.
//
// tint (default off) applies weightedTintFor per weighted word instead of
// flat ALIVE_REST_COLOR everywhere — only ever turned on for body content.
// This function also draws the title (with titleWeightStyle), which stays
// on flat ALIVE_REST_COLOR always — the title's own weight-only emphasis
// is a deliberately different, untinted register from the body's.
function drawWeightedLineCentered(
  ctx: CanvasRenderingContext2D,
  words: WordTok[],
  weights: number[],
  y: number,
  baseFontSize: number,
  baseFontWeight: string,
  weightStyleFn: (level: number) => React.CSSProperties,
  tint = false,
) {
  const levels = words.map(w => wordWeightLevel(weights, w));
  const wordFonts = words.map((w, i) => {
    const level = levels[i];
    const style = level > 0 ? weightStyleFn(level) : {};
    return canvasFontForWeightStyle(baseFontSize, baseFontWeight, style);
  });

  ctx.font = `${baseFontWeight} ${baseFontSize}px ${FONT}`;
  const spaceWidth = measureTextCached(ctx, ' ');

  let totalWidth = 0;
  words.forEach((w, i) => {
    ctx.font = wordFonts[i];
    totalWidth += measureTextCached(ctx, w.word);
    if (i < words.length - 1) totalWidth += spaceWidth;
  });

  let x = (W - totalWidth) / 2;
  words.forEach((w, i) => {
    ctx.font = wordFonts[i];
    ctx.fillStyle = tint && levels[i] > 0 ? weightedTintFor(levels[i]) : ALIVE_REST_COLOR;
    ctx.fillText(w.word, x, y);
    x += measureTextCached(ctx, w.word) + (i < words.length - 1 ? spaceWidth : 0);
  });
}

// Animated variant of drawWeightedLineCentered — same static layout pass
// (word widths/positions are computed once, at base font size, and never
// change frame to frame; only each weighted word's transform does), but
// weighted words get a small drift + scale-breathe applied around their
// own center each frame, using the exact same amplitude vocabulary as the
// live page's AliveWeightedText (lib/tagProvenance.tsx's aliveScaleFor/
// seededPhase) — the export moves like the page it came from. No color
// change, same reasoning as AliveWeightedText: the motion alone is the
// "alive" signal.
//
// loopT is a 0..1 fraction of one LOOP_S-second loop. Every oscillation
// below runs an INTEGER number of cycles per loop (1 for drift, 2 for the
// scale breath), so sin/cos at loopT=1 always equals their value at
// loopT=0 regardless of a word's own phase offset — the recording loops
// seamlessly with no jump when Instagram (or anything else) auto-replays it.
function drawWeightedLineCenteredAnimated(
  ctx: CanvasRenderingContext2D,
  words: WordTok[],
  weights: number[],
  y: number,
  baseFontSize: number,
  baseFontWeight: string,
  loopT: number,
) {
  const levels = words.map(w => wordWeightLevel(weights, w));

  // Every word draws in the same base font — no weight/size bump. The
  // motion is the only distinguishing signal here (see AliveWeightedText,
  // which this mirrors); a heavier/bigger look on top of it was redundant.
  ctx.font = `${baseFontWeight} ${baseFontSize}px ${FONT}`;
  const spaceWidth = measureTextCached(ctx, ' ');
  // One measurement per word, reused for both the total-width pass and
  // the per-word draw pass below — was measuring every word twice per
  // frame before, on top of the cross-frame cache.
  const wordWidths = words.map(w => measureTextCached(ctx, w.word));

  let totalWidth = 0;
  words.forEach((_, i) => {
    totalWidth += wordWidths[i];
    if (i < words.length - 1) totalWidth += spaceWidth;
  });

  let x = (W - totalWidth) / 2;
  words.forEach((w, i) => {
    const wordWidth = wordWidths[i];
    const level = levels[i];

    if (level === 0) {
      ctx.fillStyle = ALIVE_REST_COLOR;
      ctx.fillText(w.word, x, y);
    } else {
      const { driftAmpX, driftAmpY, scaleAmp } = aliveScaleFor(level);
      const phase1 = seededPhase(w.start);
      const phase2 = seededPhase(w.start * 7 + 3);
      const dx = driftAmpX * Math.sin(2 * Math.PI * (loopT + phase1));
      const dy = driftAmpY * Math.sin(2 * Math.PI * (loopT + phase2 + 0.25));
      const scaleEnv = 0.5 - 0.5 * Math.cos(2 * Math.PI * (loopT * 2 + phase1)); // 0..1, 2 cycles/loop
      const s  = 1 + scaleAmp * scaleEnv;
      const cx = x + wordWidth / 2, cy = y + baseFontSize * 0.42;

      ctx.save();
      ctx.translate(cx + dx, cy + dy);
      ctx.scale(s, s);
      ctx.fillStyle = weightedTintFor(level);
      ctx.fillText(w.word, -wordWidth / 2, -baseFontSize * 0.42);
      ctx.restore();
    }
    x += wordWidth + (i < words.length - 1 ? spaceWidth : 0);
  });
}

// All of a post's frontmatter tags, printed as a wrapped hashtag row — the
// same set a caption would use, so the exported file and the caption read
// as the same tags instead of the tags only ever doing invisible work
// (weighting which words go bold/alive in the body). Multi-word tags lose
// their spaces ("mental illness" -> "#mentalillness") to read as real
// hashtags. No cap on tag count: even the archive's heaviest-tagged posts
// (13-14 tags) wrap to at most 3 short lines at this font size, so showing
// every tag doesn't risk breaking the layout.
function buildTagLines(ctx: CanvasRenderingContext2D, tags: string[] | undefined): string[] {
  if (!tags || !tags.length) return [];
  ctx.font = `${TAG_FONT_SIZE}px ${FONT}`;
  const text = tags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
  return wrapLine(ctx, text, CW);
}

// Extra footer height the tag row needs, on top of FOOTER_RESERVE. Zero
// when there are no tags, so a tagless post lays out pixel-identical to
// before this existed.
function tagBlockHeight(tagLines: string[]): number {
  return tagLines.length ? tagLines.length * TAG_LINE_H + TAG_GAP_ABOVE_FOOTER : 0;
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

function buildPages(
  title: string,
  content: string,
  titleWeights: number[] | undefined,
  bodyWeights: number[] | undefined,
  tags: string[] | undefined,
) {
  const mc  = document.createElement('canvas');
  const ctx = mc.getContext('2d')!;

  // Title block height — weighted path only when titleWeights exists
  // (provenance touched a span inside the title itself; several of the 8
  // posts' spans are body-only, so this can be undefined even when
  // bodyWeights isn't).
  ctx.font = `bold ${TITLE_SIZE}px ${FONT}`;
  const titleWrapped: TitleLine[] = titleWeights
    ? wrapLineWithOffsets(ctx, tokenizeWords(title), CW)
    : wrapLine(ctx, title, CW);
  const titleBlockH  = titleWrapped.length * TITLE_LINE_H;

  const tagLines   = buildTagLines(ctx, tags);
  const footerRsv  = FOOTER_RESERVE + tagBlockHeight(tagLines);

  // Available content height per page type
  const availPage1 = H - TOP_RESERVE - footerRsv - titleBlockH        - GAP;
  const availCont  = H - TOP_RESERVE - footerRsv - CONT_TITLE_LINE_H  - GAP;

  // Parse content
  const stripped   = stripMarkdown(content);
  const paragraphs = stripped.split('\n');

  // Cumulative offset of each paragraph within `stripped` — only used on the
  // weighted path, to recover each word's absolute index (and so its
  // weight) once paragraphs are split apart and independently re-wrapped.
  let cursor = 0;
  const paraOffsets: number[] = [];
  for (const para of paragraphs) {
    paraOffsets.push(cursor);
    cursor += para.length + 1; // +1 for the '\n' the split consumed
  }

  // Find largest font that fits everything on one page (or fall back to MIN_FONT)
  let fontSize = MAX_FONT;
  let allLines: Line[] = [];

  while (fontSize >= MIN_FONT) {
    ctx.font = `${fontSize}px ${FONT}`;
    const lines: Line[] = [];
    paragraphs.forEach((para, pi) => {
      if (!para.trim()) { if (lines.length) lines.push(null); return; }
      if (bodyWeights) {
        const trimmedPara = para.trim();
        const leadingWs   = para.length - para.trimStart().length;
        const paraStart   = paraOffsets[pi] + leadingWs;
        const words = tokenizeWords(trimmedPara).map(w => ({ word: w.word, start: paraStart + w.start }));
        lines.push(...wrapLineWithOffsets(ctx, words, CW));
      } else {
        lines.push(...wrapLine(ctx, para.trim(), CW));
      }
    });
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
  return { titleWrapped, pages, fontSize, lineH, gapH, tagLines };
}

// ── render one page ──────────────────────────────────────────────────────────

function renderPage(
  titleWrapped: TitleLine[],
  contentLines: Line[],
  title: string,
  pageNum: number,
  totalPages: number,
  fontSize: number,
  lineH: number,
  gapH: number,
  baseFilename: string,
  titleWeights: number[] | undefined,
  bodyWeights: number[] | undefined,
  tagLines: string[],
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
    const available     = H - TOP_RESERVE - FOOTER_RESERVE - tagBlockHeight(tagLines);
    let y: number;

    if (pageNum === 1) {
      const titleBlockH = titleWrapped.length * TITLE_LINE_H;
      const totalBlock  = titleBlockH + GAP + contentBlockH;
      y = TOP_RESERVE + Math.max(0, Math.round((available - totalBlock) / 2));

      ctx.font = `bold ${TITLE_SIZE}px ${FONT}`;
      for (const line of titleWrapped) {
        if (Array.isArray(line)) {
          drawWeightedLineCentered(ctx, line, titleWeights!, y, TITLE_SIZE, '700', titleWeightStyle);
        } else {
          drawCentered(ctx, line, y, '#0a0a0a');
        }
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

    // Content lines — plain weight/color, no bodyWeightStyle bump and no
    // tint. This is the one export path that still had that on: the
    // animated cover (drawWeightedLineCenteredAnimated) already dropped it
    // in favor of motion being the only "alive" signal, matching the live
    // page's AliveWeightedText — but every static page (this button's own
    // image export, and every non-cover page of a video export) kept
    // bolding/tinting weighted words, so a saved/shared image read
    // noticeably darker than the site ever does. A still frame genuinely
    // has no motion to show, so the honest static equivalent is just: no
    // visible difference at all, same as glancing at the live page between
    // pulses of its own drift.
    ctx.font = `${fontSize}px ${FONT}`;
    for (const line of contentLines) {
      if (line === null) { y += gapH; continue; }
      if (Array.isArray(line)) {
        drawWeightedLineCentered(ctx, line, bodyWeights!, y, fontSize, '400', () => ({}));
      } else {
        drawCentered(ctx, line, y, '#0a0a0a');
      }
      y += lineH;
    }

    // Tag row — above the footer, bottom-anchored so it sits the same
    // distance above "keremkaya.space" regardless of line count.
    if (tagLines.length) {
      ctx.font = `${TAG_FONT_SIZE}px ${FONT}`;
      let ty = H - 130 - TAG_GAP_ABOVE_FOOTER - tagLines.length * TAG_LINE_H;
      for (const line of tagLines) {
        drawCentered(ctx, line, ty, TAG_COLOR);
        ty += TAG_LINE_H;
      }
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

// ── the moving cover — same layout math as renderPage above (title
// position, rule, content lines, footer), duplicated rather than shared so
// the proven static PNG path above is never at risk of being disturbed by
// the animated path. The only real difference: weighted lines go through
// drawWeightedLineCenteredAnimated (loopT-driven) instead of the static
// drawWeightedLineCentered, and the title is always drawn through the
// static function — never animated, on purpose (see AliveWeightedText's
// header comment). ──

function paintAnimatedFrame(
  ctx: CanvasRenderingContext2D,
  titleWrapped: TitleLine[],
  contentLines: Line[],
  title: string,
  pageNum: number,
  totalPages: number,
  fontSize: number,
  lineH: number,
  gapH: number,
  titleWeights: number[] | undefined,
  bodyWeights: number[] | undefined,
  loopT: number,
  tagLines: string[],
) {
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#aaff00';
  ctx.fillRect(0, 0, W, H);

  const contentBlockH = contentLines.reduce((h, l) => h + (l === null ? gapH : lineH), 0);
  const available     = H - TOP_RESERVE - FOOTER_RESERVE - tagBlockHeight(tagLines);
  let y: number;

  if (pageNum === 1) {
    const titleBlockH = titleWrapped.length * TITLE_LINE_H;
    const totalBlock  = titleBlockH + GAP + contentBlockH;
    y = TOP_RESERVE + Math.max(0, Math.round((available - totalBlock) / 2));

    ctx.font = `bold ${TITLE_SIZE}px ${FONT}`;
    for (const line of titleWrapped) {
      if (Array.isArray(line)) {
        drawWeightedLineCentered(ctx, line, titleWeights!, y, TITLE_SIZE, '700', titleWeightStyle);
      } else {
        drawCentered(ctx, line, y, '#0a0a0a');
      }
      y += TITLE_LINE_H;
    }
  } else {
    const totalBlock = CONT_TITLE_LINE_H + GAP + contentBlockH;
    y = TOP_RESERVE + Math.max(0, Math.round((available - totalBlock) / 2));

    ctx.font = `${CONT_TITLE_SIZE}px ${FONT}`;
    let display = title;
    while (ctx.measureText(display).width > CW && display.length > 1)
      display = display.slice(0, -1);
    if (display !== title) display = display.trimEnd() + '…';
    drawCentered(ctx, display, y, 'rgba(10,10,10,0.28)');
    y += CONT_TITLE_LINE_H;
  }

  drawRule(ctx, y + Math.round(GAP / 2) - 1);
  y += GAP;

  ctx.font = `${fontSize}px ${FONT}`;
  for (const line of contentLines) {
    if (line === null) { y += gapH; continue; }
    if (Array.isArray(line)) {
      drawWeightedLineCenteredAnimated(ctx, line, bodyWeights!, y, fontSize, '400', loopT);
    } else {
      drawCentered(ctx, line, y, '#0a0a0a');
    }
    y += lineH;
  }

  if (tagLines.length) {
    ctx.font = `${TAG_FONT_SIZE}px ${FONT}`;
    let ty = H - 130 - TAG_GAP_ABOVE_FOOTER - tagLines.length * TAG_LINE_H;
    for (const line of tagLines) {
      drawCentered(ctx, line, ty, TAG_COLOR);
      ty += TAG_LINE_H;
    }
  }

  const footerY = H - 130;
  ctx.font = `26px ${FONT}`;
  drawCentered(ctx, 'keremkaya.space', footerY, 'rgba(10,10,10,0.32)');
  if (totalPages > 1) {
    ctx.font = `22px ${FONT}`;
    drawCentered(ctx, `${pageNum} / ${totalPages}`, footerY + 36, 'rgba(10,10,10,0.22)');
  }
}

// Records one LOOP_S-second loop of paintAnimatedFrame into a short video
// file via canvas.captureStream() + MediaRecorder — no server, no encoding
// dependency. Rejects on any unsupported-API/recorder error; the caller
// catches that and falls back to the static PNG renderPage above, so a
// browser that can't do this never ends up with nothing.
function recordAnimatedPage(
  titleWrapped: TitleLine[],
  contentLines: Line[],
  title: string,
  pageNum: number,
  totalPages: number,
  fontSize: number,
  lineH: number,
  gapH: number,
  baseFilename: string,
  titleWeights: number[] | undefined,
  bodyWeights: number[] | undefined,
  mimeType: string,
  tagLines: string[],
): Promise<File> {
  measureCache.clear(); // fresh export, no reason to carry another post's cached word widths
  return new Promise((resolve, reject) => {
    const canvas  = document.createElement('canvas');
    canvas.width  = W * RECORD_SCALE;
    canvas.height = H * RECORD_SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(RECORD_SCALE, RECORD_SCALE);

    let recorder: MediaRecorder;
    try {
      const stream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream })
        .captureStream(RECORD_FPS);
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    } catch (err) { reject(err); return; }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = (e) => reject(e);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const filename = totalPages > 1 ? `${baseFilename}-${pageNum}.${ext}` : `${baseFilename}.${ext}`;
      resolve(new File([blob], filename, { type: mimeType }));
    };

    let start: number | null = null;
    function tick(ts: number) {
      if (start === null) start = ts;
      const elapsed = (ts - start) / 1000;
      const loopT   = (elapsed % LOOP_S) / LOOP_S;
      paintAnimatedFrame(ctx, titleWrapped, contentLines, title, pageNum, totalPages, fontSize, lineH, gapH, titleWeights, bodyWeights, loopT, tagLines);
      if (elapsed < LOOP_S) requestAnimationFrame(tick);
      else recorder.stop();
    }
    recorder.start();
    requestAnimationFrame(tick);
  });
}

// Fetches and decodes the signature sound, then pads it with silence out
// to the full video length — one AudioBuffer covering the whole
// timeline, rather than juggling a short buffer plus separate silence
// packets. copyToChannel leaves the rest of a freshly-created buffer at
// its default zero (silence), so padding is just "make it longer," not
// an explicit fill. Returns null on any failure (network, decoding,
// no AudioContext) — audio is a nice-to-have on top of the export, not
// something that should ever make the export itself fail.
async function loadSignatureAudioBuffer(totalDurationS: number): Promise<AudioBuffer | null> {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new Ctx();
    const res = await fetch(SIGNATURE_SOUND_URL);
    const arrayBuffer = await res.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);

    const totalSamples = Math.round(totalDurationS * decoded.sampleRate);
    const padded = audioCtx.createBuffer(decoded.numberOfChannels, totalSamples, decoded.sampleRate);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      padded.copyToChannel(decoded.getChannelData(ch), ch, 0);
    }
    return padded;
  } catch {
    return null; // silent export rather than a failed one
  }
}

// Tier 1 — offline encoding via mediabunny (WebCodecs under the hood).
// Draws and encodes FAST_VIDEO_DURATION_S * FAST_VIDEO_FPS frames in a
// tight loop; each call to videoSource.add() encodes one frame and is NOT
// bound to real time (per mediabunny's own docs — encoding runs as fast as
// the browser's encoder can go, so a 45-second export still takes only a
// couple of real seconds, not 45). Reuses paintAnimatedFrame exactly as
// tier 2 does — same drawing code, same loopT-driven seamless-loop math —
// just called many more times to fill a much longer timeline.
async function fastRecordAnimatedPage(
  titleWrapped: TitleLine[],
  contentLines: Line[],
  title: string,
  pageNum: number,
  totalPages: number,
  fontSize: number,
  lineH: number,
  gapH: number,
  baseFilename: string,
  titleWeights: number[] | undefined,
  bodyWeights: number[] | undefined,
  tagLines: string[],
  onProgress?: (frac: number) => void,
): Promise<File> {
  measureCache.clear(); // fresh export, no reason to carry another post's cached word widths
  const canvas  = document.createElement('canvas');
  canvas.width  = W * FAST_VIDEO_SCALE;
  canvas.height = H * FAST_VIDEO_SCALE;
  const ctx = canvas.getContext('2d')!;
  if (FAST_VIDEO_SCALE !== 1) ctx.scale(FAST_VIDEO_SCALE, FAST_VIDEO_SCALE);

  const output = new MbOutput({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  // Was dropped to 'medium' chasing a file-size theory for the sharing
  // bug that turned out to be wrong — the real cause was user-activation
  // timing (see deferredShareOrDownload/attemptShare), not size. Nothing
  // was actually protecting against by keeping quality down, so back to
  // 'high' — sharper/less compressed, no known downside now.
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    quality: new MbQuality('high'),
  });
  output.addVideoTrack(videoSource);

  // Tracks must be declared before output.start(), so the signature
  // sound has to be fetched/decoded up front rather than lazily during
  // the frame loop — audioBuffer is null (rather than throwing) on any
  // failure, and addAudioTrack is simply skipped in that case.
  const audioBuffer = await loadSignatureAudioBuffer(FAST_VIDEO_DURATION_S);
  const audioSource = audioBuffer
    ? new AudioBufferSource({ codec: 'aac', quality: new MbQuality('high') })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  if (audioSource && audioBuffer) await audioSource.add(audioBuffer);

  const totalFrames = Math.round(FAST_VIDEO_DURATION_S * FAST_VIDEO_FPS);
  const frameDur     = 1 / FAST_VIDEO_FPS;
  let lastReportedPct = -1;
  for (let i = 0; i < totalFrames; i++) {
    const t     = i * frameDur;
    const loopT = (t % FAST_ANIM_CYCLE_S) / FAST_ANIM_CYCLE_S;
    paintAnimatedFrame(ctx, titleWrapped, contentLines, title, pageNum, totalPages, fontSize, lineH, gapH, titleWeights, bodyWeights, loopT, tagLines);
    await videoSource.add(t, frameDur);
    // Only fire on an actual whole-percent change, not every one of the
    // 540 frames — that'd be 540 React re-renders for one export.
    if (onProgress) {
      const pct = Math.round((i / totalFrames) * 100);
      if (pct !== lastReportedPct) { lastReportedPct = pct; onProgress(pct / 100); }
    }
  }
  onProgress?.(1);

  await output.finalize();

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('mediabunny produced no output buffer');

  const filename = totalPages > 1 ? `${baseFilename}-${pageNum}.mp4` : `${baseFilename}.mp4`;
  return new File([buffer], filename, { type: 'video/mp4' });
}

// ── component ────────────────────────────────────────────────────────────────

type ExportMode = 'image' | 'video';

// The two buttons share this exact look (border swap on hover) — pulled out
// so both stay pixel-identical instead of two hand-copied style blocks
// drifting apart over time.
function ExportButton({
  label, busy, disabled, onClick, busyLabel,
}: {
  label: string; busy: boolean; disabled: boolean; onClick: () => void; busyLabel?: string;
}) {
  return (
    <button onClick={onClick} disabled={disabled} className="export-btn">
      {busy ? (busyLabel ?? 'generating…') : label}
    </button>
  );
}

export default function SaveImageButton({ title, content, slug, tags }: Props) {
  const [generating, setGenerating] = useState<ExportMode | null>(null);
  const [hint,       setHint]       = useState<string | null>(null);
  // Real progress through the video export (0..1), not a made-up
  // spinner — the frame loop in fastRecordAnimatedPage already knows
  // exactly which of ~540 frames it's on, so the button can say so
  // instead of just "generating…" for however long that takes.
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  // A finished video (or its fallback) waiting on a fresh tap to actually
  // share — see deferredShareOrDownload's comment for why this can't just
  // happen automatically.
  const [pendingShare, setPendingShare] = useState<{ files: File[]; hint: string | null } | null>(null);

  // Whether there's actually anything to animate — same check handleSaveVideo
  // does at click time (getProvenanceTags + computeWeights), just run once at
  // render time so the video button can be hidden entirely on posts with no
  // provenance data instead of appearing and then falling back to a still
  // image with an explanatory note. Works for every post automatically,
  // past or future — it's a live check against tag-provenance.json, not a
  // hardcoded list.
  const hasVideo = !!computeWeights(stripMarkdown(content), slug ? getProvenanceTags(slug) : undefined);

  // Shared prep for both modes — same data, same weighting functions as
  // /terrain and /writing (lib/tagProvenance.tsx). Posts with no provenance
  // entry get bodyWeights/titleWeights === undefined, and every render
  // function below already falls back to its original flat, unweighted
  // output when that's the case — untouched by any of this.
  function prepare() {
    const provenanceTags = slug ? getProvenanceTags(slug) : undefined;
    const titleWeights = computeWeights(title, provenanceTags);
    const bodyWeights  = computeWeights(stripMarkdown(content), provenanceTags);
    const { titleWrapped, pages, fontSize, lineH, gapH, tagLines } = buildPages(title, content, titleWeights, bodyWeights, tags);
    return {
      titleWeights, bodyWeights, titleWrapped, pages, fontSize, lineH, gapH, tagLines,
      totalPages: pages.length,
      baseFilename: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    };
  }

  // Sequential browser download — desktop, or the fallback once sharing
  // isn't available or fails.
  async function downloadFiles(orderedFiles: File[]) {
    for (let i = 0; i < orderedFiles.length; i++) {
      const url = URL.createObjectURL(orderedFiles[i]);
      const a   = document.createElement('a');
      a.href = url; a.download = orderedFiles[i].name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      if (i < orderedFiles.length - 1) await new Promise(r => setTimeout(r, 150));
    }
  }

  // The actual share attempt. MUST run inside a fresh, direct user
  // gesture — navigator.share() enforces "transient activation": call it
  // too long after the click/tap that led up to it and it throws
  // NotAllowedError regardless of file size. Confirmed on a real device:
  // a 9.7MB video, nowhere near any plausible share-size limit, still
  // NotAllowedError. This is why the image button (near-instant PNG
  // generation) has always worked while video hasn't — by the time
  // share() finally runs after several real seconds of encoding,
  // activation has already expired. See shareOrDownload vs
  // deferredShareOrDownload below for how each button accounts for this.
  //
  // Returns whether the share actually went through, so the caller knows
  // whether to fall back to a download.
  async function attemptShare(orderedFiles: File[]): Promise<boolean> {
    const sizeMB = (orderedFiles[0].size / 1_000_000).toFixed(1);
    const canShare = navigator.canShare?.({ files: orderedFiles });
    if (canShare) {
      try {
        await navigator.share({ files: orderedFiles, title });
        return true;
      } catch (err) {
        // AbortError is a real, ordinary cancellation — the user dismissed
        // the share sheet themselves, falls through to download silently
        // same as always. Anything else means canShare said yes but the
        // actual share attempt failed — previously that vanished
        // completely with zero trace, indistinguishable from a cancel.
        // Surfaced now (with the real error name/message and the file's
        // actual size/type) so a report of "still doesn't work" comes
        // with something concrete to diagnose instead of another guess.
        const isCancel = err instanceof DOMException && err.name === 'AbortError';
        if (!isCancel) {
          setHint(
            `sharing failed — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)} ` +
            `(file was ${sizeMB}MB, ${orderedFiles[0].type}). downloading instead.`
          );
        }
      }
    } else {
      // canShare() itself gives no reason for a false, just the boolean —
      // this is the other half of the same diagnostic gap: previously a
      // guess ("likely too large"), now the actual size/type is right on
      // screen so a report of "still doesn't work" is grounded in real
      // numbers instead of another theory.
      setHint(
        `this browser said it can’t share ${orderedFiles.length > 1 ? 'these files' : 'this file'} ` +
        `directly (${sizeMB}MB, ${orderedFiles[0].type}) — downloading instead. ` +
        `you can share manually from Photos/Files once it’s saved.`
      );
    }
    return false;
  }

  // Both the mobile Photos library (via the share sheet's "Save Images")
  // and desktop downloads shelves/folders commonly sort newest-first — so
  // saving/downloading in page order (1, 2, 3…) makes page 2 the most
  // recent, and it displays *above* page 1. Reversed to last-page-first /
  // page-1-last, whichever one lands most recently — page 1 — is the one
  // that sorts first, so the saved/downloaded order matches reading order.
  // Filenames are unaffected: they still read "-1", "-2"… regardless of
  // save order, self-documenting the intended order too.
  function orderPages(files: File[]): File[] {
    return files.length > 1 ? [...files].reverse() : files;
  }

  // Used by the image button, and the "nothing to animate" fallback in
  // handleSaveVideo — both generate their file(s) fast enough (a
  // near-instant PNG render) that the original click's user activation is
  // still valid by the time this runs, so it's safe to try sharing
  // immediately.
  async function shareOrDownload(files: File[], multiPageHint: string | null) {
    const orderedFiles = orderPages(files);
    if (multiPageHint) setHint(multiPageHint);
    const shared = await attemptShare(orderedFiles);
    if (!shared) await downloadFiles(orderedFiles);
  }

  // Used by the real video-generation path — several real seconds of
  // encoding stand between the click and this point, long enough that
  // user activation is gone, so attemptShare() would just throw
  // NotAllowedError no matter what. Instead: hold the finished file(s)
  // and surface an explicit "tap to share" button (see confirmPendingShare
  // and the render below) — that tap is itself a fresh gesture, so the
  // share call made inside its own handler stays inside a valid
  // activation window. On a browser with no Web Share support at all
  // (most desktop browsers), there's nothing to defer to — download runs
  // immediately, same as before.
  function deferredShareOrDownload(files: File[], multiPageHint: string | null) {
    const orderedFiles = orderPages(files);
    if (typeof navigator.share !== 'function') {
      if (multiPageHint) setHint(multiPageHint);
      void downloadFiles(orderedFiles);
      return;
    }
    setPendingShare({ files: orderedFiles, hint: multiPageHint });
  }

  async function confirmPendingShare() {
    if (!pendingShare) return;
    const { files, hint: multiPageHint } = pendingShare;
    setPendingShare(null);
    if (multiPageHint) setHint(multiPageHint);
    const shared = await attemptShare(files);
    if (!shared) await downloadFiles(files);
  }

  function multiPageImageHint(count: number): string {
    return `long poem — ${count} images. in the share sheet choose ` +
      `“save ${count} images”, then post them as a carousel in instagram. ` +
      `(sharing straight to instagram only sends one image, not the whole poem.)`;
  }

  const handleSaveImage = () => {
    setGenerating('image');
    setHint(null);
    setTimeout(async () => {
      try {
        const { titleWeights, bodyWeights, titleWrapped, pages, fontSize, lineH, gapH, tagLines, totalPages, baseFilename } = prepare();
        const files = await Promise.all(
          pages.map((lines, i) =>
            renderPage(titleWrapped, lines, title, i + 1, totalPages, fontSize, lineH, gapH, baseFilename, titleWeights, bodyWeights, tagLines)
          )
        );
        await shareOrDownload(files, files.length > 1 ? multiPageImageHint(files.length) : null);
      } catch (err) {
        console.error('image generation failed', err);
      }
      setGenerating(null);
    }, 30);
  };

  const handleSaveVideo = () => {
    setGenerating('video');
    setHint(null);
    setVideoProgress(0);
    setTimeout(async () => {
      try {
        const { titleWeights, bodyWeights, titleWrapped, pages, fontSize, lineH, gapH, tagLines, totalPages, baseFilename } = prepare();

        // Nothing to animate — a video would just be a static frame with a
        // misleading file extension. Same output the image button gives,
        // with a note explaining why.
        if (!bodyWeights) {
          const files = await Promise.all(
            pages.map((lines, i) =>
              renderPage(titleWrapped, lines, title, i + 1, totalPages, fontSize, lineH, gapH, baseFilename, titleWeights, bodyWeights, tagLines)
            )
          );
          setHint(
            'no highlight data for this poem yet, so there\'s nothing to animate — sharing a still image instead.' +
            (files.length > 1 ? ' ' + multiPageImageHint(files.length) : '')
          );
          await shareOrDownload(files, null); // hint already set above — don't let this overwrite it
          setGenerating(null);
          setVideoProgress(null);
          return;
        }

        let cover: File;
        try {
          if (await supportsFastVideo()) {
            cover = await fastRecordAnimatedPage(
              titleWrapped, pages[0], title, 1, totalPages, fontSize, lineH, gapH,
              baseFilename, titleWeights, bodyWeights, tagLines, setVideoProgress,
            );
          } else {
            const mimeType = supportsCaptureStream() ? pickVideoMimeType() : null;
            if (!mimeType) throw new Error('no video recording path available in this browser');
            cover = await recordAnimatedPage(
              titleWrapped, pages[0], title, 1, totalPages, fontSize, lineH, gapH,
              baseFilename, titleWeights, bodyWeights, mimeType, tagLines,
            );
          }
        } catch (err) {
          console.error('animated cover failed, falling back to a static image', err);
          cover = await renderPage(
            titleWrapped, pages[0], title, 1, totalPages, fontSize, lineH, gapH,
            baseFilename, titleWeights, bodyWeights, tagLines,
          );
        }

        const rest = await Promise.all(
          pages.slice(1).map((lines, i) =>
            renderPage(titleWrapped, lines, title, i + 2, totalPages, fontSize, lineH, gapH, baseFilename, titleWeights, bodyWeights, tagLines)
          )
        );
        const files   = [cover, ...rest];
        const isVideo = cover.type === 'video/mp4';

        deferredShareOrDownload(
          files,
          files.length <= 1 ? null : isVideo
            ? `long poem — ${files.length} files: a moving cover + ${files.length - 1} ` +
              `image${files.length - 1 === 1 ? '' : 's'}. in the share sheet choose ` +
              `“save ${files.length} items”, then post them as a carousel in instagram. ` +
              `(sharing straight to instagram only sends the first file, not the whole poem.)`
            : multiPageImageHint(files.length) // the cover itself fell back to a still too
        );
      } catch (err) {
        console.error('video generation failed', err);
      }
      setGenerating(null);
      setVideoProgress(null);
    }, 30);
  };

  return (
    <>
    <div style={{ display: 'flex', gap: '0.6rem', marginTop: '2.5rem', flexWrap: 'wrap' }}>
      {pendingShare ? (
        // The video's done — this tap IS the fresh user gesture the share
        // call needs (see deferredShareOrDownload's comment). Replaces
        // both normal buttons while waiting so there's no ambiguity about
        // which one to press, and so a stray tap on "save / share video"
        // doesn't kick off a whole second generation for no reason.
        <ExportButton
          label="→ tap to share the video"
          busy={false}
          disabled={false}
          onClick={confirmPendingShare}
        />
      ) : (
        <>
          <ExportButton
            label="↑ save / share image"
            busy={generating === 'image'}
            disabled={generating !== null}
            onClick={handleSaveImage}
          />
          {hasVideo && (
            <ExportButton
              label="↑ save / share video"
              busy={generating === 'video'}
              busyLabel={
                videoProgress !== null
                  ? `compiling… ${Math.round(videoProgress * 100)}%`
                  : 'generating…'
              }
              disabled={generating !== null}
              onClick={handleSaveVideo}
            />
          )}
        </>
      )}
    </div>

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
