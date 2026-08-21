# Terrain exploration — parked, not abandoned

`/writing`'s landing is back to the last stable, working state
(commit `9560132`, the line-drawn wireframe rebuild — drag, occlusion,
and sizing all confirmed working). Everything built after that, across
six full rendering-technique rewrites, is preserved but not live:

- **Branch `terrain-ecosystem-wip`** (pushed to origin, tip `98f3d57`) —
  every intermediate pass in order: word-density line behavior → full
  text-driven linework (no noise) → "instrument to place" vocabulary
  fix → thicket stroke geometry → decision-tree terrain modes (mountain/
  basin/dense/ordinary) → the ecosystem rebuild (literal mountain, hills,
  pond, lone trees, meadow, all placed by real per-month data). Each
  commit message documents what changed and why, including the bugs
  found and fixed along the way. `git log terrain-ecosystem-wip` to
  browse it; `git checkout terrain-ecosystem-wip -- app/components/LandingTerrain.tsx`
  to pull any single stage back out.

- **`render-check-ink.js`** (this folder) — a standalone, real-data
  prototype proving the *next* direction: actual cartographic ink
  (hachures for high ground, stippling for water), built from
  individual real poems instead of month aggregates. Not wired into the
  live component. Run with `node render-check-ink.js` from this folder —
  it reads `../content/posts` directly and writes PNGs showing a real
  hachured mountain (Feb 2025's 67 poems, each an independent bump in a
  heightfield) and a real stippled pond (a genuine calm cluster of 13
  poems, May–June 2025). This is where a future rebuild should start
  from, not from scratch.

## Why it's parked

The rendering technique kept being the wrong *category* of thing —
parametric shapes (grids, circles, jittered loops) standing in for
mountain/water/tree, rather than real cartographic marks (hachures,
stippling) built from real per-poem density. `render-check-ink.js` is
the first version where that stopped being true. What's not built yet:
classifying all ~325 real poems (not just two hand-picked clusters) into
what they become across the whole archive, a full pannable/exploration
camera (city-builder style drag-to-explore, not a small orbiting
diorama), and hover-reveal signs per poem linking into the existing but
dormant `ReadingJourney`/`BrowseView` reading flow.

## MILAT

The MILAT seam (marking where tag-provenance close-reading coverage
started) doesn't need to come back if/when this resumes — it was a
disclosure for uneven data coverage, and giving every poem the same real
per-poem characterization removes the "before/after" gap it existed to
flag.
