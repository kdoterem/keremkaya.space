// Prototype: real cartographic ink technique, built from real per-poem data
// (not per-month aggregates). Two things being proven before any of this
// touches the live component:
//   1. Hachures — short slope-aligned strokes, drawn from a heightfield
//      that's the SUM of one real Gaussian bump per real poem (Feb 2025's
//      67 poems, each a real bump at a deterministic position, weighted by
//      that poem's real word count) — not a single smooth curve.
//   2. Stippling — a real dot per real poem in a real calm cluster (13
//      poems, 2025-05-07 to 2025-06-14, each structurally spare: <=25
//      words, low line-length variance), scattered inside a bounded
//      shoreline sized to that real count.
// No fill, no color — same black-ink-on-green vocabulary as every pass so
// far, just a different, real technique for putting ink on the page.

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const POSTS_DIR = "/Users/keremkaya/Desktop/green website/content/posts";

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, content: raw };
  const fm = m[1];
  const data = {};
  for (const line of fm.split("\n")) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (mm) { let v = mm[2].trim(); v = v.replace(/^["']|["']$/g, ""); data[mm[1]] = v; }
  }
  return { data, content: m[2] };
}
function stats(content) {
  const words = content.trim().split(/\s+/).filter(Boolean);
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  const lineLens = lines.map(l => l.split(/\s+/).filter(Boolean).length);
  const mean = lineLens.length ? lineLens.reduce((a,b)=>a+b,0)/lineLens.length : 0;
  const variance = lineLens.length ? lineLens.reduce((a,b)=>a+(b-mean)**2,0)/lineLens.length : 0;
  return { words: words.length, lineCount: lineLens.length, variance };
}
const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith(".mdx") || f.endsWith(".md"));
const posts = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(POSTS_DIR, f), "utf8");
  const { data, content } = parseFrontmatter(raw);
  const date = String(data.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
  posts.push({ slug: f, date, ...stats(content) });
}
posts.sort((a, b) => a.date.localeCompare(b.date));

const mountainPoems = posts.filter(p => p.date.startsWith("2025-02"));
const lakePoems = posts.filter(p => p.date >= "2025-05-07" && p.date <= "2025-06-14" && p.words <= 25 && p.variance <= 4);
console.log("mountain (Feb 2025) real poems:", mountainPoems.length);
console.log("lake (May-Jun 2025 calm cluster) real poems:", lakePoems.length);

// ── deterministic hash (layout scatter, same role mulberry32 already
// plays elsewhere — decides WHERE a real poem's own bump/dot sits within
// its footprint, not what shape the ground takes) ──
function hash2D(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000000) / 1000000;
}
function slugHash(slug, salt) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0;
  return hash2D(h, salt, 7919);
}

// ── MOUNTAIN heightfield: one real Gaussian bump per real poem ──
const MOUNTAIN_CX = -3.2, MOUNTAIN_CZ = 0, MOUNTAIN_RADIUS = 1.7;
const BUMP_SIGMA_MIN = 0.22, BUMP_SIGMA_MAX = 0.5;
const BUMP_AMP_SCALE = 0.012;
// First attempt summed 67 real bumps directly, unbounded — Feb 2025's
// total word mass drove the accumulated height straight through the top
// of the frame (a mountain isn't visible if it's clipped). Two real
// fixes, not just a smaller number: (1) each bump's own amplitude is
// bounded to a real but modest 0.35..1.0 range from that poem's own word
// count relative to the busiest poem in the set, not an unbounded direct
// scale of it; (2) the field combines bumps with a saturating function
// (1 - exp(-sum)) instead of a raw sum, so height rises quickly where
// many real poems cluster and then genuinely levels off, the way a ridge
// actually does, rather than growing without limit as more real poems
// stack up.
const maxWords = Math.max(...mountainPoems.map(p => p.words));
const bumps = mountainPoems.map((p) => {
  const ru = slugHash(p.slug, 1), rv = slugHash(p.slug, 2);
  const ang = ru * Math.PI * 2;
  const rad = Math.sqrt(rv) * MOUNTAIN_RADIUS; // uniform disc distribution
  const x = MOUNTAIN_CX + Math.cos(ang) * rad;
  const z = MOUNTAIN_CZ + Math.sin(ang) * rad * 0.7; // flattened, matches depth compression
  const sigma = BUMP_SIGMA_MIN + slugHash(p.slug, 3) * (BUMP_SIGMA_MAX - BUMP_SIGMA_MIN);
  const amp = 0.35 + 0.65 * Math.sqrt(p.words / maxWords); // bounded per-poem contribution
  return { x, z, sigma, amp };
});
const HEIGHTFIELD_SATURATION = 0.42;
function heightfieldAt(x, z) {
  let rawSum = 0;
  for (const b of bumps) {
    const dx = x - b.x, dz = z - b.z;
    const d2 = dx*dx + dz*dz;
    rawSum += b.amp * Math.exp(-d2 / (2 * b.sigma * b.sigma));
  }
  return 1 - Math.exp(-rawSum * HEIGHTFIELD_SATURATION);
}
function gradientAt(x, z, eps) {
  const h = heightfieldAt(x, z);
  const dhx = (heightfieldAt(x+eps, z) - heightfieldAt(x-eps, z)) / (2*eps);
  const dhz = (heightfieldAt(x, z+eps) - heightfieldAt(x, z-eps)) / (2*eps);
  return { h, dhx, dhz };
}

