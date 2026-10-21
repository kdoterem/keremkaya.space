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
//   ./new-scan.js ~/Desktop/page1.tiff page2.jpg   paths given up front, only title/date/cover prompted
//   ./new-scan.js --cover <slug> ~/Desktop/cover.jpg   swap the cover of an existing collection
//   ./new-scan.js --captions <slug>                    add or edit an existing collection's captions
//
// Pages are saved in the order given — that's also reading order in the
// SCANS viewer. The grid cover is the first page unless a separate cover
// image is given: that one shows only on the grid, never as a page in the
// viewer, and the grid tile takes its shape from it. Any image format
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

// Local time, not toISOString() (UTC) — that would date a late-night scan
// to the previous day.
function localStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function today() {
  return localStamp().slice(0, 10);
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
  // -cropbox: honour a crop made in Preview. Preview's crop doesn't cut the
  // page, it only marks the part to show — without this flag pdftoppm
  // renders the whole uncropped page and the crop is silently lost.
  const r = spawnSync("pdftoppm", ["-jpeg", "-cropbox", "-r", String(PDF_DPI), pdfPath, path.join(tmpDir, prefix)], { encoding: "utf8" });
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
// What to call a page when asking for its caption: an expanded page's temp
// file name means nothing, so it's "scan.pdf, page 3" instead.
const pageLabel = new Map();
const labelFor = (p) => pageLabel.get(p) ?? path.basename(p);

function expandMultiPageFiles(paths, tmpDir) {
  const out = [];
  const addExpanded = (src, expanded) => {
    expanded.forEach((e, k) => pageLabel.set(e, `${path.basename(src)}, page ${k + 1}`));
    out.push(...expanded);
  };
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase();

    if (ext === ".pdf") {
      const expanded = expandPdf(p, tmpDir);
      console.log(`  ${path.basename(p)} → ${expanded.length} page${expanded.length === 1 ? "" : "s"}`);
      addExpanded(p, expanded);
      continue;
    }

    if (ext === ".tif" || ext === ".tiff") {
      const count = tiffPageCount(p);
      if (count > 1) {
        const expanded = expandTiff(p, tmpDir, count);
        console.log(`  ${path.basename(p)} → ${expanded.length} pages`);
        addExpanded(p, expanded);
        continue;
      }
    }

    out.push(p);
  }
  return out;
}

// One caption per page, shown under it in the viewer (a translation, or
// what the thing was — a sentence, not a paragraph). Enter alone leaves a
// page without one; there's deliberately no "add captions? y/n" gate in
// front of this, since a caption typed or pasted as the first thing would
// answer the gate instead (see new-post.js's history).
async function promptCaptions(labels, current = []) {
  console.log("\nCaptions — one line per page, Enter alone to leave a page without one.");
  if (current.some(Boolean)) console.log("Enter keeps what's there; type - to remove it.");
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    const had = current[i] || "";
    const val = await prompt(`  ${String(i + 1).padStart(2, "0")}/${String(labels.length).padStart(2, "0")}  ${labels[i]}`, had);
    out.push(val === "-" ? "" : val);
  }
  return out;
}

// Writes cover-thumb.jpg from `src` and returns its aspect ratio. A
// multi-page PDF/TIFF given as a cover uses its first page.
function writeCover(src, collectionDir) {
  const first = expandMultiPageFiles([src], tmpDir)[0];
  const { width, height } = sipsGetDims(first);
  sipsConvert(first, path.join(collectionDir, "cover-thumb.jpg"), THUMB_SIZE);
  return width / height;
}

