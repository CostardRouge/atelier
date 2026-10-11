# Agent commands — the second round: find, sort, develop, tell, sum up, deliver

2026-10-11. After people (#300) and «what a picture shows, when and with what»
(#301), the maintainer picked every family of the 29 ideas but the weather
(«sauf À part»): *«fais un plan détaillé et exécute-le … une fois exécuté,
fais une review, optimise et améliore le système, en boucle»*.

This file is the PLAN and its ledger: what each commit delivers, the pure
module it rests on, what verifies it, and what was found in the review loop.
The rules it fixes go to `docs/memory/agent-commands.md`; the gap inventory
stays in `docs/agent-autonomy.md`.

## 0. Principles (the same as the first round)

- **Pure first.** Every decision — a facet read off a row, a sharpness, a
  story's pick, a day's facts — is a DOM-free module with a spec beside it;
  the command is a thin door that fetches, calls, answers.
- **One primitive, many readers.** Thumbnail analysis (`thumb-metrics.ts`)
  is measured ONCE per asset per session and feeds colour, duplicates,
  misses and the story alike; `filterAsk` is the ONE filter every listing
  runs, so a new facet reaches `winnow.assets`, `winnow.sheet`,
  `winnow.search` and `develop.addFromWinnow` at once.
- **Measured, never invented.** A row with no GPS has no country and no light;
  a thumbnail says blur and clipping, never "bad"; a proposal (duplicates,
  misses, a story) is a list the agent LOOKS at (`winnow.sheet {ids}`) and
  never a write to Winnow — culling stays Winnow's.
- **Honest about cost and reach.** A listing is bounded by `allAssets`' cap
  and says so; a thumbnail analysis names its sample (Winnow's thumb, ~400
  px); the story's "diverse" is a score the answer explains per pick.
- **Refuse, don't clamp**; **no `null` params**; writes through the tool's
  funnel (`via: 'agent'`), undoable.

## 1. Commits

| # | Delivers | Pure module (spec beside it) | Verified by |
| --- | --- | --- | --- |
| C1 | **Facets on a row**: `orientation` (portrait · landscape · square), `focalMin/Max`, `apertureMax`, `isoMin`, `shutterMin` (long exposure, seconds), `altitudeMin` (drone height), `near` {place or lat/lon, km} on every listing; `winnow.near` | `winnow/row-facets.ts` (shutter text → seconds, orientation, focal class); `near` over `road-track.distanceKm`; a place resolved offline through the gazetteer (`gazetteer.ts`) | unit specs; headless stub |
| C2 | **Thumbnail analysis**: `winnow.analyse {ids|listing}` → per row sharpness, exposure (dark / bright / clipped shares), dominant colour + warmth, dHash; a `colour` filter (`blue`, `warm`, …) on every listing | `media/thumb-metrics.ts` (pure over RGBA: Laplacian variance, luminance stats, hue histogram, 8×8 dHash + Hamming) + `winnow/thumb-analysis.ts` (DOM: fetch + decode + session cache) | unit specs on synthetic rasters; headless stub |
| C3 | **Sorting proposals**: `winnow.duplicates` (bursts and near-twins, the sharpest marked `keep`), `winnow.misses` (blurry, under, over, with the measure behind each) | `winnow/duplicates.ts`, `winnow/misses.ts` over C2's metrics | unit specs; stub |
| C4 | **Curate**: `curate.story {listing, count}` (N pictures that tell a span without repeating themselves, chronological, each pick with its reason), `curate.cover`, `curate.order {ids, by: time|colour|focal}` | `curate/story.ts` (greedy max-diversity over time · hash · light · faces · gear · orientation, scored by culling and sharpness) | unit specs; stub |
| C5 | **Finds in time**: `winnow.onThisDay`, `winnow.firsts {kind: country|gear|camera|person}`, `winnow.flights {date}` (the drone's `.srt` read: duration, max height, distance) | `winnow/firsts.ts`; countries from the gazetteer; flights over `telemetry/srt-parser` + `flight-path` | unit specs; stub |
| C6 | **The sum-up**: `winnow.stats {from, to}` (counts by kind, gear, body, lens, focal band, local hour, light, weekday, country; top people) and `winnow.statsSheet` — the same numbers drawn as one shareable card | `winnow/stats.ts` (pure), `winnow/stats-card.ts` (canvas) | unit specs; headless image |
| C7 | **Develop reads**: `develop.compare` (before ↔ after, or two pictures, one image), `develop.explain` (what was done, in order, from the journal) | `timelapse-chapters.ts` reused; a two-cell sheet | headless |
| C8 | **Develop in batch**: `develop.match {reference, to}` (the reference's sections applied, exposure offset so the mean luminance matches, measured on the as-shot records), `develop.applyRules {rules}` (light / time / gear → preset or values, per picture), `develop.autoAll {steps}` | `develop/match-exposure.ts`, `develop/apply-rules.ts` (pure) | unit specs; headless |
| C9 | **Deliver**: `develop.deliveryPreset {preset}` — Instagram feed / story / X / web / print as export targets | `develop/delivery-presets.ts` (pure table → `patchRollExport`) | unit specs |
| C10 | **Trips tells**: `trips.facts {date}` (day number, leg, places, km that day, sunrise / sunset, vehicle, Winnow's count / gear / people), `trips.gaps`, `trips.publishing`, `trips.storyPiece {span, count, kind}` (curate → fetch → piece), `trips.recap {stage}` | `roadtrip/day-facts.ts`, `lib/sun.ts` (elevation moved here, rise / set solved) | unit specs; headless |
| C11 | **Trips deduces**: `trips.deduce {apply?}` — the Deduce pipeline run by command, proposals listed, written only on `apply: true` | the existing pure chain (`day-track` → `segment-track` → `track-chapters` → `proposeDraft` → `draftOutcome` → `applyDraft`) | headless stub |
| C12 | **Teach the agent**: `MCP_INSTRUCTIONS` (bridge **v2**), `#/agents` prompts, README, `agent-autonomy.md`, memory | — | gates |
| C13 | **Review loop**: read every new module adversarially, dedupe, measure the entry chunk, re-run the stub drives, fix | — | gates + stub |

Left out on purpose: **weather** (a network exception his to grant), **the
model's suggestion** (B3/B4 of `auto-develop.md` wait on the pairs),
**`winnow.similar`** (needs Winnow to search by image — a Winnow issue),
**scheduling** (a weekly recap is `trips.storyPiece` run by the agent's own
scheduler; Atelier has no clock of its own).

## 2. Ledger

C1–C12 BUILT on 2026-10-11, one commit each, every one driven against the
stubbed Winnow (`scratchpad/pw/c20.mjs` → `c30.mjs`) and gated by
typecheck · lint · test · build; the entry chunk stayed at 474 kB (the
shell's commands are lazily imported). Found and fixed on the way:

- C2: `askFromParams` rebuilt the ask and DROPPED `colour` — the colour
  filter listed everything; a test pins the spread.
- C5: the flight test put a cue on Null Island, which `parsePosition`
  refuses by design; and a 3-cue fixture rounded to 0 s at one decimal —
  two decimals now.
- C8: `develop.autoAll` relies on the workbench being KEYED on the picture;
  `develop.match` says "no as-shot record" rather than copying a wrong
  exposure.
- C10: a composite Trips command must wait for THIS piece's editor, not for
  `trips.setPictures` to exist — `untilPieceOpen`.

C13's review: `winnow-commands.ts` had grown to 920 lines — split by
family (finding · sorting · time and sum-up · curating) over one
`winnowHost`; the roll's six agent commands moved out of `RollEditor` into
a factory over a small host, with a spec; the thumbnail cache capped;
`todayIso()` reused; every stub drive run again after the split.

Not seen: his real instance (the CLIP index, the day positions, the logs),
his Mac or phone.