// ── LAKE: one real dot-cluster per real poem in the calm cluster ──
const LAKE_CX = 0.6, LAKE_CZ = 0.3;
const LAKE_RADIUS = 0.22 + Math.sqrt(lakePoems.length) * 0.07; // real count sets real size, tighter than the first pass
const DOTS_PER_POEM_BASE = 6; // first pass (3) read as a scattered cluster, not water — density needed raising

const SCENE_WIDTH = 10, SCENE_DEPTH = 7, HEIGHT_SCALE = 3.2;
const CARPET_Y = -0.03;

// ── rasterizer (camera/z-buffer identical to prior passes) ──
const CAM_ELEV_DEG = 35, CAM_AZ_DEG = 28, CAM_DIST = SCENE_WIDTH*1.15;
const TARGET = { x: 0, y: HEIGHT_SCALE*0.2, z: 0 };
const W = 880, H = 460;
const FOV_DEG = 46, NEAR = 0.5;
const sub = (a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross = (a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const dot = (a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const normalize = (v)=>{const l=Math.hypot(v.x,v.y,v.z)||1;return {x:v.x/l,y:v.y/l,z:v.z/l};};
const elevRad = CAM_ELEV_DEG*Math.PI/180, azRad = CAM_AZ_DEG*Math.PI/180;
const camPos = {
  x: TARGET.x + CAM_DIST*Math.cos(elevRad)*Math.sin(azRad),
  y: TARGET.y + CAM_DIST*Math.sin(elevRad),
  z: TARGET.z + CAM_DIST*Math.cos(elevRad)*Math.cos(azRad),
};
const forward = normalize(sub(TARGET, camPos));
const right = normalize(cross(forward, {x:0,y:1,z:0}));
const up = cross(right, forward);
function worldToView(p) { const rel = sub(p, camPos); return { x: dot(rel,right), y: dot(rel,up), z: -dot(rel,forward) }; }
const fovRad = FOV_DEG*Math.PI/180, f = 1/Math.tan(fovRad/2), aspect = W/H;
function project(viewP) {
  const z = -viewP.z;
  if (z <= NEAR) return null;
  const ndcX = (f/aspect)*viewP.x/z, ndcY = f*viewP.y/z;
  return { x: (ndcX*0.5+0.5)*W, y: (1-(ndcY*0.5+0.5))*H, depth: z };
}
const MARGIN = 36;
const buf = Buffer.alloc(W*H*4);
for (let i=0;i<W*H;i++){ buf[i*4]=0xaa; buf[i*4+1]=0xff; buf[i*4+2]=0x00; buf[i*4+3]=255; }
const zbuffer = new Float32Array(W*H).fill(Infinity);
function blendPx(x, y, rgb, a) {
  if (x<0||x>=W||y<0||y>=H) return;
  const idx=(y*W+x)*4;
  buf[idx]  = Math.round(rgb[0]*a + buf[idx]*(1-a));
  buf[idx+1]= Math.round(rgb[1]*a + buf[idx+1]*(1-a));
  buf[idx+2]= Math.round(rgb[2]*a + buf[idx+2]*(1-a));
}
function drawLineZ(p0, p1, rgb, opacity) {
  const dx=p1.x-p0.x, dy=p1.y-p0.y;
  const steps = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let s=0;s<=steps;s++) {
    const t = s/steps;
    const x = Math.round(p0.x+dx*t), y = Math.round(p0.y+dy*t);
    const z = p0.depth + (p1.depth-p0.depth)*t;
    if (x<0||x>=W||y<0||y>=H) continue;
    const idx = y*W+x;
    if (z < zbuffer[idx] + 0.0005) { zbuffer[idx] = z; blendPx(x, y, rgb, opacity); }
  }
}
function drawDotZ(p, radiusPx, rgb, opacity) {
  const proj = project(worldToView(p));
  if (!proj) return;
  const cx = Math.round(proj.x), cy = Math.round(proj.y);
  for (let dy=-radiusPx; dy<=radiusPx; dy++) for (let dx=-radiusPx; dx<=radiusPx; dx++) {
    if (dx*dx+dy*dy > radiusPx*radiusPx) continue;
    const x = cx+dx, y = cy+dy;
    if (x<0||x>=W||y<0||y>=H) continue;
    const idx = y*W+x;
    if (proj.depth < zbuffer[idx]+0.0005) { zbuffer[idx]=proj.depth; blendPx(x,y,rgb,opacity); }
  }
}
function mulberry32Like(seed) {
  let s = seed;
  return () => { s|=0; s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
}
const bgRand = mulberry32Like(4242);
for (let i=0;i<700;i++) {
  const p = { x:(bgRand()-0.5)*SCENE_WIDTH*3, y:bgRand()*HEIGHT_SCALE*1.5, z:(bgRand()-0.5)*SCENE_DEPTH*7 };
  const proj = project(worldToView(p));
  if (proj) blendPx(Math.round(proj.x), Math.round(proj.y), [0x0a,0x0a,0x0a], 0.12);
}
// carpet (flat filled quads, same as every prior pass)
const CARPET_WIDTH = SCENE_WIDTH*1.9, CARPET_DEPTH = SCENE_DEPTH*2.4;
function fillTriZ(p0, p1, p2, rgb, opacity) {
  const minX=Math.max(0,Math.floor(Math.min(p0.x,p1.x,p2.x))), maxX=Math.min(W-1,Math.ceil(Math.max(p0.x,p1.x,p2.x)));
  const minY=Math.max(0,Math.floor(Math.min(p0.y,p1.y,p2.y))), maxY=Math.min(H-1,Math.ceil(Math.max(p0.y,p1.y,p2.y)));
  const area = (p1.x-p0.x)*(p2.y-p0.y)-(p1.y-p0.y)*(p2.x-p0.x);
  if (Math.abs(area) < 1e-6) return;
  for (let y=minY;y<=maxY;y++) for (let x=minX;x<=maxX;x++) {
    const px=x+0.5, py=y+0.5;
    const w0=((p1.x-px)*(p2.y-py)-(p1.y-py)*(p2.x-px))/area;
    const w1=((p2.x-px)*(p0.y-py)-(p2.y-py)*(p0.x-px))/area;
    const w2=1-w0-w1;
    if (w0>=-0.001&&w1>=-0.001&&w2>=-0.001) {
      const z = p0.depth*w0+p1.depth*w1+p2.depth*w2;
      const idx = y*W+x;
      if (z < zbuffer[idx]) { zbuffer[idx]=z; blendPx(x,y,rgb,opacity); }
    }
  }
}
{
  const segs = 20;
  for (let j=0;j<segs;j++) for (let i=0;i<segs;i++) {
    const x0=(i/segs-0.5)*CARPET_WIDTH, x1=((i+1)/segs-0.5)*CARPET_WIDTH;
    const z0=(j/segs-0.5)*CARPET_DEPTH, z1=((j+1)/segs-0.5)*CARPET_DEPTH;
    const quad = [{x:x0,y:CARPET_Y,z:z0},{x:x1,y:CARPET_Y,z:z0},{x:x1,y:CARPET_Y,z:z1},{x:x0,y:CARPET_Y,z:z1}];
    const projs = quad.map(p=>project(worldToView(p)));
    if (projs.some(p=>!p)) continue;
    fillTriZ(projs[0],projs[1],projs[2],[0x0d,0x0f,0x0a],0.22);
    fillTriZ(projs[0],projs[2],projs[3],[0x0d,0x0f,0x0a],0.22);
  }
}

// ── HACHURES: sample a grid over the mountain's footprint, draw a short
// downhill-aligned stroke wherever there's real slope. Density (how many
// grid points actually draw) and opacity both rise with slope steepness —
// steep ground reads darker/denser, flat ground gets no mark at all,
// which is the actual classical hachure convention (Lehmann's system),
// not an invented one. ──
const GRID_STEP = 0.055;
const SEA_LEVEL = 0.02;
const SLOPE_SCALE = 55;
const HACHURE_BASE_LEN = 0.09;
let hachureCount = 0;
for (let gx = MOUNTAIN_CX - MOUNTAIN_RADIUS*1.3; gx <= MOUNTAIN_CX + MOUNTAIN_RADIUS*1.3; gx += GRID_STEP) {
  for (let gz = -MOUNTAIN_RADIUS*1.0; gz <= MOUNTAIN_RADIUS*1.0; gz += GRID_STEP) {
    const { h, dhx, dhz } = gradientAt(gx, gz, 0.02);
    if (h < SEA_LEVEL) continue;
    const slope = Math.hypot(dhx, dhz);
    if (slope < 0.01) continue; // flat crown/flat skirt - no mark, real slope only
    const jx = (hash2D(Math.round(gx*1000), Math.round(gz*1000), 11) - 0.5) * GRID_STEP * 0.6;
    const jz = (hash2D(Math.round(gx*1000), Math.round(gz*1000), 13) - 0.5) * GRID_STEP * 0.6;
    const x = gx + jx, z = gz + jz;
    const dirX = -dhx / slope, dirZ = -dhz / slope; // downhill
    const len = Math.max(0.03, Math.min(HACHURE_BASE_LEN, HACHURE_BASE_LEN / (1 + slope*3)));
    const opacity = Math.max(0.15, Math.min(0.9, slope * SLOPE_SCALE * 0.02));
    const y0 = heightfieldAt(x, z) * HEIGHT_SCALE;
    const x1 = x + dirX*len, z1 = z + dirZ*len;
    const y1 = heightfieldAt(x1, z1) * HEIGHT_SCALE;
    { const pa = project(worldToView({x,y:y0,z})), pb = project(worldToView({x:x1,y:y1,z:z1}));
      if (pa && pb) drawLineZ(pa, pb, [0x0a,0x0a,0x0a], opacity); }
    hachureCount++;
  }
}
console.log("hachure strokes drawn:", hachureCount);

// ── STIPPLE: real dots for the real calm cluster ──
let dotCount = 0;
lakePoems.forEach((p, pi) => {
  const dotsForThis = Math.max(2, Math.round(DOTS_PER_POEM_BASE * (0.6 + p.words/25)));
  for (let d = 0; d < dotsForThis; d++) {
    const ru = slugHash(p.slug, d*2+1), rv = slugHash(p.slug, d*2+2);
    const ang = ru * Math.PI * 2;
    const rad = Math.sqrt(rv) * LAKE_RADIUS;
    const x = LAKE_CX + Math.cos(ang)*rad;
    const z = LAKE_CZ + Math.sin(ang)*rad*0.62;
    const y = CARPET_Y + 0.03; // flat water level, just above the carpet
    drawDotZ({x,y,z}, 2, [0x0a,0x0a,0x0a], 0.55);
    dotCount++;
  }
});
// a faint real shoreline so the stipple reads as bounded water, not scatter
{
  const segs = 48;
  let prev = null;
  for (let s=0;s<=segs;s++) {
    const a = (s/segs)*Math.PI*2;
    const p = { x: LAKE_CX+Math.cos(a)*LAKE_RADIUS*1.08, y: CARPET_Y+0.03, z: Math.sin(a)*LAKE_RADIUS*1.08*0.62 };
    const proj = project(worldToView(p));
    if (proj && prev) drawLineZ(prev, proj, [0x0a,0x0a,0x0a], 0.3);
    prev = proj;
  }
}
console.log("stipple dots drawn:", dotCount, "| lake radius:", LAKE_RADIUS.toFixed(2));

// PNG encode
function crc32(buf) {
  if (!crc32.table) { const t=new Uint32Array(256); for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;} crc32.table=t; }
  let crc=0xFFFFFFFF; for(let i=0;i<buf.length;i++) crc=crc32.table[(crc^buf[i])&0xFF]^(crc>>>8); return (crc^0xFFFFFFFF)>>>0;
}
function pngChunk(type, data) {
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
  const typeBuf=Buffer.from(type,"ascii");
  const crcBuf=Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf,data])),0);
  return Buffer.concat([len,typeBuf,data,crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig=Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4);
  ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0;
  const stride=width*4;
  const raw=Buffer.alloc((stride+1)*height);
  for (let y=0;y<height;y++) { raw[y*(stride+1)]=0; rgba.copy(raw, y*(stride+1)+1, y*stride, (y+1)*stride); }
  const idat=zlib.deflateSync(raw);
  return Buffer.concat([sig,pngChunk("IHDR",ihdr),pngChunk("IDAT",idat),pngChunk("IEND",Buffer.alloc(0))]);
}
const OUT_W = W + MARGIN*2, OUT_H = H + MARGIN*2 + 40;
const outBuf = Buffer.alloc(OUT_W*OUT_H*4);
for (let i=0;i<OUT_W*OUT_H;i++){ outBuf[i*4]=0xaa; outBuf[i*4+1]=0xff; outBuf[i*4+2]=0x00; outBuf[i*4+3]=255; }
for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
  const srcIdx=(y*W+x)*4, dstIdx=((y+MARGIN+40)*OUT_W+(x+MARGIN))*4;
  outBuf[dstIdx]=buf[srcIdx]; outBuf[dstIdx+1]=buf[srcIdx+1]; outBuf[dstIdx+2]=buf[srcIdx+2]; outBuf[dstIdx+3]=255;
}
fs.writeFileSync(path.join(__dirname, "ink-check.png"), encodePNG(OUT_W, OUT_H, outBuf));
console.log("wrote ink-check.png", OUT_W, "x", OUT_H);

