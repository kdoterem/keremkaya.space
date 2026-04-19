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

// Returns visual lines ('' = paragraph gap), capped at maxLines
function buildLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  let truncated = false;

  for (const para of paragraphs) {
    if (lines.length >= maxLines) { truncated = true; break; }

    const trimmed = para.trim();
    if (!trimmed) {
      if (lines.length > 0) lines.push('');
      continue;
    }

    const wrapped = wrapParagraph(ctx, trimmed, maxWidth);
    for (const wl of wrapped) {
      if (lines.length >= maxLines) { truncated = true; break; }
      lines.push(wl);
    }
    if (truncated) break;
  }

  // trim trailing gaps
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { lines, truncated };
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

      ctx.textBaseline = 'top';

      const padX   = 120;
      const padTop = 220;
      const padBot = 200;
      const cw     = W - padX * 2;

      // ── Title ────────────────────────────────────────────────────
      ctx.font = `bold 70px ${font}`;
      ctx.fillStyle = '#0a0a0a';
      const titleLines = wrapParagraph(ctx, title, cw);
      const titleLineH = 88;
      let y = padTop;
      for (const line of titleLines) {
        ctx.fillText(line, padX, y);
        y += titleLineH;
      }
      const titleBottom = y;

      // ── Divider ──────────────────────────────────────────────────
      const divY = titleBottom + 60;
      ctx.strokeStyle = 'rgba(10,10,10,0.13)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padX, divY);
      ctx.lineTo(W - padX, divY);
      ctx.stroke();

      // ── Content zone boundaries ──────────────────────────────────
      const zoneTop = divY + 80;
      const footerH = 100;
      const zoneBot = H - padBot - footerH;
      const zoneH   = zoneBot - zoneTop;

      // ── Build content lines (max 14) ─────────────────────────────
      const plain      = stripMarkdown(content);
      const fontSize   = 42;
      const lineH      = Math.round(fontSize * 1.75); // ~73px
      const gapH       = Math.round(lineH * 0.5);    // ~37px paragraph gap

      ctx.font = `${fontSize}px ${font}`;
      const { lines, truncated } = buildLines(ctx, plain, cw, 14);

      // measure total block height
      let blockH = 0;
      for (const l of lines) blockH += l === '' ? gapH : lineH;
      if (truncated) blockH += lineH; // for the "…" line

      // vertically center block in zone
      const startY = zoneTop + Math.max(0, Math.round((zoneH - blockH) / 2));

      // ── Draw content ─────────────────────────────────────────────
      y = startY;
      for (const line of lines) {
        if (line === '') { y += gapH; continue; }
        ctx.fillStyle = '#0a0a0a';
        ctx.fillText(line, padX, y);
        y += lineH;
      }
      if (truncated) {
        ctx.fillStyle = 'rgba(10,10,10,0.3)';
        ctx.fillText('…', padX, y);
      }

      // ── Footer ───────────────────────────────────────────────────
      const fLineY = H - padBot - footerH + 8;
      const fTextY = fLineY + 36;

      ctx.strokeStyle = 'rgba(10,10,10,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, fLineY);
      ctx.lineTo(W - padX, fLineY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(10,10,10,0.35)';
      ctx.font = `27px ${font}`;
      ctx.fillText('keremkaya.space', padX, fTextY);
      const dw = ctx.measureText(date).width;
      ctx.fillText(date, W - padX - dw, fTextY);

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
          } catch { /* cancelled */ }
        }

        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
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
