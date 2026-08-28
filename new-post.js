#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const POSTS_DIR = path.join(__dirname, "content", "posts");
const PROVENANCE_PATH = path.join(__dirname, "tag-provenance.json");

// One persistent readline interface for the script's whole run, feeding a
// manual FIFO queue — replacing the old approach of spawning a fresh
// `/bin/sh -c "read ... < /dev/tty"` subprocess for every single prompt.
// That needed a heuristic "drain up to 50ms of buffered input" step before
// every real read, to guard against a previous prompt's stray leftover
// input silently answering the next one — but a fixed timeout is a guess,
// not a guarantee, and on 2026-08-27 it guessed wrong: a real typed
// provenance phrase got swallowed by the drain, read back as an empty
// line, which the code correctly treats as "done" — silently skipping the
// rest of provenance entry with no error shown.
//
// First replacement attempt used plain rl.question() in a loop and looked
// right, but testing it against piped/fast input surfaced a DIFFERENT
// flaw with the same shape: question() only attaches its listener for the
// moment it's actively waiting, so lines that arrive in a burst (exactly
// what a paste is) before the *next* question() call get silently
// dropped, not queued — same class of bug, still real for the case that
// mattered (pasting a multi-line phrase quickly).
//
// This is the actually-robust version: ONE 'line' listener lives for the
// whole run and pushes every line into `lineQueue` the instant it fires,
// no matter how many arrive in a single burst or how fast. `nextLine()`
// hands back an already-queued line immediately, or registers a waiter to
// be resolved the moment the next 'line' event fires if the queue's
// currently empty. Every line the user (or a paste) ever produces ends up
// in the queue in order — nothing can be lost to timing, because nothing
// is ever thrown away between arrival and consumption.
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

function clipboard() {
  const r = spawnSync("pbpaste", [], { encoding: "utf8" });
  if (r.error || !r.stdout.trim()) {
    console.error("\nClipboard is empty — copy your post first, then run newpost.\n");
    process.exit(1);
  }
  return r.stdout.trimEnd();
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
}

function today() {
  // Full datetime so same-day posts sort by creation time (lib/posts.ts displays only the date portion)
  return new Date().toISOString().replace(/\.\d{3}Z$/, "");
}

