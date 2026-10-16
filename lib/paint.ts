// ── Lime paint thrown at text. A splash is a soft blob with spikes, flung
// drops and sometimes drips; it's drawn onto a canvas that becomes the text's
// own fill (background-clip: text), so the paint only ever lands on parts of
// letters — never whole letters on a fixed rhythm. The far-flung drops can be
// handed back to the page so they land on the ground around the text (FIND
// ME only — "it's the final").

export const LIME = "#aaff00";
export const BODY_ORANGE = "#ffa31a";

export type Drop = [x: number, y: number, size: number, angle: number];
type Rnd = () => number;

export function rng(seed: number): Rnd {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dot(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry = rx, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, Math.max(rx, 0.4), Math.max(ry, 0.4), rot, 0, Math.PI * 2);
  c.fill();
}

function blob(c: CanvasRenderingContext2D, rnd: Rnd, cx: number, cy: number, r: number) {
  const k = 22, p: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    const a = (i / k) * Math.PI * 2, rr = r * (0.72 + rnd() * 0.42);
    p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * (0.8 + rnd() * 0.3)]);
  }
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  c.beginPath();
  const m = mid(p[k - 1], p[0]);
  c.moveTo(m[0], m[1]);
  for (let i = 0; i < k; i++) {
    const n = mid(p[i], p[(i + 1) % k]);
    c.quadraticCurveTo(p[i][0], p[i][1], n[0], n[1]);
  }
  c.fill();
}

// one thrown splash; returns the drops that flew furthest out
export function splash(c: CanvasRenderingContext2D, rnd: Rnd, cx: number, cy: number, r: number, drips = true): Drop[] {
  const outer: Drop[] = [];
  blob(c, rnd, cx, cy, r);
  for (let i = 0; i < 3; i++) blob(c, rnd, cx + (rnd() - 0.5) * r * 0.9, cy + (rnd() - 0.5) * r * 0.7, r * (0.35 + rnd() * 0.3));
  const spikes = 5 + Math.floor(rnd() * 7);
  for (let i = 0; i < spikes; i++) {
    const a = rnd() * Math.PI * 2, len = r * (1.15 + rnd() * 1.3), w = r * (0.08 + rnd() * 0.1);
    const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len, nx = -Math.sin(a) * w, ny = Math.cos(a) * w;
    const bx = cx + Math.cos(a) * r * 0.6, by = cy + Math.sin(a) * r * 0.6;
    c.beginPath(); c.moveTo(bx + nx, by + ny); c.lineTo(ex, ey); c.lineTo(bx - nx, by - ny); c.fill();
    dot(c, ex, ey, w * (0.6 + rnd() * 0.7));
  }
  const n = 22 + Math.floor(rnd() * 34);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = r * (1.05 + Math.pow(rnd(), 1.6) * 2.6);
    const s = r * (0.025 + rnd() * 0.1) * Math.max(0.15, 1 - (d / r - 1) / 2.8);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    dot(c, x, y, s * (1 + rnd() * 1.2), s, a);
    if (d > r * 1.7) outer.push([x, y, s * (1 + rnd() * 0.6), a]);
  }
  if (drips) {
    for (let i = 0, k = Math.floor(rnd() * 3); i < k; i++) {
      const x = cx + (rnd() - 0.5) * r * 1.1, top = cy + r * 0.4, len = r * (0.6 + rnd() * 1.6), w = r * (0.06 + rnd() * 0.07);
      c.fillRect(x - w / 2, top, w, len);
      dot(c, x, top + len, w * 0.85, w * 1.1);
    }
  }
  return outer;
}

// "some" paint: roughly two splashes per 360×220 of text, sized to the text.
// x0..x1 is where the letters actually are inside the element's box (a block
// link is as wide as its column, its words aren't), so no throw is wasted on
// empty space; a single line still gets a splash big enough to read as paint.
// Draws in whatever fillStyle / composite mode the caller has set.
export function throwPaint(c: CanvasRenderingContext2D, w: number, h: number, rnd: Rnd, sizeFactor: number, x0 = 0, x1 = w): Drop[] {
  const tw = Math.max(1, x1 - x0);
  let n = ((tw * Math.max(h, 60)) / (360 * 220)) * 2 * 0.9;
  n = Math.max(1, Math.floor(n) + (rnd() < n % 1 ? 1 : 0));
  const drops: Drop[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.min(Math.max(h, 110), 240) * sizeFactor * (0.16 + rnd() * 0.16);
    drops.push(...splash(c, rnd, x0 + rnd() * tw, h * (0.08 + rnd() * 0.84), Math.max(r, 7)));
  }
  return drops;
}

export function paintTexture(w: number, h: number, seed: number, sizeFactor: number, x0 = 0, x1 = w) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cv = document.createElement("canvas");
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const c = cv.getContext("2d")!;
  c.scale(dpr, dpr);
  c.fillStyle = BODY_ORANGE; c.fillRect(0, 0, w, h);
  c.fillStyle = LIME;
  const drops = throwPaint(c, w, h, rng(seed), sizeFactor, x0, x1);
  return { url: cv.toDataURL(), drops };
}
