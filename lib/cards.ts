// Draw deck for /art — 59 cards, from the-deck.md (drawn from the archive of
// Kerem Kaya, February 2025 – August 2026).
//
// group is never shown in the UI; it only drives selection (see drawSpread
// in app/art/page.tsx: exactly one "double" card, plus two more from the
// remaining pool across all groups). Counts: doubles 16, warnings 14,
// doors 10, verdicts 19.

export type CardGroup = "double" | "warning" | "door" | "verdict";

export interface Card {
  text:  string;
  group: CardGroup;
}

export const CARDS: Card[] = [
  // DOUBLES — 16
  { text: "new is better than old. until it's old again.",                        group: "double" },
  { text: "the lower you get the higher you go.",                                 group: "double" },
  { text: "you're not defeated until you're beaten.",                             group: "double" },
  { text: "truth gets lost when edge is soft.",                                   group: "double" },
  { text: "fire was water before it.",                                            group: "double" },
  { text: "you're moving but you can't go.",                                      group: "double" },
  { text: "summer warms so winter doesn't kill.",                                 group: "double" },
  { text: "winter is promised.",                                                  group: "double" },
  { text: "beast's belly is full. he is too tired to hunt.",                      group: "double" },
  { text: "he is the closest stranger.",                                         group: "double" },
  { text: "everything is weird that nothing is weird at all.",                    group: "double" },
  { text: "only when you're not stupid you'll see how stupid you were.",          group: "double" },
  { text: "i suffer, but when i smile it is of a real one.",                      group: "double" },
  { text: "what lingers is what has been.",                                       group: "double" },
  { text: "no such thing as blocked sight. there's sight of the obstruction.",    group: "double" },
  { text: "some never knew despair.",                                             group: "double" },

  // WARNINGS — 14
  { text: "predator doesn't lurk on the lamb. it lurks on its prettiness.",       group: "warning" },
  { text: "a barrier is necessary.",                                              group: "warning" },
  { text: "silence keeps vices.",                                                 group: "warning" },
  { text: "some hate is thwarted want.",                                          group: "warning" },
  { text: "we're not prey to anything but ourselves.",                            group: "warning" },
  { text: "love has no limitless loan.",                                          group: "warning" },
  { text: "visibility alters the nature of things.",                              group: "warning" },
  { text: "he isn't who he says he is.",                                          group: "warning" },
  { text: "and what they say is what they heard.",                                group: "warning" },
  { text: "no one's listening. but the mirror's there.",                          group: "warning" },
  { text: "you're enslaved to the statement you made before you knew what making meant.", group: "warning" },
  { text: "there is a bus that never leaves.",                                    group: "warning" },
  { text: "life is a funeral. no one is mourning.",                               group: "warning" },
  { text: "god only listens. he doesn't hear.",                                   group: "warning" },

  // DOORS — 10
  { text: "best answer is no answer.",                                            group: "door" },
  { text: "till you run out of reasons to run.",                                  group: "door" },
  { text: "everything i needed found me.",                                        group: "door" },
  { text: "path to seeing yourself lies one stranger away.",                      group: "door" },
  { text: "one has to look inward to see. one has to feel liberated to be.",      group: "door" },
  { text: "if you want a chance at being loved, first you have to love.",         group: "door" },
  { text: "be in the same space.",                                                group: "door" },
  { text: "come empty or don't come at all.",                                     group: "door" },
  { text: "what you need lies in its opposite.",                                  group: "door" },
  { text: "die yet keep breathing.",                                              group: "door" },

  // VERDICTS — 19
  { text: "you break two times. first when you break, second when you realize you're broken.", group: "verdict" },
  { text: "every acceptance is refusal of something.",                            group: "verdict" },
  { text: "every arrival is absence from a place.",                               group: "verdict" },
  { text: "every yes is a death of no.",                                          group: "verdict" },
  { text: "every being is a killer.",                                             group: "verdict" },
  { text: "i am the killer of me.",                                               group: "verdict" },
  { text: "there is no rest.",                                                    group: "verdict" },
  { text: "in life one is always lonely.",                                        group: "verdict" },
  { text: "lack of warmth worse than cold.",                                      group: "verdict" },
  { text: "pieces of scattered pieces are not pieces.",                           group: "verdict" },
  { text: "clearing the debris asks us to clear the debris.",                     group: "verdict" },
  { text: "the ease i deemed to feel was the pain.",                              group: "verdict" },
  { text: "they do not ask about your name.",                                     group: "verdict" },
  { text: "some never swam far enough from despair to meet hope.",                group: "verdict" },
  { text: "show me where you broke.",                                             group: "verdict" },
  { text: "bring me the proof of your fall.",                                     group: "verdict" },
  { text: "the cracks are your credentials. fear is the tuition paid.",           group: "verdict" },
  { text: "i am still was.",                                                      group: "verdict" },
  { text: "i want nothing. i need some things.",                                  group: "verdict" },
];
