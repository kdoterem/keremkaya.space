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

// Wrap a single line of text to fit maxWidth, returns array of lines
function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draw centered text, returns new y
function drawCentered(ctx: CanvasRenderingContext2D, text: string, y: number, W: number, color: string): number {
  const measured = ctx.measureText(text).width;
  ctx.fillStyle = color;
  ctx.fillText(text, (W - measured) / 2, y);
  return y;
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

      // Background
      ctx.fillStyle = '#aaff00';
      ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'top';

      const padX = 100;
      const cw   = W - padX * 2;

      // ── 1. Title — centered, bold, large ────────────────────────
      ctx.font = `bold 80px ${font}`;
      const titleWrapped = wrapLine(ctx, title, cw);
      const titleLineH   = 98;
      const titleBlockH  = titleWrapped.length * titleLineH;

      // ── 2. Content — first stanza only, centered ─────────────────
      const plain = stripMarkdown(content);
      // Take first stanza (lines up to the first blank line)
      const allParagraphs = plain.split('\n');
      const firstStanza: string[] = [];
      for (const para of allParagraphs) {
        if (!para.trim() && firstStanza.length > 0) break; // stop at blank line
        if (para.trim()) firstStanza.push(para.trim());
      }

      const contentFontSize = 46;
      const contentLineH    = Math.round(contentFontSize * 1.8); // 82px
      ctx.font = `${contentFontSize}px ${font}`;

      // Wrap each line of the stanza
      const contentLines: string[] = [];
      for (const line of firstStanza) {
        contentLines.push(...wrapLine(ctx, line, cw));
      }
      // Cap at 10 visual lines
      const truncated    = contentLines.length > 10;
      const visibleLines = truncated ? contentLines.slice(0, 10) : contentLines;
      const contentBlockH = visibleLines.length * contentLineH + (truncated ? contentLineH : 0);

      // ── 3. Layout: vertically center the whole poem block ────────
      const footerReserve = 180;
      const topReserve    = 240;
      const available     = H - topReserve - footerReserve;

      const gap        = 80; // between title and content
      const totalBlock = titleBlockH + gap + contentBlockH;
      const startY     = topReserve + Math.max(0, Math.round((available - totalBlock) / 2));

      // ── Draw title ───────────────────────────────────────────────
      ctx.font = `bold 80px ${font}`;
      let y = startY;
      for (const line of titleWrapped) {
        drawCentered(ctx, line, y, W, '#0a0a0a');
        y += titleLineH;
      }

      // ── Thin rule ────────────────────────────────────────────────
      const ruleY = y + Math.round(gap / 2) - 1;
      ctx.strokeStyle = 'rgba(10,10,10,0.12)';
      ctx.lineWidth   = 1;
      const ruleW     = Math.min(320, cw * 0.35);
      ctx.beginPath();
      ctx.moveTo((W - ruleW) / 2, ruleY);
      ctx.lineTo((W + ruleW) / 2, ruleY);
      ctx.stroke();

      y += gap;

      // ── Draw content ─────────────────────────────────────────────
      ctx.font = `${contentFontSize}px ${font}`;
      for (const line of visibleLines) {
        drawCentered(ctx, line, y, W, '#0a0a0a');
        y += contentLineH;
      }
      if (truncated) {
        drawCentered(ctx, '…', y, W, 'rgba(10,10,10,0.3)');
      }

      // ── Footer ───────────────────────────────────────────────────
      ctx.font = `26px ${font}`;
      const url       = 'keremkaya.space';
      const urlW      = ctx.measureText(url).width;
      const footerY   = H - 130;

      ctx.fillStyle = 'rgba(10,10,10,0.32)';
      ctx.fillText(url, (W - urlW) / 2, footerY);

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
