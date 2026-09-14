#!/usr/bin/env node
// Validates a batch of PLAY passage-selection entries (JSON array, same
// shape as play-passages.json) against the real post bodies before
// merging. Mirrors .provenance-validate.js's role for tag-provenance.json
// batches — same idea, different shape (one passage per poem, not one
// span-set per tag). Usage:
//   node .passage-validate.js path/to/batch-output.json
//
// Checks:
//  - slug exists in content/posts/
//  - passage === null requires a top-level "note" explaining why
//  - a real passage requires lines (non-empty string array), a boolean
//    "gapped", and a "type" in {claim, scene, both, neither}
//  - every line is a verbatim substring of the post body (checked
//    individually, not joined — a gapped passage's lines aren't
//    contiguous, so there's no single substring to check them against)
//  - flags duplicate slugs already present in play-passages.json, and
//    duplicate slugs within the batch itself
const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("usage: node .passage-validate.js <batch.json>");
  process.exit(1);
}

const ROOT = __dirname;
const postsDir = path.join(ROOT, "content/posts");
const existingPath = path.join(ROOT, "play-passages.json");
const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, "utf8")) : [];
const existingSlugs = new Set(existing.map((e) => e.slug));

let batch;
try {
  batch = JSON.parse(fs.readFileSync(inputPath, "utf8"));
} catch (e) {
  console.error("could not parse input as JSON:", e.message);
  process.exit(1);
}
if (!Array.isArray(batch)) {
  console.error("expected a JSON array at the top level.");
  process.exit(1);
}

const postFiles = fs.readdirSync(postsDir).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));
const posts = {};
for (const f of postFiles) {
  const raw = fs.readFileSync(path.join(postsDir, f), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) continue;
  posts[f.replace(/\.mdx?$/, "")] = { body: m[2].trim() };
}

const VALID_TYPES = new Set(["claim", "scene", "both", "neither"]);
let errors = 0;
let warnings = 0;
let okPassages = 0;
let okNulls = 0;
const seenInBatch = new Set();

for (const entry of batch) {
  const { slug, date, passage, note } = entry || {};
  if (!slug) { console.log(`✗ entry missing "slug" field:`, JSON.stringify(entry).slice(0, 80)); errors++; continue; }
  if (seenInBatch.has(slug)) { console.log(`✗ [${slug}] appears twice in this batch`); errors++; }
  seenInBatch.add(slug);

  const post = posts[slug];
  if (!post) { console.log(`✗ [${slug}] no matching post found in content/posts/`); errors++; continue; }
  if (existingSlugs.has(slug)) { console.log(`⚠ [${slug}] already has an entry in play-passages.json — merging will need to replace, not append`); warnings++; }
  if (!date) { console.log(`⚠ [${slug}] missing "date"`); warnings++; }

  if (passage === null) {
    if (!note || typeof note !== "string") { console.log(`✗ [${slug}] passage is null but has no top-level "note" explaining why`); errors++; continue; }
    okNulls++;
    continue;
  }

  if (!passage || typeof passage !== "object") { console.log(`✗ [${slug}] "passage" must be an object or null`); errors++; continue; }

  const { lines, gapped, type } = passage;
  if (!Array.isArray(lines) || lines.length === 0) { console.log(`✗ [${slug}] passage has no "lines"`); errors++; continue; }
  if (typeof gapped !== "boolean") { console.log(`✗ [${slug}] passage.gapped must be a boolean`); errors++; }
  if (!VALID_TYPES.has(type)) { console.log(`✗ [${slug}] passage.type "${type}" is not one of claim/scene/both/neither`); errors++; }

  let allFound = true;
  for (const line of lines) {
    if (typeof line !== "string" || !post.body.includes(line)) {
      console.log(`✗ [${slug}] line NOT found verbatim in post body:\n    "${line}"`);
      errors++;
      allFound = false;
    }
  }
  if (allFound) okPassages++;
}

console.log(
  `\n${errors} error(s), ${warnings} warning(s), ${okPassages} valid passage(s), ${okNulls} valid null(s) out of ${batch.length} entries.`,
);
process.exit(errors > 0 ? 1 : 0);
