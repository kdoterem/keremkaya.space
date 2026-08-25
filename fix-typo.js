#!/usr/bin/env node
// Fix a typo in a post AND every provenance span that quotes it, together.
// Editing just the .mdx isn't enough: computeWeights() (lib/tagProvenance.tsx)
// matches spans against the post text by exact substring, so a stale span
// just silently stops highlighting anything — no error, nothing visibly
// broken, it just quietly goes dead. This fixes both files in one step and
// verifies the result before writing anything.
//
// Usage: run with no args for prompts, or:
//   node fix-typo.js <slug-or-partial-filename> "<find>" "<replace>"

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const POSTS_DIR = path.join(__dirname, "content", "posts");
const PROVENANCE_PATH = path.join(__dirname, "tag-provenance.json");

function prompt(label, defaultVal) {
  const hint = defaultVal ? ` (default: ${defaultVal})` : "";
  process.stdout.write(`\n${label}${hint}\n> `);
  const drain = 'while IFS= read -r -t 0.05 _l < /dev/tty 2>/dev/null; do :; done';
  const read  = 'read -r val < /dev/tty; printf "%s" "$val"';
  const r = spawnSync("/bin/sh", ["-c", `${drain}; ${read}`], { stdio: ["inherit", "pipe", "inherit"] });
  const val = r.stdout ? r.stdout.toString().trim() : "";
  return val || defaultVal || "";
}

function findPostPath(slugOrPartial) {
  const exact = [".mdx", ".md"]
    .map((ext) => path.join(POSTS_DIR, slugOrPartial + ext))
    .find((p) => fs.existsSync(p));
  if (exact) return exact;

  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));
  const matches = files.filter((f) => f.includes(slugOrPartial));
  if (matches.length === 1) return path.join(POSTS_DIR, matches[0]);
  if (matches.length > 1) {
    console.log("\nMultiple posts match — be more specific:");
    matches.forEach((m) => console.log("  " + m.replace(/\.mdx?$/, "")));
    process.exit(1);
  }
  return null;
}

// Same compact inline style as the rest of tag-provenance.json — colon
// right after the key, padding after the colon so every value column
// lines up (verified byte-for-byte against the real file before this
// script was written; see new-post.js for the matching fix there).
function formatEntryObject(entry) {
  const parts = [`"type": ${JSON.stringify(entry.type)}`];
  if (entry.spans) parts.push(`"spans": [${entry.spans.map((s) => JSON.stringify(s)).join(", ")}]`);
  if (entry.note) parts.push(`"note": ${JSON.stringify(entry.note)}`);
  return `{ ${parts.join(", ")} }`;
}
function formatProvenanceEntry(slug, dateOnly, tagsObj) {
  const tagKeys = Object.keys(tagsObj);
  const maxLen = Math.max(...tagKeys.map((k) => JSON.stringify(k).length));
  const lines = tagKeys.map((tag) => {
    const keyStr = JSON.stringify(tag);
    const pad = " ".repeat(maxLen - keyStr.length + 1);
    return `      ${keyStr}:${pad}${formatEntryObject(tagsObj[tag])}`;
  });
  return (
    `  {\n` +
    `    "slug": ${JSON.stringify(slug)},\n` +
    `    "date": ${JSON.stringify(dateOnly)},\n` +
    `    "tags": {\n${lines.join(",\n")}\n    }\n` +
    `  }`
  );
}

// Locates one entry's exact original text (braces and all) inside the raw
// file, so it can be replaced in place without touching anything else —
// deliberately NOT a parse-and-regenerate-the-whole-file approach, since
// that would silently "fix" any small pre-existing formatting quirks in
// OTHER entries too and turn a one-post diff into a file-wide one.
function findEntryBlock(rawText, slug) {
  const anchor = `  {\n    "slug": ${JSON.stringify(slug)},`;
  const start = rawText.indexOf(anchor);
  if (start === -1) return null;
  let searchFrom = start;
  while (true) {
    const closeIdx = rawText.indexOf("\n  }", searchFrom);
    if (closeIdx === -1) return null;
    const after = rawText.slice(closeIdx + 4, closeIdx + 10);
    if (after.startsWith(",\n  {") || after.startsWith("\n]")) {
      return { start, end: closeIdx + 4 }; // end is exclusive, right after the closing "}"
    }
    searchFrom = closeIdx + 4;
  }
}

// ── main ──────────────────────────────────────────────

const argSlug = process.argv[2];
const argFind = process.argv[3];
const argReplace = process.argv[4];

console.log("\n── Fix a typo (post + provenance, together) ──────────");

const slugInput = argSlug || prompt("Post slug (or part of the filename)");
if (!slugInput) { console.log("\nNeed a slug.\n"); process.exit(1); }

