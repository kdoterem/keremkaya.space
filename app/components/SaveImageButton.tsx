'use client';

import { useState } from 'react';

interface Props {
  title: string;
  content: string; // raw MDX/markdown
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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    const words = para.split(' ');
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
  }
  return lines;
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

      const padX = 108;
      const contentWidth = W - padX * 2;
      ctx.textBaseline = 'top';

      let y = 220;

      // ── Title ────────────────────────────────────────────────────
      ctx.fillStyle = '#0a0a0a';
      ctx.font = `bold 64px ${font}`;

      const titleLines = wrapText(ctx, title, contentWidth);
      for (const line of titleLines) {
        ctx.fillText(line, padX, y);
        y += 80;
      }

      y += 48;

      // ── Divider ──────────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(10,10,10,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(W - padX, y);
      ctx.stroke();

      y += 64;

      // ── Content ──────────────────────────────────────────────────
      const plain = stripMarkdown(content);
      ctx.font = `38px ${font}`;
      ctx.fillStyle = '#0a0a0a';
      const lineH = 62;
      const maxContentY = H - 220; // reserve footer space

      const contentLines = wrapText(ctx, plain, contentWidth);
      let truncated = false;

      for (const line of contentLines) {
        if (y + lineH > maxContentY) {
          // Replace last drawn text with ellipsis indicator
          truncated = true;
          ctx.fillStyle = 'rgba(10,10,10,0.38)';
          ctx.fillText('…', padX, y);
          break;
        }
        // Empty lines get a smaller gap
        if (line === '') {
          y += lineH * 0.55;
          continue;
        }
        ctx.fillStyle = '#0a0a0a';
        ctx.fillText(line, padX, y);
        y += lineH;
      }

      void truncated; // suppress unused warning

      // ── Footer ───────────────────────────────────────────────────
      const footerY = H - 140;

      ctx.strokeStyle = 'rgba(10,10,10,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX, footerY - 44);
      ctx.lineTo(W - padX, footerY - 44);
      ctx.stroke();

      ctx.fillStyle = 'rgba(10,10,10,0.35)';
      ctx.font = `26px ${font}`;

      ctx.fillText('keremkaya.space', padX, footerY);

      const dateWidth = ctx.measureText(date).width;
      ctx.fillText(date, W - padX - dateWidth, footerY);

      // ── Download ─────────────────────────────────────────────────
      canvas.toBlob((blob) => {
        if (!blob) { setGenerating(false); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
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
      {generating ? 'generating…' : '↓ save as image'}
    </button>
  );
}
