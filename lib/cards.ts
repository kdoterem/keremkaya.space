// Draw deck for /art. Full 58-card list to be pasted in — this is a scaffold
// with placeholders so the draw logic has real data to run against.
//
// group is never shown in the UI; it only drives selection (see drawSpread
// in app/art/page.tsx: exactly one "double" card, plus two more from the
// remaining pool across all groups).

export type CardGroup = "double" | "warning" | "door" | "verdict";

export interface Card {
  text:  string;
  group: CardGroup;
}

export const CARDS: Card[] = [
  { text: "placeholder card one",   group: "double"  },
  { text: "placeholder card two",   group: "double"  },
  { text: "placeholder card three", group: "warning" },
  { text: "placeholder card four",  group: "warning" },
  { text: "placeholder card five",  group: "door"    },
  { text: "placeholder card six",   group: "door"    },
  { text: "placeholder card seven", group: "verdict" },
  { text: "placeholder card eight", group: "verdict" },
];