// ./new-scan.js --cover <slug> <image> — replaces an existing collection's
// cover without touching its pages. "--cover <slug> first" goes back to
// using the first page.
function setCoverOnly(slug, src) {
  const collectionDir = path.join(SCANS_DIR, slug);
  const metaPath = path.join(collectionDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    console.log(`\nNo collection "${slug}" (public/scans/${slug}/meta.json). Nothing changed.`);
    finish(1);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  if (src === "first") {
    const firstPage = path.join(collectionDir, meta.pages[0].file);
    sipsConvert(firstPage, path.join(collectionDir, "cover-thumb.jpg"), THUMB_SIZE);
    meta.cover = "cover-thumb.jpg";
    delete meta.coverRatio;
  } else {
    if (!fs.existsSync(src)) { console.log(`\nCan't find: ${src}\nNothing changed.`); finish(1); }
    meta.cover = "cover-thumb.jpg";
    meta.coverRatio = writeCover(src, collectionDir);
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  console.log(`\nCover updated → public/scans/${slug}/cover-thumb.jpg${src === "first" ? " (first page)" : ""}`);
  console.log("Commit public/scans/ when you're happy with it.\n");
  finish(0);
}

// ./new-scan.js --captions <slug> — goes through an existing collection's
// pages, offering each current caption as the default.
async function editCaptionsOnly(slug) {
  const metaPath = path.join(SCANS_DIR, slug, "meta.json");
  if (!fs.existsSync(metaPath)) {
    console.log(`\nNo collection "${slug}" (public/scans/${slug}/meta.json). Nothing changed.`);
    finish(1);
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  const captions = await promptCaptions(meta.pages.map((p) => p.file), meta.pages.map((p) => p.caption));
  meta.pages.forEach((p, i) => {
    if (captions[i]) p.caption = captions[i];
    else delete p.caption;
  });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  const n = captions.filter(Boolean).length;
  console.log(`\nSaved → public/scans/${slug}/meta.json (${n} of ${meta.pages.length} pages captioned)`);
  console.log("Commit public/scans/ when you're happy with it.\n");
  finish(0);
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
  if (paths[0] === "--captions") {
    if (paths.length !== 2) { console.log("\nUsage: ./new-scan.js --captions <slug>"); finish(1); }
    return editCaptionsOnly(paths[1]);
  }
  if (paths[0] === "--cover") {
    if (paths.length !== 3) {
      console.log("\nUsage: ./new-scan.js --cover <slug> <image>   (or <slug> first, to go back to page 1)");
      finish(1);
    }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "new-scan-"));
    setCoverOnly(paths[1], paths[2]);
  }
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

  // A plain day for today gets the current time added, so two collections
  // made the same day still sort newest-first instead of alphabetically.
  let date = await prompt("Date", today());
  if (date === today()) date = localStamp();

  let coverPath = "";
  while (true) {
    const line = await prompt("Cover image — drag one in, or blank to use the first page");
    if (!line) break;
    const tok = parsePathTokens(line)[0];
    if (fs.existsSync(tok)) { coverPath = tok; break; }
    console.log(`  Can't find: ${tok}`);
  }
  const captions = await promptCaptions(paths.map(labelFor));


  console.log("\n────────────────────────────────────────");
  console.log(`  title:  ${title}`);
  console.log(`  slug:   ${slug}`);
  console.log(`  date:   ${date}`);
  console.log(`  cover:  ${coverPath ? path.basename(coverPath) : "first page"}`);
  console.log(`  pages:  ${paths.length}`);
  paths.forEach((p, i) => {
    console.log(`    ${String(i + 1).padStart(2, "0")}. ${labelFor(p)}${i === 0 && !coverPath ? "  (cover)" : ""}`);
    if (captions[i]) console.log(`        “${captions[i]}”`);
  });
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
    if (i === 0 && !coverPath) sipsConvert(src, path.join(collectionDir, "cover-thumb.jpg"), THUMB_SIZE);

    pages.push({ file, ratio: width / height, ...(captions[i] ? { caption: captions[i] } : {}) });
    console.log(" done");
  }

  const meta = { title, date, cover: "cover-thumb.jpg", pages };
  if (coverPath) meta.coverRatio = writeCover(coverPath, collectionDir);
  fs.writeFileSync(path.join(collectionDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(`\nSaved → public/scans/${slug}/ (${pages.length} page${pages.length === 1 ? "" : "s"})`);
  console.log("Dev server picks it up on refresh, no restart needed.");
  console.log("Commit public/scans/ when you're happy with it, same as any other content change.\n");

  finish(0);
})().catch((err) => {
  console.error("\nCRASHED:", err.message || err);
  finish(1);
});
