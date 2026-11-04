# Recap

Read before touching `src/shared/recap/` or `src/tools/recap/` — the instrument that turns captures into social recaps (the month calendar, on this day, a week, a grid, a single picture, a photo dump). Brief: `docs/recap.md`; canvas lab 1: https://claude.ai/artifact/9jwFzpczK7jSA6QteE4KzM.

## A template is a recipe over five axes (2026-11-04, R1)

**Decision.** `RecapDoc` (`recap-doc.ts`) holds a `template` and every axis as its own field: the selection rule (`anchor`, `rungs`, `range`, `filter`), the layout (`format`, `grid`, `count`), the background, what a cell says (`cells`), the motion, the sound and one `look`. `RECIPES` is the only place a template differs: it seeds the fields; nothing downstream switches on a template except `recap-layout.ts` (where the slots sit) and `recap-slots.ts` (which slots exist). **Why**: his brief — a catalogue whose every template can be re-dressed in the inspector, and a new template without a new editor. **How to apply**: a new template is a recipe, a slot list and a page layout; a new setting is a field read by `readRecapDoc` with its clamp.

## Slots, filled by the rule, corrected by hand (2026-11-04, R1)

`resolveRecap` names a template's SLOTS — a day (`2026-10-14`), a step back (`ago:1y`), a place (`n:3`) — and fills each from the pool through the filter: Winnow's pick, then its stars, then a photo over a clip (unless clips are asked), then the picture nearest 13:00. `picks` pins a picture on a slot and wins; `cleared` empties one; a picture pinned elsewhere is never the rule's choice again (the same picture twice reads as a mistake). Grid/single/dump spread `spreadPick` over the period: ranked pictures first, the rest evenly spaced in time. Days are capture-wall-clock `YYYY-MM-DD` (`captureDay`), never instants: a month back of 31 March is 28 February (`dayAgo`). Storytelling's wall rule, applied again.

## One layout in page pixels, one clock, one painter (2026-11-04, R1)

`layoutRecap` places every part in the page's own pixels (1080 wide, the format's height; Reel insets keep 12 % top, 16 % bottom free for Instagram's buttons); `planFilm` times every entrance, clip turn and the film's length; `paintRecap` draws a page at a moment through `PaintSources` (sync — a picture not in hand is a placeholder, never a wait). The stage and every export call the same three, so the preview IS the file (Mosaic's and Storytelling's rule). `hitTest` reads the same boxes for a click. A dump's pages follow `dumpPages`: a cover, then oneTwo · full · four · two · three, four or fewer left ending on ONE fitted page, never past 20 slides. Clips play `turn` (one at a time after everything is on, ≤ 5 s each, ringed in the accent) by default; `clipSlideNumbers` numbers the carousel slide each clip gets after the recap's own pages — the cell's `▶ 4`. A sound marked `fit` stretches the film to a whole number of its loops, unless that would more than double it. Checked in node through Storytelling's recording context (`recap-paint.test.ts`).

## A picture is KEPT as a print; a clip whole (2026-11-04, R2)

`atelier-recap` keeps, per picture KEY (shared by every recap of the device), the PRINT a slot draws — a JPEG ≤ 2048 px: a Winnow photo cut from its proxy, a Winnow clip's poster from its thumbnail, a local photo through `decodePhoto` (HEIF, JXL, a RAW's render), a local clip's poster from a frame at 0.6 s — and the CLIPS a recap plays whole (Winnow's proxy or the local file). **Why**: a local `File` does not survive a reload (`architecture.md`), and a recap must reopen and export without its files; a print is made only for a picture a slot SHOWS, never for the pool. Pruned to what the device's recaps name when one is deleted; said in the legal notice and `local-first.md` (seventh case). The sound file is kept per recap (`sounds`), never in the document. A clip added as the looping BACKGROUND joins the pool `loose` (`RecapPicture.loose`): kept and synced like any picture, never a slot's — found driving the carousel, where the background clip had taken the cell of the day it was shot.

## The rule fills once; the stage drives the inspector (2026-11-04, R2)

A new recap with a Winnow connected FILLS ITSELF once (`recap-fill.ts`: one `allAssets` window per run of days, rejects left out, references only). A click on the stage selects a cell, a text or the background and the inspector jumps to its tab (Pictures, Text, Background); a drag swaps two cells' pictures (both pinned after) or moves the heading (`headingOffset`). Paused, the stage RESTS at the page's `allOn` (everything on, an edit seen at once); Play starts the film at 0 unless the author scrubbed. The catalogue's cards are the real painter over colour fields (`sample-recap.ts` — no photograph in a public repo) and play their entrance on hover.

## Develop per picture, one look per recap (2026-11-04, R2)

Develop's own sheet opens on the print (or the local file in hand): Done writes the picture's `develop` and the recap's `look` (the stack's layers). The stage and the exports grade each print through `makeFrameGrader(stack.composeWith(develop))` once per look + develop (`use-recap-pictures.ts`), the Trips/Studio rule that what was done to a photograph is part of it. Clips are drawn ungraded in V1.

## Exports paint on their own clip elements (2026-11-04, R2)

`recap-export.ts`: the film is `encodeFrames` over the painter, every clip and the looping background SEEKED to the exact frame before it is drawn (the stage's elements are left alone, Mosaic's rule); the sound is the kept file looped by `renderBed` clips with the AAC lead, the FILM's fades baked after (not each loop's). Stills: each page at its `allOn`. Carousel: the pages, then one MP4 per clip (≤ 30 s, cover-fit), named by the slide numbers the cells' badges print. A recap kept on a Winnow needs its bucket to list the `recap` kind — his change in Winnow, as `mosaic` was.

## Traps met building it (2026-11-04)

ESLint here has no `react-hooks` plugin: an `eslint-disable … react-hooks/exhaustive-deps` line is itself an error. A raw `<input type="range">` fails the lint unless it is a playhead (`data-playhead`); a setting is a `SliderRow`. `node .github/release.mjs check` fails in a SHALLOW clone on the backfilled 0.1.0–0.3.0 sections (their commits are not in the fetched history) — not a broken changelog.

## An agent drives a recap with the gestures (2026-11-04, R3)

`recap.list/create/open/keep/undo/redo` (shell, Mosaic's) and `recap.get/fill/pin/empty/swap/caption/set/snapshot/export` (editor, `use-recap-commands.ts`) — every write through the editor's funnel, one undo step. `recap.set` takes a deep-merged settings object (`SETTABLE`): `applySettings` reads the merge back through `readRecapDoc` and REFUSES any leaf the reading changed, by name and with its range — the registry's "refused, never clamped" applied to an object without a second schema. `recap.create` titles like the gallery (`defaultTitle`: «October 2026», «Week 44, 2026», «On this day · 4 Nov 2026») and anchors a period on its first day. Driven headless over all six templates (`window.atelier.run`), with local pictures only: the Winnow fill is unit-tested on a fake client (`recap-fill.test.ts`), never run against his instance.
