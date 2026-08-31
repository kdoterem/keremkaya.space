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
