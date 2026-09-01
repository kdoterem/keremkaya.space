// ── Shared between PlayPoemBody (rendering) and PlayScreen (composing what
// gets saved/shown in a popup) so both agree on exactly the same line
// boundaries and legibility — computed once, not two slightly-different
// hand-rolled copies.

export interface PoemLine {
  text:      string;
  start:     number;
  end:       number;
  isBlank:   boolean;
  isLegible: boolean;
}

export function splitPoemLines(text: string, weights: number[] | undefined): PoemLine[] {
  const raw = text.split("\n");
  let offset = 0;
  return raw.map((lineText) => {
    const start = offset;
    offset += lineText.length + 1; // +1 for the \n split() consumed
    const end = start + lineText.length;
    const isBlank = !lineText.trim();
    const isLegible = !isBlank && !!weights && weights.slice(start, end).some((w) => w > 0);
    return { text: lineText, start, end, isBlank, isLegible };
  });
}

// The one write-zone that isn't tied to any specific line — a free space
// at the end of the poem for whatever didn't belong right after a
// particular gap. A sentinel far outside any real character offset, so it
// always sorts last wherever zone ids get ordered numerically.
export const ANYWHERE_ZONE_ID = String(Number.MAX_SAFE_INTEGER);

export interface PoemPassage {
  lines: PoemLine[]; // consecutive legible lines, unbroken by a blank or obscured one
  start: number;     // the passage's first line's start — its zone id
}

// A passage is one continuous run of legible lines — often a single
// provenance span already covers several consecutive lines (a whole
// sentence broken across them), and putting a write-zone after EVERY
// individual line inside that run forces whatever gets written there to
// complete a specific line-to-line join rather than respond to the
// passage as one thought. Grouping first means exactly one write-in
// point per passage, wherever it actually ends.
export function groupLegiblePassages(lines: PoemLine[]): PoemPassage[] {
  const passages: PoemPassage[] = [];
  let current: PoemLine[] = [];
  for (const line of lines) {
    if (line.isLegible) {
      current.push(line);
      continue;
    }
    if (current.length) {
      passages.push({ lines: current, start: current[0].start });
      current = [];
    }
  }
  if (current.length) passages.push({ lines: current, start: current[0].start });
  return passages;
}

// A passage's one write-in zone. The gateway a screen was reached through
// (/play/[gateway]) already decided the prompt language for the whole
// screen — "write here" or "push back" — so there's only ever one zone
// per passage, not one per possible framing.
export function passageZoneId(passageStart: number): string {
  return String(passageStart);
}