// Read all existing tags from post frontmatter, sorted by frequency
function getExistingTags() {
  const freq = {};
  if (!fs.existsSync(POSTS_DIR)) return [];
  for (const f of fs.readdirSync(POSTS_DIR)) {
    if (!f.endsWith(".mdx") && !f.endsWith(".md")) continue;
    // Only read first 512 bytes — tags are always in frontmatter
    const fd = fs.openSync(path.join(POSTS_DIR, f), "r");
    const buf = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    const raw = buf.toString("utf8", 0, bytesRead);
    const match = raw.match(/^tags:\s*\[([^\]]*)\]/m);
    if (!match) continue;
    const tags = match[1].match(/"([^"]+)"/g) || [];
    for (const t of tags) {
      const tag = t.replace(/"/g, "");
      freq[tag] = (freq[tag] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

// Suggest tags by matching content words against existing tags
function suggestTags(content, allTags) {
  const lower = content.toLowerCase();
  return allTags.filter((tag) => {
    // Multi-word tags: check if all words appear in content
    const words = tag.toLowerCase().split(/\s+/);
    return words.every((w) => lower.includes(w));
  });
}

// Multi-select tag picker with suggestions
async function promptTags(suggestedTags, allTags) {
  const selected = [...suggestedTags];

  console.log("\n── Tag selection ─────────────────────");
  console.log("Suggested tags (based on content):");
  if (suggestedTags.length) {
    suggestedTags.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
  } else {
    console.log("  (none matched automatically)");
  }
  console.log("\nAll existing tags:");
  const sortedTags = [...allTags].sort((a, b) => a.localeCompare(b));
  const chunks = [];
  for (let i = 0; i < sortedTags.length; i += 6) chunks.push(sortedTags.slice(i, i + 6));
  chunks.forEach((row) => console.log("  " + row.join(", ")));
  console.log("\nType a tag to toggle it on/off (from the list or a new one).");
  console.log("Type 'done' or leave blank when finished. Aim for 3–6 tags, most important first.");

  while (true) {
    const input = (await prompt(`  [${selected.length ? selected.join(", ") : "none"}]`)).toLowerCase();
    if (!input || input === "done") break;

    const idx = selected.findIndex((t) => t.toLowerCase() === input);
    if (idx === -1) {
      selected.push(input);
      console.log(`  + added "${input}"`);
    } else {
      selected.splice(idx, 1);
      console.log(`  - removed "${input}"`);
    }
  }

  return selected;
}

// ── provenance (the "alive" highlight data) ────────────
// You (the author) know what phrase carries a tag better than anyone
// close-reading it after the fact — so this asks at write time instead
// of needing a separate pass later. Every span gets checked against
// what you actually pasted before it's accepted: computeWeights()
// (lib/tagProvenance.tsx) does an exact substring match, so a phrase
// that's off by a comma or a typo would silently do nothing.

// Flat list, like promptTags's picker but simpler: paste a phrase, blank
// line when done. No tag name needed — computeWeights() (lib/tagProvenance.tsx)
// only ever counts how many times a stretch of text got claimed; it
// never reads back WHICH tag claimed it (nothing on the page surfaces
// that), so asking for one was pure unused ceremony. Listing the same
// phrase more than once is how you make it stand out more — each repeat
// adds another point of weight, same mechanic as before, just without
// needing a tag label to get there. Still validated against the actual
// title/body before being accepted.
async function promptProvenanceFreeform(title, body) {
  const spans = [];

  console.log('\nPaste phrases that should be "alive" (highlighted, moving) on');
  console.log('/writing and in the share video — one per line, exact match');
  console.log("required (copy, don't retype). List the same phrase again if");
  console.log("you want it to stand out more (each repeat adds weight).");
  console.log("Blank line when done — or right away to skip this entirely.");

  while (true) {
    const line = await prompt(`  [${spans.length} phrase${spans.length === 1 ? "" : "s"}]`);
    if (!line) break;
    if (!title.includes(line) && !body.includes(line)) {
      console.log(`  ⚠ not found verbatim in the title or body — check spelling/punctuation. Not added.`);
      continue;
    }
    spans.push(line);
    console.log(`  + added`);
  }

  if (spans.length === 0) return null;
  return { highlighted: { type: "lines", spans } };
}

// { "type": "phrase"/"lines"/"none", "spans"?: [...] } — inline-formatted
// to match tag-provenance.json's existing hand-tuned compact style
// ({ "type": ..., "spans": [...] } on one line), not JSON.stringify's
// default multi-line output, so adding one entry doesn't reformat the
// whole file.
function formatEntryObject(entry) {
  const parts = [`"type": ${JSON.stringify(entry.type)}`];
  if (entry.spans) parts.push(`"spans": [${entry.spans.map((s) => JSON.stringify(s)).join(", ")}]`);
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

// Splices the new entry in before the array's closing "]" — string
// surgery on the raw file text, not a parse-and-JSON.stringify
// round-trip, which would blow the whole file's hand-aligned formatting
// out into standard multi-line JSON and turn a one-post diff into a
// file-wide one. Validates the result actually parses before writing;
// leaves the file untouched and prints the entry for manual pasting if
// anything looks off.
function appendProvenanceEntry(entryStr) {
  const raw = fs.readFileSync(PROVENANCE_PATH, "utf-8");
  const trimmed = raw.replace(/\s+$/, "");
  if (!trimmed.endsWith("]")) {
    console.log("\n⚠ tag-provenance.json doesn't end with ']' as expected — not touching it. Add this entry manually:\n");
    console.log(entryStr + "\n");
    return false;
  }
  const withoutBracket = trimmed.slice(0, -1).replace(/\s+$/, "");
  const isEmpty = withoutBracket.trim() === "[";
  const updated = withoutBracket + (isEmpty ? "\n" : ",\n") + entryStr + "\n]\n";

  try {
    JSON.parse(updated);
  } catch (err) {
    console.log("\n⚠ generated entry didn't produce valid JSON — not touching tag-provenance.json. Add this manually:\n");
    console.log(entryStr + "\n");
    console.log("Error:", err.message, "\n");
    return false;
  }

  fs.writeFileSync(PROVENANCE_PATH, updated);
  return true;
}

// ── main ──────────────────────────────────────────────

console.log("\n── New Post ──────────────────────────");
console.log("(Copy your post to clipboard before filling this in)");

(async () => {
  const title = await prompt("Title");
  if (!title) { console.log("\nTitle is required."); rl.close(); process.exit(1); }

  const slug    = slugify(title);
  const date    = await prompt("Date", today());
  const excerpt = await prompt("Excerpt (one line)");

  console.log("\nReading clipboard and existing tags...");
  const body    = clipboard();
  const allTags = getExistingTags();
  const suggested = suggestTags(body + " " + title + " " + excerpt, allTags);

  const tags = await promptTags(suggested, allTags);

  // Optional — the highlight/provenance data. null = skipped or nothing
  // entered; otherwise only the tags actually given a phrase are present
  // (no forced "none" filler, no requirement that a tag was even in the
  // tags list above — see promptProvenanceFreeform).
  //
  // Used to gate this behind a separate "Add highlight phrases now?
  // (default: y)" yes/no prompt before the loop — removed after it caused
  // real confusion twice: pasting a phrase as the very first thing (a
  // completely reasonable instinct — you're here to add phrases, not to
  // answer a y/n question first) meant that phrase became the answer to
  // "y or n", which isn't "y", so the whole loop got silently skipped.
  // The loop's own "blank line" already means "skip" on its very first
  // prompt too, so the separate gate was pure redundant surface area for
  // exactly this mistake to happen on. One prompt now, not two.
  let provenanceTags = null;
  if (tags.length > 0) {
    provenanceTags = await promptProvenanceFreeform(title, body);
  }

  const tagsYaml = tags.map((t) => `"${t}"`).join(", ");

  console.log("\n──────────────────────────────────────");
  console.log(`  title:   ${title}`);
  console.log(`  date:    ${date}`);
  console.log(`  excerpt: ${excerpt || "(none)"}`);
  console.log(`  tags:    ${tags.length ? tags.join(", ") : "(none)"}`);
  if (provenanceTags) {
    const spanCount = provenanceTags.highlighted.spans.length;
    console.log(`  provenance: ${spanCount} phrase${spanCount === 1 ? "" : "s"} marked alive`);
  }
  console.log(`  file:    content/posts/${slug}.mdx`);
  console.log("──────────────────────────────────────");

  const confirm = await prompt("Save? (y/n)", "y");
  if (confirm.toLowerCase() !== "y") { console.log("\nAborted.\n"); rl.close(); process.exit(0); }

  const frontmatter = `---\ntitle: "${title}"\ndate: "${date}"\nexcerpt: "${excerpt}"\ntags: [${tagsYaml}]\n---\n\n`;
  const finalContent = frontmatter + body;

  const outputPath = path.join(POSTS_DIR, `${slug}.mdx`);
  if (fs.existsSync(outputPath)) {
    console.log(`\n"${slug}" already exists. Nothing saved.\n`);
    rl.close();
    process.exit(1);
  }

  fs.writeFileSync(outputPath, finalContent);
  console.log(`\nPost saved → content/posts/${slug}.mdx\n`);

  // Only write an entry if at least one phrase actually got entered — an
  // empty entry wouldn't add any highlighting, but hasProvenance(slug)
  // (lib/tagProvenance.tsx) would still flip this post onto the plain
  // pre-wrap weighted-text render path instead of MDXRemote, silently
  // dropping markdown formatting for zero benefit. So "attempted but
  // nothing entered" and "skipped entirely" both fall through the same way.
  if (provenanceTags) {
    const entryStr = formatProvenanceEntry(slug, date.slice(0, 10), provenanceTags);
    if (appendProvenanceEntry(entryStr)) {
      const spanCount = provenanceTags.highlighted.spans.length;
      console.log(`Provenance data saved → tag-provenance.json (${spanCount} phrase${spanCount === 1 ? "" : "s"})\n`);
    }
  } else {
    console.log(
      `This post doesn't have tag-provenance.json data yet, so it'll render\n` +
      `plain (no alive highlighting) until it does.\n\n` +
      `Ask Claude: "do the provenance pass on the pending posts"\n` +
      `(or run \`node check-provenance.js\` any time to see what's pending)\n`
    );
  }

  rl.close();
})().catch((err) => {
  console.error("\nCRASHED:", err);
  process.exit(1);
});