function screenPos(worldP) { return project(worldToView(worldP)); }
function cropZoom(centerProj, name, cropSize, scale, offX=0, offY=0) {
  if (!centerProj) { console.log("no center for", name); return; }
  const cx = Math.round(centerProj.x)+offX, cy = Math.round(centerProj.y)+offY;
  const x0 = Math.max(0, cx-cropSize/2), y0 = Math.max(0, cy-cropSize/2);
  const cw = Math.min(cropSize, W-x0), ch = Math.min(cropSize, H-y0);
  const zoomW = cw*scale, zoomH = ch*scale;
  const zoomBuf = Buffer.alloc(zoomW*zoomH*4);
  for (let y=0;y<zoomH;y++) for (let x=0;x<zoomW;x++) {
    const srcX = x0+Math.floor(x/scale), srcY = y0+Math.floor(y/scale);
    const srcIdx=(srcY*W+srcX)*4, dstIdx=(y*zoomW+x)*4;
    zoomBuf[dstIdx]=buf[srcIdx]; zoomBuf[dstIdx+1]=buf[srcIdx+1]; zoomBuf[dstIdx+2]=buf[srcIdx+2]; zoomBuf[dstIdx+3]=255;
  }
  fs.writeFileSync(path.join(__dirname, name), encodePNG(zoomW, zoomH, zoomBuf));
  console.log("wrote", name, zoomW, "x", zoomH);
}
cropZoom(screenPos({x:MOUNTAIN_CX, y:heightfieldAt(MOUNTAIN_CX,0)*HEIGHT_SCALE*0.5, z:0}), "ink-mountain-zoom.png", 320, 2.2, 0, 40);
cropZoom(screenPos({x:LAKE_CX, y:CARPET_Y+0.03, z:LAKE_CZ}), "ink-lake-zoom.png", 240, 3);
