# PLAY difficulty scoring — report

269 real passages scored (61 poems with `passage: null` excluded — they were never in scope for PLAY). Output: `play-passage-difficulty.json`, one entry per passage: `slug`, `difficulty_score` (0–100, higher = harder), `tier` (1–4), and a `components` object (`words`, `lines`, `amount_given_difficulty`, `openness`, `concreteness`, `gapped`) for auditing.

## Step 1 — the distribution, before any scoring

- **Line count:** min 1, max 15, median 6, mean 6.5. Roughly bell-shaped, 81% of passages fall in 4–9 lines.
- **Gapped:** 2 of 269 (`to-do-nothing-is-to-let-others-define-the-silence`, `folquenesch`). Too rare to meaningfully move tier boundaries on its own — handled as a flat per-passage bonus, not a weighted share.
- **Line count by type:** claim median 6 lines (n=216), scene median 7 (n=48), both median 8 (n=5). Word count told the same story (claim median 41, scene median 47.5) — a mild lean, not the systematic split the brief wondered about. Concreteness and openness turned out not to be reliably inferable from `type` either — confirmed by grading every passage individually rather than assuming.
- **The prose problem:** exactly 4 passages are a single line (`read`, `this-table`, `smashed`, `valeries-missing`), all typed `scene`, carrying 70–90 words each — the four highest word counts in the whole set. Judged individually rather than under a blanket rule: 3 of 4 scored `obvious` openness on their own merits, all 4 scored `concrete`/`mixed` — no evidence a single-block passage is systematically harder to enter, at least not by these two factors.
- **Word count overall:** min 10, max 90, median 42, mean 43.7.

## Step 2 — the four factors and the weighting

All 269 passages were close-read individually for two factors that aren't derivable from stored data (openness of the stopping point; concreteness) — done in 7 batches of ~40, reviewed as we went, one correction applied mid-pass (batch 5's openness grading had drifted too generous toward "obvious" and was rescored against a stricter bar: obvious only for a literal question, a grammatically incomplete sentence, or an explicit structural setup like a numbered list mid-count).

**Combination formula**, difficulty 0–100 (higher = harder):

```
amount_given_difficulty = 100 − (0.85 × word_count_percentile + 0.15 × line_count_percentile)
openness_difficulty      = obvious → 0, some → 50, quiet → 100
concreteness_difficulty  = concrete → 0, mixed → 50, abstract → 100

base = 0.40 × amount_given_difficulty + 0.35 × openness_difficulty + 0.25 × concreteness_difficulty
score = min(100, base + (8 if gapped else 0))
```

**Why these weights:** amount-given and openness are weighted almost equally (40/35) because both directly gate "how much the reader has to invent" — the brief's own definition of difficulty. Concreteness gets less (25%) because it modulates rather than determines: several passages scored abstract but still ended on a direct question, which is genuinely easy to answer regardless of abstraction. Gapped is a flat +8 rather than a weighted share because at n=2/269 a percentage weight would be statistically invisible; a flat bonus guarantees it moves those two passages' scores without letting a rare binary distort the other 267. Word count uses percentile rank rather than raw min–max scaling specifically because of the 4 prose outliers — percentile rank keeps one extreme passage from compressing everyone else into a narrow band.

**Score distribution:** min 0.6, max 98.3, median 41.4, mean 42.5. Smooth spread, bulk sits in 20–60 (68% of passages), no dead zones — enough gradient to base tiers on.

## Step 3 — tier boundaries

Boundaries chosen from where the data actually breaks, not equal-sized buckets. 43 and 62 land on genuine local gaps in the sorted score list; 25 does not (that stretch, 20–30, is the single densest region in the whole distribution — no natural boundary exists there, so it's the least-bad round cut, not a snapped gap).

| tier | score range | passages | scenes | scene % | proposed unlock |
|---|---|---|---|---|---|
| 1 | 0–25 | 54 | 22 | 40.7% | from the start |
| 2 | 25–43 | 86 | 15 | 17.4% | ~12 completions |
| 3 | 43–62 | 82 | 9 | 11.0% | ~35 total completions |
| 4 | 62–100 | 47 | 2 | **4.3%** | ~70 total completions |

Unlock thresholds are a proposed default, not a data-derived finding — there's no session-length or retention data available to ground them.

### Scene-scarcity flag (explicitly requested by the brief)

Scenes collapse steadily as difficulty rises — 90% of all 48 scenes (43 of them) sit below score 50. Above score 60 there are exactly 2 scenes in 39 passages. **Tier 4 (47 passages) has only 2 scenes (4.3%)** — a reader who reaches it essentially never gets the "change of air" the brief describes; the reward mechanism structurally can't fire there. Tier 3 (11%) is thin but survivable.

No boundary placement fixes this — it isn't a cut-point problem, it's that scenes in this archive trended toward `concrete`+`obvious` (both "easy" directions under this scoring), so there simply aren't enough hard-scoring scenes to distribute evenly. Two ways to actually address it (both outside this task's scope — no passages were re-selected):
1. Accept it — tier 4 doesn't deliver scene breaks, design around that.
2. Decouple scene delivery from the reader's current tier — the brief's own phrasing ("after a reader passes a threshold — not as a menu choice") already reads like an interrupt mechanic rather than a within-tier pick, in which case an easy-scored scene could still be served to a tier-4 reader as their break and the scarcity stops being a problem.

## Passages worth a second look (not changed — flagged per the brief's instruction)

- `read` scored 6.3 — 11th-easiest passage in the archive — despite being an 86-word unbroken prose block, because it graded `obvious`+`concrete` on its own merits (real foreshadowing: "my battery hasn't dropped to critical levels"). Worth a human gut-check on whether a single dense block should ever land this easy, since the formula has no separate penalty for "one entry point, no line breaks" beyond whatever openness/concreteness independently capture.
- No passage's selection itself looked wrong during the close read (i.e., nothing where the chosen passage seemed like a poor cut point) — the earlier duplicate-poem finding from passage selection (`writing-about-something`/`boo`, `riding-my-own-dick`/`if-you-dont-take-yourself-seriously`) is still open and unrelated to difficulty scoring; both members of each pair scored identically here since their text is identical.
