#!/usr/bin/env node

// ── New Scan ──────────────────────────────────────────
// Self-serve counterpart to new-post.js, for SCANS (/answers). A collection
// is just a folder (public/scans/<slug>/) holding resized JPEGs plus a
// meta.json — lib/scans.ts reads that folder structure directly (see its
// own header comment), so this script is the *entire* authoring workflow:
// no file ever needs hand-editing afterward.
//
// Usage:
//   ./new-scan.js                              prompts for everything, including paths
//   ./new-scan.js ~/Desktop/page1.tiff page2.jpg   paths given up front, only title/date prompted
//
// Pages are saved in the order given — that's also reading order in the
// SCANS viewer, and the first page becomes the grid cover. Any image format
// sips can read works (TIFF, PNG, JPEG, HEIC, ...); output is always JPEG.
// A file that's actually several scans in one — a multi-page PDF, or a
// multi-page TIFF (some scanner software saves a whole multi-sheet batch
// as one .tiff with several frames in it, not several files) — works too:
// dropped in wherever it falls in the list, it expands into its pages in
// order before anything else runs, so a scanned-as-one-file batch needs no
// more effort than one dragged image.

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");

const SCANS_DIR = path.join(__dirname, "public", "scans");
const FULL_SIZE = 2400;  // px, long edge — matches the hand-converted crooked-cross set
const THUMB_SIZE = 900;  // px, long edge — grid cover only
const PDF_DPI = 300;     // render resolution for PDF pages, comfortably above FULL_SIZE after sips downsizes it

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lineQueue = [];
const lineWaiters = [];
rl.on("line", (line) => {
  if (lineWaiters.length) lineWaiters.shift()(line);
  else lineQueue.push(line);
});
function nextLine() {
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => lineWaiters.push(resolve));
}
async function prompt(label, defaultVal) {
  const hint = defaultVal ? ` (default: ${defaultVal})` : "";
  process.stdout.write(`\n${label}${hint}\n> `);
  const val = (await nextLine()).trim();
  return val || defaultVal || "";
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Finder's "drag file(s) into Terminal" produces one or more backslash-
// escaped, space-separated paths on a single line (its multi-drag drops
// them all at once) — same convention a shell uses, so this tokenizes the
// same way: an unescaped space ends a path, "\ " and "\(" etc. are a
// literal character, and a path may also just be quoted instead.
function parsePathTokens(line) {
  const tokens = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "\\" && i + 1 < line.length) { cur += line[i + 1]; i++; continue; }
    if (/\s/.test(ch)) {
      if (cur) { tokens.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

async function promptPaths() {
  const paths = [];
  console.log("\nDrag image files in (Finder → this window works), one page per line,");
  console.log("in the order they should appear. Blank line when done.");
  while (true) {
    const line = await prompt(`  [${paths.length} page${paths.length === 1 ? "" : "s"}]`);
    if (!line) break;
    for (const tok of parsePathTokens(line)) paths.push(tok);
  }
  return paths;
}

function sipsGetDims(filePath) {
  const r = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sips couldn't read "${filePath}":\n${r.stderr}`);
  const w = r.stdout.match(/pixelWidth:\s*(\d+)/);
  const h = r.stdout.match(/pixelHeight:\s*(\d+)/);
  if (!w || !h) throw new Error(`couldn't parse dimensions for "${filePath}"`);
  return { width: Number(w[1]), height: Number(h[1]) };
}

function sipsConvert(srcPath, destPath, maxDim) {
  const r = spawnSync("sips", [
    "-s", "format", "jpeg", "-s", "formatOptions", "85",
    "-Z", String(maxDim), srcPath, "--out", destPath,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`sips couldn't convert "${srcPath}":\n${r.stderr}`);
}

// Renders every page of a PDF to its own JPEG inside tmpDir and returns
// their paths, lowest page number first. pdftoppm names output
// "<prefix>-<n>.jpg" with no fixed digit width (page 2 of 4 is "-2", page 2
// of 14 is "-02"), so pages are reordered by the number itself rather than
// trusting that name to sort correctly as text.
function expandPdf(pdfPath, tmpDir) {
  if (spawnSync("which", ["pdftoppm"]).status !== 0) {
    throw new Error(
      `"${path.basename(pdfPath)}" is a PDF, but pdftoppm isn't installed to split it into pages.\n` +
      `  Install it with: brew install poppler\n` +
      `  — or rescan this one as individual image files instead.`
    );
  }
  const prefix = `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const r = spawnSync("pdftoppm", ["-jpeg", "-r", String(PDF_DPI), pdfPath, path.join(tmpDir, prefix)], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`pdftoppm couldn't read "${pdfPath}":\n${r.stderr}`);

  const pageRe = new RegExp(`^${prefix}-(\\d+)\\.jpg$`);
  return fs.readdirSync(tmpDir)
    .map((f) => ({ f, m: f.match(pageRe) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => path.join(tmpDir, x.f));
}

// Number of frames in a TIFF, via the same macOS-bundled tool that splits
// it (tiffutil ships with the OS — no install needed, unlike pdftoppm).
// Each page's own "Directory at ..." line in -info output is the count;
// an ordinary single-page TIFF has exactly one.
function tiffPageCount(tiffPath) {
  const r = spawnSync("tiffutil", ["-info", tiffPath], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`tiffutil couldn't read "${tiffPath}":\n${r.stderr}`);
  return (r.stdout.match(/^Directory at/gm) || []).length;
}

// Extracts every frame of a multi-page TIFF to its own file inside tmpDir,
// in order. Only called once tiffPageCount() has already confirmed there's
// more than one — tiffutil -extract works fine on a single-page TIFF too,
// this just never bothers calling it for the (overwhelmingly common) case.
function expandTiff(tiffPath, tmpDir, count) {
  const prefix = `tiff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const out = [];
  for (let i = 0; i < count; i++) {
    const dest = path.join(tmpDir, `${prefix}-${i}.tiff`);
    const r = spawnSync("tiffutil", ["-extract", String(i), tiffPath, "-out", dest], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`tiffutil couldn't extract page ${i + 1} of "${tiffPath}":\n${r.stderr}`);
    out.push(dest);
  }
  return out;
}

// Replaces any multi-page .pdf or .tiff entry in `paths` with its expanded
// pages, in place — a multi-page file counts as however many pages it
// actually has, not as one.
function expandMultiPageFiles(paths, tmpDir) {
  const out = [];
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();

    if (ext === ".pdf") {
      const expanded = expandPdf(p, tmpDir);
      console.log(`  ${path.basename(p)} → ${expanded.length} page${expanded.length === 1 ? "" : "s"}`);
      out.push(...expanded);
      continue;
    }

    if (ext === ".tif" || ext === ".tiff") {
      const count = tiffPageCount(p);
      if (count > 1) {
        const expanded = expandTiff(p, tmpDir, count);
        console.log(`  ${path.basename(p)} → ${expanded.length} pages`);
        out.push(...expanded);
        continue;
      }
    }

    out.push(p);
  }
  return out;
}

let tmpDir = null;
function finish(code) {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  rl.close();
  process.exit(code);
}

(async () => {
  console.log("\n── New Scan ───────────────────────────");

  let paths = process.argv.slice(2);
  if (paths.length === 0) paths = await promptPaths();

  if (paths.length === 0) { console.log("\nNo pages given."); finish(1); }

  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.log("\nCan't find:");
    missing.forEach((p) => console.log(`  ${p}`));
    console.log("\nNothing saved.");
    finish(1);
  }

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "new-scan-"));
  const expandedPaths = expandMultiPageFiles(paths, tmpDir);
  if (expandedPaths.length !== paths.length) console.log("");
  paths = expandedPaths;

  const title = await prompt("Title");
  if (!title) { console.log("\nTitle is required."); finish(1); }

  const slug = slugify(title);
  const collectionDir = path.join(SCANS_DIR, slug);
  if (fs.existsSync(collectionDir)) {
    console.log(`\n"${slug}" already exists (public/scans/${slug}/). Pick a different title,`);
    console.log("or remove that folder first if you meant to redo it. Nothing saved.");
    finish(1);
  }

  const date = await prompt("Date", today());

  console.log("\n────────────────────────────────────────");
  console.log(`  title:  ${title}`);
  console.log(`  slug:   ${slug}`);
  console.log(`  date:   ${date}`);
  console.log(`  pages:  ${paths.length}`);
  paths.forEach((p, i) => console.log(`    ${String(i + 1).padStart(2, "0")}. ${path.basename(p)}${i === 0 ? "  (cover)" : ""}`));
  console.log("────────────────────────────────────────");

  const confirm = await prompt("Save? (y/n)", "y");
  if (confirm.toLowerCase() !== "y") { console.log("\nAborted.\n"); finish(0); }

  fs.mkdirSync(collectionDir, { recursive: true });

  console.log("");
  const pages = [];
  for (let i = 0; i < paths.length; i++) {
    const src = paths[i];
    const num = String(i + 1).padStart(2, "0");
    const file = `${num}.jpg`;
    process.stdout.write(`  converting ${num}/${String(paths.length).padStart(2, "0")}...`);

    const { width, height } = sipsGetDims(src);
    sipsConvert(src, path.join(collectionDir, file), FULL_SIZE);
    if (i === 0) sipsConvert(src, path.join(collectionDir, "cover-thumb.jpg"), THUMB_SIZE);

    pages.push({ file, ratio: width / height });
    console.log(" done");
  }

  const meta = { title, date, cover: "cover-thumb.jpg", pages };
  fs.writeFileSync(path.join(collectionDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(`\nSaved → public/scans/${slug}/ (${pages.length} page${pages.length === 1 ? "" : "s"})`);
  console.log("Dev server picks it up on refresh, no restart needed.");
  console.log("Commit public/scans/ when you're happy with it, same as any other content change.\n");

  finish(0);
})().catch((err) => {
  console.error("\nCRASHED:", err.message || err);
  finish(1);
});
