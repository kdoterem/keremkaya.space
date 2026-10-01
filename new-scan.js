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

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const SCANS_DIR = path.join(__dirname, "public", "scans");
const FULL_SIZE = 2400;  // px, long edge — matches the hand-converted crooked-cross set
const THUMB_SIZE = 900;  // px, long edge — grid cover only

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

(async () => {
  console.log("\n── New Scan ───────────────────────────");

  let paths = process.argv.slice(2);
  if (paths.length === 0) paths = await promptPaths();

  if (paths.length === 0) { console.log("\nNo pages given."); rl.close(); process.exit(1); }

  const missing = paths.filter((p) => !fs.existsSync(p));
  if (missing.length) {
    console.log("\nCan't find:");
    missing.forEach((p) => console.log(`  ${p}`));
    console.log("\nNothing saved.");
    rl.close();
    process.exit(1);
  }

  const title = await prompt("Title");
  if (!title) { console.log("\nTitle is required."); rl.close(); process.exit(1); }

  const slug = slugify(title);
  const collectionDir = path.join(SCANS_DIR, slug);
  if (fs.existsSync(collectionDir)) {
    console.log(`\n"${slug}" already exists (public/scans/${slug}/). Pick a different title,`);
    console.log("or remove that folder first if you meant to redo it. Nothing saved.");
    rl.close();
    process.exit(1);
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
  if (confirm.toLowerCase() !== "y") { console.log("\nAborted.\n"); rl.close(); process.exit(0); }

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

  rl.close();
})().catch((err) => {
  console.error("\nCRASHED:", err);
  process.exit(1);
});
