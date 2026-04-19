'use client';

import { useState } from 'react';

interface Props {
  title: string;
  content: string;
  date: string;
}

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

// Returns wrapped lines for a single paragraph at current ctx font
function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Given a font size, return all visual lines (empty string = blank gap between paras)
function getLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, fontSize: number, font: string): string[] {
  ctx.font = `${fontSize}px ${font}`;
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();
    if (!para) {
      if (lines.length > 0) lines.push(''); // paragraph gap
      continue;
    }
    lines.push(...wrapParagraph(ctx, para, maxWidth));
  }
  // trim trailing gaps
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Total pixel height of lines array
function linesHeight(lines: string[], lineH: number, gapH: number): number {
  let h = 0;
  for (const l of lines) {
    h += l === '' ? gapH : lineH;
  }
  return h;
}

export default function SaveImageButton({ title, content, date }: Props) {
  const [generating, setGenerating] = useState(false);

  const handleSave = () => {
    setGenerating(true);

    setTimeout(() => {
      const canvas = document.createElement('canvas');
      const W = 1080;
      const H = 1920;
      canvas.width = W;
      canvas.height = H;

      const ctx = canvas.getContext('2d')!;
      const font = '"Helvetica Neue", Helvetica, Arial, sans-serif';

      // ── Background ───────────────────────────────────────────────
      ctx.fillStyle = '#aaff00';
      ctx.fillRect(0, 0, W, H);

      const padX    = 120;
      const padTop  = 200;
      const padBot  = 160;
      const cw      = W - padX * 2; // content width
      ctx.textBaseline = 'top';

      // ── Title ────────────────────────────────────────────────────
      const titleSize = 72;
      const titleLineH = 86;
      ctx.font = `bold ${titleSize}px ${font}`;
      ctx.fillStyle = '#0a0a0a';

      const titleLines = wrapParagraph(ctx, title, cw);
      let y = padTop;
      for (const line of titleLines) {
        ctx.fillText(line, padX, y);
        y += titleLineH;
      }

      const afterTitle = y;

      // ── Divider ──────────────────────────────────────────────────
      const dividerY = afterTitle + 52;
      ctx.strokeStyle = 'rgba(10,10,10,0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padX, dividerY);
      ctx.lineTo(W - padX, dividerY);
      ctx.stroke();

      const contentStartY = dividerY + 68;

      // ── Footer height (reserved) ─────────────────────────────────
      const footerH   = 100; // footer text + gap above divider
      const maxContentH = H - contentStartY - footerH - padBot;

      // ── Dynamic font size: fit content ───────────────────────────
      const plain = stripMarkdown(content);
      let fontSize = 40;
      const minSize = 24;
      let contentLines: string[] = [];

      while (fontSize >= minSize) {
        const lineH  = Math.round(fontSize * 1.65);
        const gapH   = Math.round(lineH * 0.55);
        contentLines = getLines(ctx, plain, cw, fontSize, font);
        if (linesHeight(contentLines, lineH, gapH) <= maxContentH) break;
        fontSize -= 2;
      }

      const lineH = Math.round(fontSize * 1.65);
      const gapH  = Math.round(lineH * 0.55);

      // If still too tall at minSize, truncate lines
      if (linesHeight(contentLines, lineH, gapH) > maxContentH) {
        let usedH = 0;
        const trimmed: string[] = [];
        for (const line of contentLines) {
          const inc = line === '' ? gapH : lineH;
          if (usedH + inc > maxContentH - lineH) {
            trimmed.push('…');
            break;
          }
          trimmed.push(line);
          usedH += inc;
        }
        contentLines = trimmed;
      }

      // ── Draw content ─────────────────────────────────────────────
      ctx.font = `${fontSize}px ${font}`;
      ctx.fillStyle = '#0a0a0a';
      y = contentStartY;

      for (const line of contentLines) {
        if (line === '') {
          y += gapH;
          continue;
        }
        if (line === '…') {
          ctx.fillStyle = 'rgba(10,10,10,0.35)';
          ctx.fillText(line, padX, y);
          break;
        }
        ctx.fillStyle = '#0a0a0a';
        ctx.fillText(line, padX, y);
        y += lineH;
      }

      // ── Footer ───────────────────────────────────────────────────
      const footerLineY = H - padBot - 68;
      const footerTextY = H - padBot - 30;

      ctx.strokeStyle = 'rgba(10,10,10,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, footerLineY);
      ctx.lineTo(W - padX, footerLineY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(10,10,10,0.38)';
      ctx.font = `26px ${font}`;
      ctx.fillText('keremkaya.space', padX, footerTextY);

      const dateWidth = ctx.measureText(date).width;
      ctx.fillText(date, W - padX - dateWidth, footerTextY);

      // ── Share (mobile) or Download (desktop) ─────────────────────
      const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;

      canvas.toBlob(async (blob) => {
        if (!blob) { setGenerating(false); return; }

        const file = new File([blob], filename, { type: 'image/png' });

        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title });
            setGenerating(false);
            return;
          } catch {
            // cancelled — fall through
          }
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setGenerating(false);
      }, 'image/png');
    }, 30);
  };

  return (
    <button
      onClick={handleSave}
      disabled={generating}
      style={{
        display: 'inline-block',
        fontSize: '0.65rem',
        fontWeight: 500,
        letterSpacing: '0.12em',
        fontVariant: 'small-caps',
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        color: generating ? 'rgba(10,10,10,0.35)' : '#0a0a0a',
        backgroundColor: 'transparent',
        border: '1px solid rgba(10,10,10,0.22)',
        padding: '0.55rem 1.2rem',
        cursor: generating ? 'default' : 'pointer',
        transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
        marginTop: '2.5rem',
        userSelect: 'none',
      }}
      onMouseEnter={e => {
        if (generating) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.backgroundColor = '#0a0a0a';
        el.style.color = '#aaff00';
        el.style.borderColor = '#0a0a0a';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.backgroundColor = 'transparent';
        el.style.color = generating ? 'rgba(10,10,10,0.35)' : '#0a0a0a';
        el.style.borderColor = 'rgba(10,10,10,0.22)';
      }}
    >
      {generating ? 'generating…' : '↑ share / save image'}
    </button>
  );
}
