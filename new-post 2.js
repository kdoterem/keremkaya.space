#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const POSTS_DIR = path.join(__dirname, "content", "posts");

// Read one line from the terminal, draining any buffered input first
function prompt(label, defaultVal) {
  const hint = defaultVal ? ` (default: ${defaultVal})` : "";
  process.stdout.write(`\n${label}${hint}\n> `);
  const drain = 'while IFS= read -r -t 0.05 _l < /dev/tty 2>/dev/null; do :; done';
  const read  = 'read -r val < /dev/tty; printf "%s" "$val"';
  const r = spawnSync("/bin/sh", ["-c", `${drain}; ${read}`], {
    stdio: ["inherit", "pipe", "inherit"],
  });
  const val = r.stdout ? r.stdout.toString().trim() : "";
  return val || defaultVal || "";
}

function promptTags() {
  const tags = [];
  console.log("\nTags — type one at a time, Enter to add/remove, blank when done");
  while (true) {
    process.stdout.write(`  [${tags.length ? tags.join(", ") : "none"}]\n> `);
    const drain = 'while IFS= read -r -t 0.05 _l < /dev/tty 2>/dev/null; do :; done';
    const read  = 'read -r val < /dev/tty; printf "%s" "$val"';
    const r = spawnSync("/bin/sh", ["-c", `${drain}; ${read}`], {
      stdio: ["inherit", "pipe", "inherit"],
    });
    const input = r.stdout ? r.stdout.toString().trim() : "";
    if (!input) break;
    const idx = tags.findIndex((t) => t.toLowerCase() === input.toLowerCase());
    if (idx === -1) tags.push(input);
    else tags.splice(idx, 1);
  }
  return tags;
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
  return new Date().toISOString().split("T")[0];
}

// ── main ──────────────────────────────────────────────

console.log("\n── New Post ──────────────────────────");
console.log("(Copy your post to clipboard before filling this in)");

const title = prompt("Title");
if (!title) { console.log("\nTitle is required."); process.exit(1); }

const slug    = slugify(title);
const date    = prompt("Date", today());
const excerpt = prompt("Excerpt (one line)");
const tags    = promptTags();

const tagsYaml = tags.map((t) => `"${t}"`).join(", ");

console.log("\n──────────────────────────────────────");
console.log(`  title:   ${title}`);
console.log(`  date:    ${date}`);
console.log(`  excerpt: ${excerpt || "(none)"}`);
console.log(`  tags:    ${tags.length ? tags.join(", ") : "(none)"}`);
console.log(`  file:    content/posts/${slug}.mdx`);
console.log("──────────────────────────────────────");

const confirm = prompt("Save? (y/n)", "y");
if (confirm.toLowerCase() !== "y") { console.log("\nAborted.\n"); process.exit(0); }

const body = clipboard();
const frontmatter = `---\ntitle: "${title}"\ndate: "${date}"\nexcerpt: "${excerpt}"\ntags: [${tagsYaml}]\n---\n\n`;
const finalContent = frontmatter + body;

const outputPath = path.join(POSTS_DIR, `${slug}.mdx`);
if (fs.existsSync(outputPath)) {
  console.log(`\n"${slug}" already exists. Nothing saved.\n`);
  process.exit(1);
}

fs.writeFileSync(outputPath, finalContent);
console.log(`\nPost saved → content/posts/${slug}.mdx\n`);