const postPath = findPostPath(slugInput);
if (!postPath) { console.log(`\nNo post matches "${slugInput}".\n`); process.exit(1); }
const slug = path.basename(postPath).replace(/\.mdx?$/, "");
console.log(`\nFound: content/posts/${path.basename(postPath)}`);

const find = argFind !== undefined ? argFind : prompt("Find (exact text)");
if (!find) { console.log("\nNeed something to find.\n"); process.exit(1); }

const originalPost = fs.readFileSync(postPath, "utf-8");
const postOccurrences = originalPost.split(find).length - 1;
if (postOccurrences === 0) {
  console.log(`\n"${find}" doesn't appear anywhere in this post — nothing to do.\n`);
  process.exit(1);
}

const replace = argReplace !== undefined ? argReplace : prompt("Replace with");

const provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf-8"));
const entryIdx = provenance.findIndex((p) => p.slug === slug);
let affectedSpans = 0;
if (entryIdx !== -1) {
  for (const entry of Object.values(provenance[entryIdx].tags)) {
    if (!entry.spans) continue;
    for (const span of entry.spans) if (span.includes(find)) affectedSpans++;
  }
}

console.log(`\n"${find}"  ->  "${replace}"`);
console.log(`  post:       ${postOccurrences} occurrence${postOccurrences === 1 ? "" : "s"} in content/posts/${path.basename(postPath)}`);
console.log(
  `  provenance: ${entryIdx === -1
    ? "no provenance entry for this post"
    : `${affectedSpans} span${affectedSpans === 1 ? "" : "s"}`}`
);

const confirm = prompt("Apply? (y/n)", "y");
if (confirm.toLowerCase() !== "y") { console.log("\nAborted.\n"); process.exit(0); }

// 1) fix the post
const updatedPost = originalPost.split(find).join(replace);
fs.writeFileSync(postPath, updatedPost);
console.log(`\nUpdated content/posts/${path.basename(postPath)}`);

// 2) fix the provenance entry, if any spans were touched
if (entryIdx !== -1 && affectedSpans > 0) {
  const entry = provenance[entryIdx];
  const updatedTags = {};
  for (const [tagName, t] of Object.entries(entry.tags)) {
    updatedTags[tagName] = t.spans
      ? { ...t, spans: t.spans.map((s) => s.split(find).join(replace)) }
      : t;
  }

  // verify every span still matches the just-updated post text before
  // writing anything — an off-target replace should fail loud, not quiet
  const fm = updatedPost.match(/^---\n([\s\S]*?)\n---\n?/);
  const title = fm ? (fm[1].match(/title:\s*"(.*)"/) || [])[1] || "" : "";
  const body = fm ? updatedPost.slice(fm[0].length).trim() : updatedPost.trim();

  let allOk = true;
  for (const [tagName, t] of Object.entries(updatedTags)) {
    if (!t.spans) continue;
    for (const s of t.spans) {
      if (!title.includes(s) && !body.includes(s)) {
        allOk = false;
        console.log(`  ⚠ after replace, "${tagName}" span no longer matches: ${JSON.stringify(s)}`);
      }
    }
  }

  if (!allOk) {
    console.log("\nProvenance NOT touched — the post was still updated above, but fix");
    console.log("the mismatched span(s) manually, or ask Claude to sort it out.\n");
    process.exit(1);
  }

  const rawProvenance = fs.readFileSync(PROVENANCE_PATH, "utf-8");
  const block = findEntryBlock(rawProvenance, slug);
  if (!block) {
    console.log("\n⚠ couldn't locate this entry's exact text in tag-provenance.json —");
    console.log("provenance NOT updated automatically. Paste this in by hand:\n");
    console.log(formatProvenanceEntry(slug, entry.date, updatedTags));
    process.exit(1);
  }

  const newEntryText = formatProvenanceEntry(slug, entry.date, updatedTags);
  const updatedProvenance =
    rawProvenance.slice(0, block.start) + newEntryText + rawProvenance.slice(block.end);

  try {
    JSON.parse(updatedProvenance);
  } catch (err) {
    console.log("\n⚠ regenerated tag-provenance.json didn't parse — not writing it.");
    console.log("Error:", err.message, "\n");
    process.exit(1);
  }

  fs.writeFileSync(PROVENANCE_PATH, updatedProvenance);
  console.log(`Updated tag-provenance.json (${affectedSpans} span${affectedSpans === 1 ? "" : "s"})`);
} else if (entryIdx !== -1) {
  console.log("No provenance spans contained this text — nothing to update there.");
} else {
  console.log("This post has no provenance entry yet — nothing to update there.");
}

console.log();
