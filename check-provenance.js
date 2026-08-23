#!/usr/bin/env node
// Lists every post in content/posts/ that doesn't yet have an entry in
// tag-provenance.json — i.e. every post whose tag-carrying words/phrases
// haven't been identified, so it renders plain (no "alive" highlighting)
// on /writing and in the share/save video export.
//
// This is deliberately just a LISTER, not a generator. Deciding what
// phrase in a given poem actually carries a given tag is a close-reading
// judgment call (see tag-provenance.json's real entries — several tags
// per post are honestly marked "type": "none" because nothing in the
// text earns them) — a keyword-matcher would force matches that aren't
// really there, which is exactly the failure mode this format was built
// to avoid. So: run this to see what's pending, then ask Claude to do
// the close-read pass on those slugs.
const fs = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "content", "posts");
const PROVENANCE_PATH = path.join(__dirname, "tag-provenance.json");

const provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, "utf-8"));
const covered = new Set(provenance.map((p) => p.slug));

const files = fs.existsSync(POSTS_DIR)
  ? fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".mdx") || f.endsWith(".md"))
  : [];

const pending = files
  .map((f) => f.replace(/\.mdx?$/, ""))
  .filter((slug) => !covered.has(slug))
  .sort();

if (pending.length === 0) {
  console.log("\nEvery post has provenance data. Nothing pending.\n");
} else {
  console.log(`\n${pending.length} post(s) without provenance data:\n`);
  pending.forEach((s) => console.log("  " + s));
  console.log(`\n${covered.size} post(s) already covered.`);
  console.log('\nAsk Claude: "do the provenance pass on the pending posts"\n');
}
