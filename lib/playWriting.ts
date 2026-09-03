// ── Shared pure logic for PLAY's write-in zone — word counting and the
// "doesn't look finished yet" junk check. No ceiling exists deliberately
// (agreed: readers should write as long as they want); the floor plus
// this check are the only gates, and both are meant to catch someone
// testing the box ("asdasdasdas") rather than judge real writing. A soft
// nudge, not a hard content-quality gate — this archive has genuine lines
// like "th,s how , would wr,te ,f they were" a stricter filter would flag.

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// A token "looks unfinished" if it has no vowel and is long enough that a
// real word would almost certainly have one, or if it's a long run of the
// same character repeated (keymash territory either way). Flags the whole
// input only when MOST tokens trip this — one weird word among real ones
// is just word choice, not test-typing.
const VOWELS = /[aeiouAEIOUyY]/;
const REPEATED_CHAR_RUN = /(.)\1{3,}/; // same char 4+ times in a row

function tokenLooksUnfinished(token: string): boolean {
  const letters = token.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) return false; // pure punctuation/numbers — not this check's job
  if (REPEATED_CHAR_RUN.test(letters)) return true;
  if (letters.length >= 4 && !VOWELS.test(letters)) return true;
  return false;
}

export function looksUnfinished(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false; // empty is the floor check's job, not this one's
  const flagged = tokens.filter(tokenLooksUnfinished).length;
  return flagged / tokens.length > 0.5;
}

// Under-floor nudges — a real thing was written, just not enough of one
// yet. Distinct from looksUnfinished's "doesn't look finished yet" (that
// one's for keymash; this pool is for genuine short answers) and shown
// either on a submit attempt or after a few seconds of no further typing
// — see PlayNext.tsx. A small rotating pool rather than one fixed line,
// so it doesn't read as a scolding form-validation message on repeat.
export const UNDER_FLOOR_MESSAGES = [
  "give it a little more",
  "that's a shrug, not a thought",
  "not yet",
  "there's more in there",
  "keep going",
];

export function randomUnderFloorMessage(): string {
  return UNDER_FLOOR_MESSAGES[Math.floor(Math.random() * UNDER_FLOOR_MESSAGES.length)];
}
